"""工作台「版本」页的每一版带上：第几轮用户的话之后改出来的、那一轮的原话、是不是这一轮收尾的那一版。

⚠ 2026-09-30 隔离真机第 140 轮（租房指南 Word，三轮）：「版本」页 13 行 prv-… 裸编号，两秒里 7 版。
  人看不出哪一版是哪一轮改的。模型那边（project_revisions 的 turns）2026-09-27 已经分过组，口径抽到
  services.revision_turns 两边共用。

判据走真 HTTP /revisions + 真 SQL 存储 + 会话记录里真实形状的 user/turn 行（第 144 轮落盘原样的键）。
把 ProjectSourceOperations.revisions 里 label_revisions 那一行删掉，第一条变红。
"""

from __future__ import annotations

from datetime import datetime, timezone

from services import persistence
from test_project_source_operations import edit, setup  # noqa: F401  （夹具）


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _say(setup, text):
    row = setup.sessions.load(setup.project.sessionId)
    row.payload["controlTranscript"].append({"role": "user", "kind": "turn", "timestamp": _now(), "text": text})
    assert setup.sessions.save(setup.project.sessionId, row.payload, expected_rev=row.rev)


def test_each_revision_names_the_turn_that_made_it(setup):
    _say(setup, "做一个任务看板")
    assert edit(setup, key="t1").status_code == 200
    _say(setup, "加一个按截止日期排序的开关")
    assert edit(setup, key="t2a", content="export const a = 1;\n").status_code == 200
    assert edit(setup, key="t2b", content="export const a = 2;\n").status_code == 200
    rows = setup.client.get(setup.url + "/revisions").json()["revisions"]
    labelled = [(r["turnIndex"], r["turnText"], r["turnLast"]) for r in rows]
    assert labelled == [
        (2, "加一个按截止日期排序的开关", True),
        (2, "加一个按截止日期排序的开关", False),
        (1, "做一个任务看板", True),
        (None, None, False),                                   # 建工程时的模板版，早于第一句话
    ]


def test_a_session_without_user_turns_labels_nothing(setup):
    """反向：会话里没有用户的话（比如复刻出来的会话），不编轮次。"""
    assert edit(setup).status_code == 200
    rows = setup.client.get(setup.url + "/revisions").json()["revisions"]
    assert all(r["turnIndex"] is None and r["turnLast"] is False for r in rows)


def test_a_fork_is_titled_as_a_fork(setup):
    """复刻会话与源会话同名时侧栏两条一模一样（第 144 轮复刻）。"""
    fork = setup.client.post(setup.url + "/fork", json={"revision": setup.project.currentRevision,
                                                        "idempotencyKey": "fork-title"}).json()
    state = persistence.load_session_record(fork["sessionId"])["session"]
    assert state.goal["text"] == "复刻：Tasks"
