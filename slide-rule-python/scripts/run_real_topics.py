# -*- coding: utf-8 -*-
"""真实话题夜跑：真 LLM、真 HTTP、真会话，不开浏览器。

## 为什么要有这一份

`tests/` 里那套跑的是 `ControlHarness` —— 桩掉 LLM，喂回一个写死的
tool_call。它能证明「拿到这个 tool_call 之后分发对不对」，**证明不了**
「真模型看着这一轮的工具清单会不会挑那件工具」。第 2 / 5 / 7 格那几条
（问候不弹问卷、真产品第一句进环、不问产品类型）恰恰全是后者——
判据全绿而真机翻车，本仓 §一 记了三次。

浏览器跑能验，但一轮几十秒、还得盯着看。脚本跑同一条 HTTP，
一次把几条话题跑完，醒了看报告。

## 跑法

    python scripts/run_real_topics.py                  # 全部
    python scripts/run_real_topics.py --only greeting  # 只跑一条
    python scripts/run_real_topics.py --base http://127.0.0.1:9700

前置：后端已起（`uvicorn app:app --port 9700`），`.env` 里有真 LLM key
与登录账号。缺任何一样都**跳过并说清楚**，不当失败——CI 上没有真 key。

账号从环境变量读，不写进仓：REAL_TOPIC_EMAIL / REAL_TOPIC_PASSWORD。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "data" / "checkpoints" / "real-topics-report.md"
BASE = os.environ.get("REAL_TOPIC_BASE", "http://127.0.0.1:9700")
API = "/api/sliderule"


def _post(url: str, body: Dict[str, Any], headers: Dict[str, str], timeout: int = 900) -> str:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    # 本机直连，别走 agent proxy（NO_PROXY 在容器里已含 127.0.0.1，
    # 但 urllib 仍会读 registry/env，显式用 ProxyHandler({}) 更稳）。
    opener = request.build_opener(request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")
    except error.HTTPError as exc:
        # ⚠ 只报「HTTP 400」等于什么都没说。服务端的正文里写着到底哪个字段
        #   不合法，把它带出来——不然下一个人还得再手 curl 一遍。
        body = ""
        try:
            body = exc.read().decode("utf-8", "replace")[:600]
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"HTTP {exc.code} {url}\n{body}") from None


def parse_sse(text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        s = line.strip()
        if not s.startswith("data:"):
            continue
        raw = s[5:].strip()
        if not raw:
            continue
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return out


def types_of(events: List[Dict[str, Any]]) -> List[str]:
    return [str(e.get("type") or "") for e in events]


@dataclass
class Scenario:
    key: str
    title: str
    panel: str
    turns: List[str]
    check: Callable[[List[List[Dict[str, Any]]]], List[str]]
    seed_goal: str = ""


def _first(events: List[Dict[str, Any]], t: str) -> Optional[Dict[str, Any]]:
    for e in events:
        if str(e.get("type") or "") == t:
            return e
    return None


# ── 判据：每条都写「哪一格 / 错了会看见什么」 ───────────────────────
def check_greeting(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """第 2 格：问候不许弹产品问卷，也不许开范围卡。"""
    bad: List[str] = []
    ev = rounds[0]
    ts = types_of(ev)
    if "control_scope_card" in ts:
        card = _first(ev, "control_scope_card") or {}
        bad.append(f"问候开了范围卡：restatement={card.get('restatement')!r}")
    if "control_clarify" in ts:
        bad.append("问候弹了澄清问卷（第 2 格就是要干掉这个）")
    if "complete" not in ts:
        bad.append(f"没有终止事件，前端会转圈：{ts}")
    if "control_handoff_factory" in ts:
        bad.append("问候点着了工厂")
    return bad


def check_real_product(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """第 5/7 格：真产品第一句要被复述认下来，不许反过来考产品类型。"""
    bad: List[str] = []
    ev = rounds[0]
    ts = types_of(ev)
    if "complete" not in ts:
        bad.append(f"没有终止事件：{ts}")
    if "control_clarify" in ts:
        bad.append("真产品第一句还在弹澄清问卷")
    card = _first(ev, "control_scope_card")
    if card is None:
        bad.append(f"没出复述卡：{ts}")
    else:
        r = str(card.get("restatement") or "")
        if not r:
            bad.append("复述卡是空的")
        # 第 5 格：卡上不许拿产品类型当必答题
        for w in ("请选择", "产品类型", "先选"):
            if w in r:
                bad.append(f"复述句里在考产品类型：{r!r}")
                break
    ask = _first(ev, "control_ask_user")
    if ask is not None:
        q = str(ask.get("question") or "")
        for w in ("类型", "平台", "设备", "端"):
            if w in q:
                bad.append(f"真产品第一句反过来问类型/设备：{q!r}")
                break
    return bad


def check_hop_is_one(rounds: List[List[Dict[str, Any]]]) -> List[str]:
    """第 4 格：点一件跑一件，不许把课表焊回来。"""
    bad: List[str] = []
    ev = rounds[-1]
    ts = types_of(ev)
    if "complete" not in ts:
        bad.append(f"没有终止事件：{ts}")
    for e in ev:
        if str(e.get("type") or "") != "control_handoff_factory":
            continue
        tools = e.get("tools") or (e.get("goal") or {}).get("tools")
        if isinstance(tools, (list, tuple)) and len(tools) > 1:
            bad.append(f"一次交回焊了 {len(tools)} 跳：{list(tools)}")
    return bad


SCENARIOS: List[Scenario] = [
    Scenario(
        key="greeting",
        title="问候不弹问卷",
        panel="第 2 格",
        turns=["你好"],
        check=check_greeting,
    ),
    Scenario(
        key="fruit-shop",
        title="真产品第一句进环",
        panel="第 5/7 格",
        turns=["做个水果店收银台"],
        check=check_real_product,
    ),
    Scenario(
        key="clinic",
        title="另一句真产品（换话题，防止只对水果店调好）",
        panel="第 5/7 格",
        turns=["做一个社区诊所的挂号与排队叫号系统"],
        check=check_real_product,
    ),
    Scenario(
        key="capability-question",
        title="你能做什么 —— 是提问不是产品",
        panel="第 2 格",
        turns=["你能做什么"],
        check=check_greeting,
    ),
]


def login(email: str, password: str) -> str:
    body = _post(f"{BASE}{API}/account/login", {"email": email, "password": password}, {})
    tok = json.loads(body).get("token")
    if not tok:
        raise RuntimeError(f"登录没拿到 token：{body[:200]}")
    return str(tok)


def run_scenario(sc: Scenario, token: str, key: str) -> Dict[str, Any]:
    sid = f"real-{sc.key}-{int(time.time())}"
    headers = {"Authorization": f"Bearer {token}", "x-internal-key": key}
    # 会话得先存在：control-turn-stream 在开 SSE 之前就 load_session，
    # 拿不到直接 400（那段注释写了为什么不能等流开了再报）。
    # goal 传空串，跟前端 `createSessionId()` 同一份载荷。省掉 goal 会走
    # 服务端兜底——那条路曾把 goal 填成字面量 "default"（见该路由注释）。
    _post(f"{BASE}{API}/sessions", {"sessionId": sid, "goal": {"text": ""}}, headers)
    rounds: List[List[Dict[str, Any]]] = []
    started = time.time()
    for text in sc.turns:
        payload = {
            "sessionId": sid,
            "userText": text,
            "installedSkills": [],
            "activeConnectors": [],
            "preferredDevice": "desktop",
            "designSystemId": None,
        }
        raw = _post(f"{BASE}{API}/control-turn-stream", payload, headers)
        # 原始流留档：判据只看事件名，出问题时要看字段（restatement 是什么、
        # 谁点的火）。不留档就得重跑一次真 LLM。
        dump = REPORT.parent / "raw" / f"{sid}-{len(rounds)}.json"
        dump.parent.mkdir(parents=True, exist_ok=True)
        dump.write_text(raw, encoding="utf-8")
        rounds.append(parse_sse(raw))
    problems = sc.check(rounds)
    return {
        "key": sc.key,
        "title": sc.title,
        "panel": sc.panel,
        "sessionId": sid,
        "seconds": round(time.time() - started, 1),
        "events": [types_of(r) for r in rounds],
        "problems": problems,
        "ok": not problems,
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只跑这个 key")
    ap.add_argument("--base", help="后端地址")
    args = ap.parse_args(argv)
    global BASE
    if args.base:
        BASE = args.base

    email = os.environ.get("REAL_TOPIC_EMAIL", "")
    password = os.environ.get("REAL_TOPIC_PASSWORD", "")
    key = os.environ.get("SLIDE_RULE_INTERNAL_KEY", "")
    if not (email and password and key):
        print("跳过：缺 REAL_TOPIC_EMAIL / REAL_TOPIC_PASSWORD / SLIDE_RULE_INTERNAL_KEY。")
        return 0
    try:
        request.build_opener(request.ProxyHandler({})).open(f"{BASE}/health", timeout=5)
    except (error.URLError, OSError) as exc:
        print(f"跳过：后端不在 {BASE}（{exc}）。先起 uvicorn。")
        return 0

    token = login(email, password)
    picked = [s for s in SCENARIOS if not args.only or s.key == args.only]
    results: List[Dict[str, Any]] = []
    for sc in picked:
        print(f"── {sc.panel} {sc.title} …", flush=True)
        try:
            r = run_scenario(sc, token, key)
        except Exception as exc:  # noqa: BLE001 — 一条炸了不许拖垮其余
            r = {
                "key": sc.key, "title": sc.title, "panel": sc.panel,
                "seconds": 0, "events": [], "ok": False,
                "problems": [f"跑挂了：{type(exc).__name__}: {exc}"],
            }
        results.append(r)
        mark = "✅" if r["ok"] else "❌"
        print(f"   {mark} {r['seconds']}s  {r['events']}")
        for p in r["problems"]:
            print(f"      · {p}")

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 真实话题夜跑报告",
        "",
        f"- 时间：{datetime.now(timezone.utc).isoformat()}",
        f"- 后端：{BASE}",
        f"- 模型：{os.environ.get('LLM_MODEL', '(未读到)')}",
        "",
        "| 格 | 话题 | 结果 | 秒 | 事件 |",
        "|---|---|---|---:|---|",
    ]
    for r in results:
        mark = "✅" if r["ok"] else "❌"
        ev = " / ".join(",".join(x) for x in r["events"]) or "—"
        lines.append(f"| {r['panel']} | {r['title']} | {mark} | {r['seconds']} | `{ev}` |")
    bad = [r for r in results if not r["ok"]]
    if bad:
        lines += ["", "## 问题"]
        for r in bad:
            lines.append(f"### {r['panel']} {r['title']}（{r.get('sessionId','')}）")
            for p in r["problems"]:
                lines.append(f"- {p}")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n报告：{REPORT}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
