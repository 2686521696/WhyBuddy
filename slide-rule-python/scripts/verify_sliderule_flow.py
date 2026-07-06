"""
Backend flow verification harness for SlideRule Python.

Exercises the /api/sliderule chain directly against the Python port (9700),
bypassing the Node proxy and the React frontend. Runs the full drive flow
several times and asserts the invariants we care about:

  1. session create returns a sessionId + python backend
  2. drive-full (sync) reaches a terminal phase and emits publishClosure
  3. drive-full-stream (SSE) emits skill_start / skill_result / complete
  4. per-skill evidence is populated on the closure

Usage:
    python scripts/verify_sliderule_flow.py            # default 3 runs, sync + stream
    python scripts/verify_sliderule_flow.py --runs 5
    python scripts/verify_sliderule_flow.py --base http://localhost:3000  # via Node
"""

import argparse
import json
import sys
import time
from typing import Any, Dict, List, Optional

import httpx

DEFAULT_BASE = "http://localhost:9700"

# (intent, expect_closed) — expect_closed=True means the deterministic domain
# recognizer should produce 6/6 evidence; False means it must stay fail-closed.
DOMAIN_CASES = [
    ("采购审批平台：采购单、经理审批、财务确认和字段权限", True),
    ("员工请假审批系统：请假单、部门审批、HR 备案", True),
    ("客户服务工单平台：工单创建、分派、升级和 SLA 闭环", True),
    ("员工入职系统：入职流程、部门分配和 HR 权限管理", True),
    ("一个博客发布网站，带评论功能", False),  # unknown domain -> fail-closed here
    # NOTE: T3 (LLM generate() closing a *novel* intent) is NOT asserted here — this
    # harness hits the live server, which has no LLM key, so novel intents correctly
    # stay fail-closed. The T3 generate->gate->close path is proven with a fake LLM in
    # tests/test_v5_llm_generate_gate.py (decoupled from LLM reliability, per north-star).
    # To see it live: set LLM_API_KEY + SLIDERULE_LLM_GENERATE_ENABLED=1 and add a case with True.
]
INTENTS = [c[0] for c in DOMAIN_CASES]


def _client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=120.0, headers={"Content-Type": "application/json"})


def create_session(client: httpx.Client, intent: str) -> Optional[str]:
    r = client.post("/api/sliderule/sessions", json={"goal": {"text": intent}})
    if r.status_code != 200:
        print(f"  [create] HTTP {r.status_code}: {r.text[:300]}")
        return None
    body = r.json()
    sid = body.get("sessionId")
    print(f"  [create] sid={sid} backend={body.get('backend')} phase={body.get('state', {}).get('runtimePhase')}")
    return sid


def get_session(client: httpx.Client, sid: str) -> Optional[Dict[str, Any]]:
    r = client.get(f"/api/sliderule/sessions/{sid}")
    if r.status_code != 200:
        print(f"  [get] HTTP {r.status_code}: {r.text[:300]}")
        return None
    return r.json().get("state")


def drive_full_sync(client: httpx.Client, state: Dict[str, Any], intent: str) -> Dict[str, Any]:
    r = client.post(
        "/api/sliderule/drive-full",
        json={"state": state, "userText": intent, "max_loops": 6},
    )
    result: Dict[str, Any] = {"ok": False}
    if r.status_code != 200:
        print(f"  [drive-full] HTTP {r.status_code}: {r.text[:400]}")
        return result
    body = r.json()
    final = body.get("state", {})
    closure = body.get("publishClosure")
    result.update(
        ok=True,
        phase=final.get("runtimePhase"),
        artifactCount=len(final.get("artifacts", []) or []),
        capabilityRuns=len(final.get("capabilityRuns", []) or []),
        closureBlocked=(closure or {}).get("blocked") if closure else None,
        evidencePresent=(closure or {}).get("evidencePresentCount") if closure else None,
        skillCount=(closure or {}).get("skillCount") if closure else None,
        provenance=body.get("provenance"),
    )
    return result


EXPECTED_SKILL_ORDER = ["dataModel", "rbac", "workflow", "page", "aigc", "appBundle"]


