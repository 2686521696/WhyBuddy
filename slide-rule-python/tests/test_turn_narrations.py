"""E13 直播时间线持久化：turnNarrations PUT→GET 往返 + 封顶 + 同轮守卫豁免。

回归目标：刷新后左栏「7 阶段 25 步」不再缩成「1 阶段 0 步」——
叙述随会话状态落库，且不被同轮 stale-clobber 守卫丢弃。
"""

import os
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _fresh_client(monkeypatch):
    store = Path(tempfile.mkdtemp(prefix="turn-narr-")) / "sessions.json"
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(store))
    import services.slide_rule_session as sess_svc
    import routes.sliderule_full as sliderule_full

    sess_svc._sessions = {}
    sliderule_full._sessions = {}
    app = FastAPI()
    app.include_router(sliderule_full.router, prefix="/api/sliderule")
    return TestClient(app)


def _narr(turn_id: str, n_steps: int = 3, text: str = "正在分析风险"):
    return {
        "turnId": turn_id,
        "user": "社区宠物医院预约问诊系统",
        "steps": [
            {"id": f"{turn_id}-s{i}", "kind": "narration", "text": f"{text} {i}", "source": "llm"}
            for i in range(n_steps)
        ],
    }


def test_put_get_roundtrip_keeps_narrations(monkeypatch):
    client = _fresh_client(monkeypatch)
    sid = "narr-roundtrip"
    entry = _narr("turn-7", 5)
    entry["durationMs"] = 23456  # E16 收口句：真实用时随叙述持久化
    state = {
        "sessionId": sid,
        "goal": {"text": "宠物医院", "status": "clear"},
        "lastTurnId": "turn-7",
        "turnNarrations": [entry],
    }
    put = client.put(f"/api/sliderule/sessions/{sid}", json=state)
    assert put.status_code == 200
    got = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]
    narrs = got.get("turnNarrations") or []
    assert len(narrs) == 1 and narrs[0]["turnId"] == "turn-7"
    assert len(narrs[0]["steps"]) == 5
    assert narrs[0]["steps"][0]["text"].startswith("正在分析风险")
    assert narrs[0]["durationMs"] == 23456
    # 非数值用时被丢弃，不编数据
    bad = _narr("turn-8", 1)
    bad["durationMs"] = "not-a-number"
    state2 = {**state, "lastTurnId": "turn-8", "turnNarrations": [bad]}
    assert client.put(f"/api/sliderule/sessions/{sid}", json=state2).status_code == 200
    got2 = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]
    assert "durationMs" not in (got2.get("turnNarrations") or [{}])[-1]


def test_caps_three_turns_and_truncates_text(monkeypatch):
    client = _fresh_client(monkeypatch)
    sid = "narr-caps"
    big = _narr("turn-5", 2)
    big["steps"][0]["text"] = "长" * 5000
    state = {
        "sessionId": sid,
        "goal": {"text": "x", "status": "clear"},
        "lastTurnId": "turn-5",
        "turnNarrations": [_narr(f"turn-{i}") for i in range(1, 5)] + [big],
    }
    assert client.put(f"/api/sliderule/sessions/{sid}", json=state).status_code == 200
    narrs = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]["turnNarrations"]
    assert len(narrs) == 3  # 只留最近 3 轮
    assert narrs[-1]["turnId"] == "turn-5"
    assert len(narrs[-1]["steps"][0]["text"]) <= 1201  # 1200 + 省略号


def test_same_turn_snapshot_still_carries_narrations(monkeypatch):
    """同轮无核心增长的 PUT（轮末叙述回传的真实形态）：守卫保留旧核心，
    但 turnNarrations 作为展示投影必须穿透（persistence 豁免清单）。"""
    client = _fresh_client(monkeypatch)
    sid = "narr-same-turn"
    base = {
        "sessionId": sid,
        "goal": {"text": "宠物医院", "status": "clear"},
        "lastTurnId": "turn-9",
    }
    assert client.put(f"/api/sliderule/sessions/{sid}", json=base).status_code == 200
    # 第二次 PUT：同 lastTurnId、核心零增长，只多叙述
    assert (
        client.put(
            f"/api/sliderule/sessions/{sid}",
            json={**base, "turnNarrations": [_narr("turn-9", 4)]},
        ).status_code
        == 200
    )
    narrs = client.get(f"/api/sliderule/sessions/{sid}").json()["state"].get("turnNarrations") or []
    assert len(narrs) == 1 and len(narrs[0]["steps"]) == 4, "同轮守卫把叙述丢了"


def test_legacy_state_without_narrations_loads_clean(monkeypatch):
    client = _fresh_client(monkeypatch)
    sid = "narr-legacy"
    state = {"sessionId": sid, "goal": {"text": "旧会话", "status": "clear"}}
    assert client.put(f"/api/sliderule/sessions/{sid}", json=state).status_code == 200
    got = client.get(f"/api/sliderule/sessions/{sid}").json()["state"]
    assert got.get("turnNarrations") == []
