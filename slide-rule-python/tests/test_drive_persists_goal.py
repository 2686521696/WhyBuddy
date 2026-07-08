"""驱动落盘回归（会话体系的地基）：drive 后核心字段必须真的进磁盘。

复现过的真实 bug：驱动器不推进 lastTurnId，持久化守卫把 drive 开始时的
空 goal 快照当版本终点，后续含 goal 的落盘被"同 turn 不可覆盖"静默拒绝
——只有 append-only 的 artifacts 进盘，重启后会话失忆。

用 SLIDERULE_SESSIONS_FILE 隔离存储（绝不写真实 data/ store）。
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.v5_full_driver import _advance_turn_version, drive_full_v5_session  # noqa: E402
from services.persistence import load_session_record  # noqa: E402


@pytest.fixture()
def isolated_store(tmp_path, monkeypatch):
    store = tmp_path / "sessions.json"
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(store))
    return store


def test_advance_turn_version_increments_and_seeds():
    s = V5SessionState(sessionId="s", goal={"text": "g", "status": "needs_refinement"})
    _advance_turn_version(s)
    assert s.lastTurnId == "turn-1"
    _advance_turn_version(s)
    assert s.lastTurnId == "turn-2"
    s.lastTurnId = "turn-7"
    _advance_turn_version(s)
    assert s.lastTurnId == "turn-8"


def test_drive_persists_goal_and_phase_to_disk(isolated_store):
    # 采购 fixture 走确定性执行路径，零 LLM
    state = V5SessionState(
        sessionId="sr-persist-regression",
        goal={"text": "做一个采购审批应用，含采购单、经理审批、财务确认和字段权限", "status": "needs_refinement"},
        runtimePhase="idle",
    )
    drive_full_v5_session(state, max_loops=6, user_instruction="做一个采购审批应用")

    rec = load_session_record("sr-persist-regression")
    assert rec.get("ok"), rec
    persisted = rec["session"]
    goal = getattr(persisted, "goal", None)
    goal_text = goal.get("text") if isinstance(goal, dict) else getattr(goal, "text", None)
    # 核心断言：goal 文本真的落了盘（守卫版本已推进，不再拒写）
    assert goal_text and "采购审批" in goal_text
    assert getattr(persisted, "lastTurnId", None) == "turn-1"
    assert getattr(persisted, "runtimePhase", "") in ("awaiting", "done")
    assert len(getattr(persisted, "artifacts", []) or []) > 0

    # 磁盘文件本体同样可见（防内存缓存假象）
    raw = json.loads(isolated_store.read_text(encoding="utf-8"))
    flat = json.dumps(raw, ensure_ascii=False)
    assert "sr-persist-regression" in flat and "采购审批" in flat


def test_second_drive_on_same_session_advances_version(isolated_store):
    state = V5SessionState(
        sessionId="sr-persist-twice",
        goal={"text": "做一个采购审批应用，含采购单、经理审批、财务确认和字段权限", "status": "needs_refinement"},
        runtimePhase="idle",
    )
    after_first = drive_full_v5_session(state, max_loops=4, user_instruction="做一个采购审批应用")
    drive_full_v5_session(after_first, max_loops=4, user_instruction="补充：加一个金额上限规则")

    rec = load_session_record("sr-persist-twice")
    assert rec.get("ok")
    # 第二轮 drive 的版本高于第一轮 → 核心字段仍可持续更新
    assert getattr(rec["session"], "lastTurnId", None) == "turn-2"


def test_app_lifespan_shutdown_never_rolls_back_store(isolated_store, monkeypatch):
    """回归：进程关停绝不整体覆写存档。

    历史 bug（跨重启失忆的元凶）：app.py lifespan 在 shutdown 时
    save_all(app.state.sessions)——那是启动时刻的快照、从不随运行更新，
    重启一次就把运行期间落盘的所有新会话回滚掉（"Loaded 35" 恒定不涨）。
    """
    import importlib

    import app as app_module
    importlib.reload(app_module)

    from services.persistence import save_session_record

    async def run_lifecycle():
        async with app_module.lifespan(app_module.app):
            # 模拟运行期间落盘一个新会话（正常路径都走单条守卫式写入）
            mid_run = V5SessionState(
                sessionId="sr-born-mid-run",
                goal={"text": "重启后必须还在的会话", "status": "clear"},
                runtimePhase="done",
                lastTurnId="turn-3",
            )
            save_session_record(mid_run)
        # async with 退出 == shutdown 已执行

    import asyncio
    asyncio.get_event_loop_policy().new_event_loop().run_until_complete(run_lifecycle())

    raw = json.loads(isolated_store.read_text(encoding="utf-8"))
    ids = [e[0] for e in raw]
    assert "sr-born-mid-run" in ids, "shutdown 把运行期间的落盘回滚了（save_all 快照覆写复活）"
    survived = next(s for i, s in raw if i == "sr-born-mid-run")
    assert (survived.get("goal") or {}).get("text") == "重启后必须还在的会话"


def test_create_session_never_wipes_other_persisted_sessions(isolated_store, monkeypatch):
    """回归：create 走单条守卫式写入——绝不整体覆写存档。

    历史 bug：create_session 用 save_all(_sessions) 把整个内存缓存 dump 到
    磁盘；新进程缓存为空时一次 create 就抹掉磁盘上所有其他会话。
    """
    import services.slide_rule_session as sess
    from services.persistence import save_session_record

    rich = V5SessionState(
        sessionId="sr-rich",
        goal={"text": "已推演完的富会话", "status": "clear"},
        runtimePhase="done",
        lastTurnId="turn-9",
    )
    save_session_record(rich)

    # 模拟新进程：内存缓存为空
    monkeypatch.setattr(sess, "_sessions", {})
    sess.create_session("新会话", "sr-fresh")

    both = json.loads(isolated_store.read_text(encoding="utf-8"))
    ids = [e[0] for e in both]
    assert "sr-rich" in ids and "sr-fresh" in ids
    rich_state = next(s for i, s in both if i == "sr-rich")
    assert (rich_state.get("goal") or {}).get("text") == "已推演完的富会话"
    assert rich_state.get("lastTurnId") == "turn-9"