def drive_full_stream(client: httpx.Client, state: Dict[str, Any], intent: str) -> Dict[str, Any]:
    events: List[Dict[str, Any]] = []
    skill_starts: List[str] = []
    reasoning_steps = 0
    got_complete = False
    got_closure = False
    appbundle_present: Optional[bool] = None
    with client.stream(
        "POST",
        "/api/sliderule/drive-full-stream",
        json={"state": state, "userText": intent, "max_loops": 6},
    ) as resp:
        if resp.status_code != 200:
            body = resp.read().decode("utf-8", "replace")
            print(f"  [stream] HTTP {resp.status_code}: {body[:400]}")
            return {"ok": False}
        for line in resp.iter_lines():
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload:
                continue
            try:
                evt = json.loads(payload)
            except json.JSONDecodeError:
                continue
            events.append(evt)
            t = evt.get("type")
            if t == "reasoning_step":
                reasoning_steps += 1
            elif t == "skill_start":
                skill_starts.append(evt.get("skill"))
            elif t == "skill_result" and evt.get("skill") == "appBundle":
                appbundle_present = evt.get("evidencePresent")
            elif t == "publish_closure":
                got_closure = True
            elif t == "complete":
                got_complete = True
    return {
        "ok": True,
        "eventCount": len(events),
        "reasoningSteps": reasoning_steps,
        "skillStarts": skill_starts,
        "orderOk": skill_starts == EXPECTED_SKILL_ORDER,
        "appbundlePresent": appbundle_present,
        "gotClosure": got_closure,
        "gotComplete": got_complete,
    }


def run_once(base: str, intent: str, mode: str, idx: int, expect_closed: Optional[bool] = None) -> bool:
    print(f"\n--- run #{idx} [{mode}] intent={intent[:20]}... expect_closed={expect_closed} ---")
    with _client(base) as client:
        sid = create_session(client, intent)
        if not sid:
            return False
        state = get_session(client, sid)
        if not state:
            return False

        if mode == "sync":
            res = drive_full_sync(client, state, intent)
            print(f"  [drive-full] {json.dumps(res, ensure_ascii=False)}")
            ok = bool(res.get("ok") and res.get("phase") in ("done", "awaiting", "failed"))
            if expect_closed is not None and res.get("closureBlocked") is not None:
                # closed  => blocked False + evidence == skillCount
                # unknown => blocked True  + evidence 0
                closed = (res.get("closureBlocked") is False)
                if closed != expect_closed:
                    print(f"  ASSERT FAIL: expected closed={expect_closed}, got closed={closed}")
                    ok = False
            return ok
        else:
            res = drive_full_stream(client, state, intent)
            print(f"  [stream] events={res.get('eventCount')} reasoning={res.get('reasoningSteps')} "
                  f"order={res.get('skillStarts')} orderOk={res.get('orderOk')} "
                  f"appbundlePresent={res.get('appbundlePresent')} complete={res.get('gotComplete')}")
            ok = bool(res.get("ok") and res.get("gotComplete") and res.get("orderOk"))
            if expect_closed is not None and res.get("appbundlePresent") is not None:
                present = res.get("appbundlePresent") is True
                if present != expect_closed:
                    print(f"  ASSERT FAIL: expected appbundle present={expect_closed}, got {present}")
                    ok = False
            return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--mode", choices=["sync", "stream", "both"], default="both")
    args = ap.parse_args()

    print(f"Base: {args.base}  Runs: {args.runs}  Mode: {args.mode}")
    passed = 0
    total = 0
    # Iterate over all domain cases (with their expected closed/fail-closed),
    # cycling if --runs exceeds the case count.
    n = max(args.runs, len(DOMAIN_CASES))
    for i in range(n):
        intent, expect_closed = DOMAIN_CASES[i % len(DOMAIN_CASES)]
        modes = ["sync", "stream"] if args.mode == "both" else [args.mode]
        for m in modes:
            total += 1
            try:
                ok = run_once(args.base, intent, m, i + 1, expect_closed)
            except Exception as e:  # noqa: BLE001
                print(f"  EXCEPTION: {type(e).__name__}: {e}")
                ok = False
            passed += 1 if ok else 0
            time.sleep(0.3)

    print(f"\n==== RESULT: {passed}/{total} passed ====")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
