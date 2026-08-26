"""pendingRuns + 轮级 checkpoint（PR-8 / M14）。

用户看见的失败：一轮 5 能力挂在第 4 个 → 整轮重跑，前 3 个 LLM 白烧。
本文件钉的是持久化地基，不是挑战级局部重跑 UI。

判据纪律：
  · 正向：A、B 完成后 pendingRuns 进盘；崩溃后再跑跳过 A/B，只跑 C。
  · 反向：删掉驱动器里 persist_pending_capability 调用点 → 盘上没有
    pending → 恢复重跑 A/B（本文件从磁盘恢复，不是只测 helper）。
  · 写失败 fail-closed：checkpoint OSError 不许报成功；pending 写失败
    不许接着跑下一个能力。
  · 剥注释后流式主路径必须引用 persist helper / pending skip。
  · 不许引 langgraph；spec-first 七步内部不许做每步 checkpoint。
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import persistence  # noqa: E402
from services.persistence import PersistClosedError, load_session_record  # noqa: E402

CAP_A = "evidence.search"
CAP_B = "risk.analyze"
CAP_C = "report.write"
CAPS = [
    {"capabilityId": CAP_A, "roleId": "agent"},
    {"capabilityId": CAP_B, "roleId": "agent"},
    {"capabilityId": CAP_C, "roleId": "agent"},
]
GOAL = "做一个宠物医院预约管理系统，崩溃恢复不得重烧已完成能力"


def _strip_comments(src: str) -> str:
    """源码去注释去 docstring —— 本文件注释里就写着这些函数名，不剥必然假绿。"""
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def _seeded_state(session_id: str) -> V5SessionState:
    return V5SessionState(sessionId=session_id, goal={"text": GOAL}, artifacts=[])


def _completed_ids(state) -> list:
    pending = getattr(state, "pendingRuns", None) or {}
    if not isinstance(pending, dict):
        return []
    return [
        c.get("capabilityId")
        for c in (pending.get("completed") or [])
        if isinstance(c, dict) and c.get("capabilityId")
    ]


class _CrashAfterB(Exception):
    """模拟进程在 cap C 之前挂掉。必须在 per-cap except 外面抛，否则 C 仍会开跑。"""


def _stub_drive_loop(driver, monkeypatch, execute):
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "false")
    monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", "off")
    monkeypatch.setenv("SLIDERULE_LLM_ROUND_CAPS", "0")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(driver, "pick_next_capabilities", lambda state, ui="": [dict(p) for p in CAPS])
    monkeypatch.setattr(driver, "pick_repair_capabilities", lambda state: [dict(p) for p in CAPS])
    monkeypatch.setattr(driver, "ensure_closure_pick_by_deadline", lambda state, picks, **k: picks)
    monkeypatch.setattr(driver, "trusted_closure_decision", lambda *a, **k: "continue")
    monkeypatch.setattr(driver, "skip_planning_loop_for_refine", lambda **k: False)
    monkeypatch.setattr(driver, "orchestrate_plan", lambda *a, **k: type("P", (), {"selected": []})())
    monkeypatch.setattr(driver, "reconcile_coverage", lambda state: state)
    monkeypatch.setattr(driver, "evaluate_coverage_gate", lambda state: {"passed": False})
    monkeypatch.setattr(driver, "resolve_coverage_gaps_from_state", lambda state: state)
    monkeypatch.setattr(driver, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state)
    monkeypatch.setattr(driver, "execute_v5_capability", execute)


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    store = tmp_path / "sessions.json"
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(store))
    # persist_state 不传 store_file；有库配置时会走 DB。本文件要钉磁盘上的 pending。
    monkeypatch.setattr(persistence, "_blob_store", lambda store_file=None: None)
    import services.v5_full_driver as driver_mod

    return driver_mod, store


def _run_stream(driver_mod, state, max_loops=1):
    async def _collect():
        events = []
        async for ev in driver_mod.drive_full_v5_session_stream(
            state, max_loops=max_loops, user_instruction=GOAL
        ):
            events.append(ev)
        return events

    return asyncio.run(_collect())


def test_live_stream_driver_references_pending_persist_and_skip():
    """剥注释后，流式主路径必须引用 persist helper 和 skip。删调用点这条就红。"""
    import services.v5_full_driver as drv

    stream = _strip_comments(inspect.getsource(drv.drive_full_v5_session_stream))
    sync = _strip_comments(inspect.getsource(drv.drive_full_v5_session))
    commit = _strip_comments(inspect.getsource(drv._commit_executed_outcome))
    helper = _strip_comments(inspect.getsource(drv.persist_pending_capability))

    # 流式主路径是 `await asyncio.to_thread(persist_pending_capability, ...)`，
    # persist 名字和开括号不在同一 token 上。盯调用形（名字后跟 `,` 或 `(`），
    # 删掉 to_thread 里那个参数这条就红——注释里的同名已被剥掉。
    assert re.search(r"persist_pending_capability\s*[,(]", stream), (
        "流式驱动没在能力结束后落 pending——删调用点必须红，不能只测 helper"
    )
    assert "_apply_pending_run_skips(" in stream
    assert re.search(r"persist_pending_capability\s*[,(]", sync)
    assert "_apply_pending_run_skips(" in sync
    assert re.search(r"persist_pending_capability\s*[,(]", commit)
    assert "record_pending_run(" in helper
    # 反面：不是只在注释/docstring 里出现
    assert "langgraph" not in stream.lower()
    assert "langgraph" not in helper.lower()


def test_does_not_import_langgraph_or_checkpoint_spec_first():
    from services import spec_first_pipeline as sfp
    import services.v5_full_driver as drv
    import services.persistence as pers

    for src in (
        _strip_comments(inspect.getsource(pers)),
        _strip_comments(inspect.getsource(drv)),
        _strip_comments(inspect.getsource(sfp)),
    ):
        assert "langgraph" not in src.lower()
    spec_src = _strip_comments(inspect.getsource(sfp))
    assert "persist_pending_capability" not in spec_src
    assert "checkpoints" not in spec_src


def test_crash_after_b_resume_skips_completed_caps(driver, monkeypatch):
    """A、B 完成后崩溃；从磁盘恢复必须跳过 A/B，只跑 C。

    变异：驱动器不调 persist_pending_capability → 盘上 pendingRuns 没有 A/B
    → 本条变红（不是只测 record_pending_run helper）。
    """
    driver_mod, store = driver
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute)

    real_persist = driver_mod.persist_pending_capability

    def crash_after_b(state, capability_id, loop=0, selected=None, status="ok", run_id=None):
        out = real_persist(state, capability_id, loop, selected, status, run_id)
        if capability_id == CAP_B:
            raise _CrashAfterB("simulated crash before cap C")
        return out

    monkeypatch.setattr(driver_mod, "persist_pending_capability", crash_after_b)

    _run_stream(driver_mod, _seeded_state("sr-pending-crash"))

    assert calls == [CAP_A, CAP_B], f"崩溃前不该跑到 C，实际 {calls}"
    assert CAP_C not in calls

    rec = load_session_record("sr-pending-crash")
    assert rec.get("ok"), rec
    loaded = rec["session"]
    pending_ids = _completed_ids(loaded)
    assert CAP_A in pending_ids and CAP_B in pending_ids, pending_ids
    assert CAP_C not in pending_ids

    raw = json.dumps(json.loads(store.read_text(encoding="utf-8")), ensure_ascii=False)
    assert "pendingRuns" in raw
    assert CAP_A in raw and CAP_B in raw

    first_calls = list(calls)
    calls.clear()
    monkeypatch.setattr(driver_mod, "persist_pending_capability", real_persist)
    _run_stream(driver_mod, loaded)

    assert CAP_A not in calls and CAP_B not in calls, (
        f"恢复重跑了已完成能力（白烧 LLM）: {calls}; 崩溃前={first_calls}"
    )
    assert CAP_C in calls, f"恢复必须跑未完成的 C，实际 {calls}"


def test_pending_write_failure_does_not_run_next_cap(driver, monkeypatch):
    """pending 写失败 fail-closed：不许假装存了然后接着跑 B/C。"""
    driver_mod, _store = driver
    calls = []

    def execute(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return {
            "title": cap,
            "summary": f"{cap} done",
            "content": f"executed {cap}",
            "provenance": "python-rag",
            "sources": [],
        }

    _stub_drive_loop(driver_mod, monkeypatch, execute)

    real_persist = driver_mod.persist_pending_capability

    def fail_after_a(state, capability_id, loop=0, selected=None, status="ok", run_id=None):
        out = real_persist(state, capability_id, loop, selected, status, run_id)
        if capability_id == CAP_A:
            raise PersistClosedError("pending_write_failed", "injected OSError")
        return out

    monkeypatch.setattr(driver_mod, "persist_pending_capability", fail_after_a)
    _run_stream(driver_mod, _seeded_state("sr-pending-failclosed"))
    assert calls == [CAP_A], f"写失败后仍继续跑了 {calls}"


def test_save_session_writes_checkpoint_with_parent_id(tmp_path):
    store = tmp_path / "sessions.json"
    s1 = V5SessionState(sessionId="s-ckpt", goal={"text": "g1"}, artifacts=[], lastTurnId="turn-1")
    assert persistence.save_session_record(s1, store)["ok"]
    s2 = V5SessionState(sessionId="s-ckpt", goal={"text": "g2"}, artifacts=[], lastTurnId="turn-2")
    assert persistence.save_session_record(s2, store)["ok"]

    ckpt_dir = tmp_path / "checkpoints" / "s-ckpt"
    turn1 = json.loads((ckpt_dir / "ckpt-s-ckpt-turn-1.json").read_text(encoding="utf-8"))
    turn2 = json.loads((ckpt_dir / "ckpt-s-ckpt-turn-2.json").read_text(encoding="utf-8"))
    assert turn1["id"] == "ckpt-s-ckpt-turn-1"
    assert turn1["parent_id"] is None
    assert turn2["id"] == "ckpt-s-ckpt-turn-2"
    assert turn2["parent_id"] == "ckpt-s-ckpt-turn-1"
    assert turn2["turnId"] == "turn-2"
    assert turn2["state"]["goal"]["text"] == "g2"

    # 同轮覆写必须带真进展（pending.completed 增长），否则 lastTurnId 守卫
    # 会挡掉「只改 goal」的陈旧快照——那是故意的，不是 checkpoint 分叉。
    s2b = V5SessionState(
        sessionId="s-ckpt",
        goal={"text": "g2b"},
        artifacts=[],
        lastTurnId="turn-2",
        pendingRuns={
            "loop": 0,
            "selected": [CAP_A],
            "completed": [{"capabilityId": CAP_A, "status": "ok"}],
        },
    )
    assert persistence.save_session_record(s2b, store)["ok"]
    turn2 = json.loads((ckpt_dir / "ckpt-s-ckpt-turn-2.json").read_text(encoding="utf-8"))
    assert turn2["parent_id"] == "ckpt-s-ckpt-turn-1"
    assert turn2["id"] != turn2["parent_id"]
    assert turn2["state"]["goal"]["text"] == "g2b"
    assert CAP_A in json.dumps(turn2["state"].get("pendingRuns") or {})
    # 反面：同轮覆写不得另开文件（父链是覆盖，不是 fork）
    ckpt_files = sorted(p.name for p in ckpt_dir.glob("ckpt-*.json"))
    assert ckpt_files == ["ckpt-s-ckpt-turn-1.json", "ckpt-s-ckpt-turn-2.json"], ckpt_files


def test_checkpoint_write_failure_is_fail_closed(tmp_path, monkeypatch):
    """checkpoint 写失败不许报成功。会话文件可能已经落了，但不能假装存档成了。"""
    store = tmp_path / "sessions.json"

    def boom(path, payload):
        raise OSError("disk full")

    monkeypatch.setattr(persistence, "_atomic_write_json", boom)
    result = persistence.save_session_record(
        V5SessionState(sessionId="s-ckpt-fail", goal={"text": "g"}, artifacts=[], lastTurnId="turn-1"),
        store,
    )
    assert result.get("ok") is False
    assert result.get("reason") == "checkpoint_write_failed"
    # 反面：不能因为会话正文写进去了就当成功
    assert store.exists()
