"""会话必须按归属隔离 —— 此前完全没有隔离。

## 这组测试为什么存在

2026-08-06 审查用户隔离时实测：会话侧**一个字的隔离都没有**。

  · 数据层：sliderule_session 只有 session_id / payload / rev /
    created_at / last_active。没有 owner_id，没有 visibility，没有授权表。
  · 路由层：5 条路由（list / create / get / save / delete）**没有一条**
    带 viewer 参数。

匿名（不带任何 cookie / token）实测结果：

    GET    /sessions            → 全量返回，连业务目标原文都在里面
    GET    /sessions/{别人的id}  → HTTP 200，完整状态
    DELETE /sessions/{别人的id}  → HTTP 200，真删掉了

唯一的守卫 `_auth(x_internal_key)` 验的是"Node 有没有权调 Python"这把服务间
密钥，跟"请求是谁发的"无关。

对照之下**应用侧是做了的**（generated_app 有 owner_id + visibility，还有
generated_app_grant 授权表，判定照抄 Gitea 的 accessLevel）。所以这次不新写
一套，把会话转成 app_access 认识的记录形状复用同一个阶梯——两套判定漂移是
这类系统最常见的泄漏方式。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.app_access import (
    Access,
    can_session,
    filter_sessions,
    session_access,
    session_record,
)


class _User:
    def __init__(self, uid: str, superuser: bool = False) -> None:
        self.id = uid
        self.is_superuser = superuser


ALICE = _User("user-alice")
BOB = _User("user-bob")
ROOT = _User("root", superuser=True)

MINE = {"sessionId": "s-alice", "ownerId": "user-alice"}
THEIRS = {"sessionId": "s-bob", "ownerId": "user-bob"}
LEGACY = {"sessionId": "s-legacy"}          # 无主：这个字段存在之前的存量数据
ANON_MADE = {"sessionId": "s-anon", "ownerId": ""}   # 空串也算无主


def test_owner_gets_full_control():
    assert session_access(MINE, ALICE) == Access.OWNER
    for action in ("view", "drive", "delete"):
        assert can_session(action, MINE, ALICE), action


def test_other_users_get_nothing():
    """核心：登录用户之间不能互相看到业务内容。"""
    assert session_access(MINE, BOB) == Access.NONE
    for action in ("view", "drive", "delete"):
        assert not can_session(action, MINE, BOB), action


def test_anonymous_gets_nothing_on_owned_sessions():
    """实测过匿名能读能删别人的会话，这条钉住它。"""
    assert session_access(MINE, None) == Access.NONE
    assert not can_session("view", MINE, None)
    assert not can_session("delete", MINE, None)


def test_superuser_sees_everything():
    assert session_access(THEIRS, ROOT) == Access.OWNER
    assert can_session("delete", THEIRS, ROOT)


def test_ownerless_stays_readable():
    """无主保持可读 —— 与应用侧存量数据同一条规则，是**有意**的取舍。

    真正要防的是登录用户之间互看业务内容（上面几条已经保证）。无主的只有
    两类：字段存在之前的存量数据，和匿名建的。一刀切成不可读会让匿名用户
    连自己刚建的会话都读不回来。要清零跑 scripts/backfill_session_owner.py。
    """
    for payload in (LEGACY, ANON_MADE):
        assert session_access(payload, BOB) == Access.READ
        assert can_session("view", payload, BOB)
        # 但仍然不能写、不能删——READ 就是 READ
        assert not can_session("drive", payload, BOB)
        assert not can_session("delete", payload, BOB)


def test_list_filter_matches_single_decision():
    """列表与单条必须给同一个结论。

    列表漏一个条件 = 别人的会话出现在侧栏里，而单条打开是好的，
    所以没人会报 bug —— 这正是应用侧那条注释警告过的形状。
    """
    everything = [MINE, THEIRS, LEGACY]
    for viewer, expected in (
        (ALICE, {"s-alice", "s-legacy"}),
        (BOB, {"s-bob", "s-legacy"}),
        (None, {"s-legacy"}),
        (ROOT, {"s-alice", "s-bob", "s-legacy"}),
    ):
        got = {p["sessionId"] for p in filter_sessions(everything, viewer)}
        assert got == expected, f"viewer={viewer} 拿到 {got}"
        # 逐条复核：列表里的每一条都得单独判得过
        for payload in filter_sessions(everything, viewer):
            assert session_access(payload, viewer) >= Access.READ


def test_owned_sessions_are_private_not_public():
    """有主的会话可见性必须是 private —— 不能因为漏设而落进"公开"那一支。"""
    from services.app_access import Visibility

    assert session_record(MINE)["visibility"] == Visibility.PRIVATE
    assert session_record(MINE)["owner_id"] == "user-alice"
    # 无主留空，走 access_for 里"存量数据保持可读"那一支
    assert session_record(LEGACY)["visibility"] == ""
    assert session_record(LEGACY)["owner_id"] is None


def test_blank_owner_is_normalised_to_none():
    """空串和 None 必须是同一种"无主"，否则 SQL 侧会分裂成两种情况。"""
    assert session_record({"sessionId": "x", "ownerId": ""})["owner_id"] is None
    assert session_record({"sessionId": "x", "ownerId": "   "})["owner_id"] is None


def test_unknown_action_is_denied():
    """拼错动作名的后果必须是"做不了"，不能是"畅通无阻"。"""
    assert not can_session("obliterate", MINE, ALICE)


def test_new_sessions_carry_the_current_user():
    """create_session 必须把请求上下文里的用户写进 ownerId。

    漏了这一步不会报错——会话照样建出来，只是**永远无主**，于是匿名照样
    读得到、列得出。实测踩过：路由上忘了 set_current_user，带着有效 token
    建的会话 ownerId 仍是 None。
    """
    from services import slide_rule_session as S
    from services.request_context import reset_current_user, set_current_user

    token = set_current_user(ALICE)
    try:
        state = S.create_session("测试归属落地")
        assert state.ownerId == "user-alice"
    finally:
        reset_current_user(token)
        S._sessions.pop(state.sessionId, None)


def test_anonymous_creation_is_allowed_and_ownerless():
    """匿名建会话是合法状态，不能因为没登录就建不出来。"""
    from services import slide_rule_session as S

    state = S.create_session("匿名建的")
    try:
        assert state.ownerId is None
    finally:
        S._sessions.pop(state.sessionId, None)
