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


def test_ownerless_is_superuser_only():
    """无主会话只有超管看得到（2026-08-06 方案 B 之后收紧）。

    第一版让无主"保持可读"，与应用侧存量数据同规则。用户实测后否掉了：
    没登录建的会话，登录之后照样出现在列表里。

    方案 B 从源头解决——建会话已经要求登录，正常路径不再产生无主会话。
    剩下的唯一来源是**本机文件存档自动导入**（启动时把
    data/sliderule-sessions.json 灌进库，那批天然没有归属），那种更不该
    人人可见。
    """
    for payload in (LEGACY, ANON_MADE):
        assert session_access(payload, BOB) == Access.NONE
        assert session_access(payload, None) == Access.NONE
        assert not can_session("view", payload, BOB)
        # 超管仍然看得到——否则导入进来的数据谁也管不了
        assert session_access(payload, ROOT) == Access.OWNER


def test_list_filter_matches_single_decision():
    """列表与单条必须给同一个结论。

    列表漏一个条件 = 别人的会话出现在侧栏里，而单条打开是好的，
    所以没人会报 bug —— 这正是应用侧那条注释警告过的形状。
    """
    everything = [MINE, THEIRS, LEGACY]
    for viewer, expected in (
        (ALICE, {"s-alice"}),
        (BOB, {"s-bob"}),
        (None, set()),                                   # 匿名什么都看不到
        (ROOT, {"s-alice", "s-bob", "s-legacy"}),        # 只有超管看得到无主的
    ):
        got = {p["sessionId"] for p in filter_sessions(everything, viewer)}
        assert got == expected, f"viewer={viewer} 拿到 {got}"
        # 逐条复核：列表里的每一条都得单独判得过
        for payload in filter_sessions(everything, viewer):
            assert session_access(payload, viewer) >= Access.READ


def test_sessions_are_always_private():
    """会话可见性恒为 private，**无主也一样**。

    没有"公开分享一个会话"这个产品概念（要分享的是应用）。留一个会落进
    "公开"那一支的取值，就等于给泄漏留了条路。
    """
    from services.app_access import Visibility

    assert session_record(MINE)["visibility"] == Visibility.PRIVATE
    assert session_record(MINE)["owner_id"] == "user-alice"
    assert session_record(LEGACY)["visibility"] == Visibility.PRIVATE
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


def test_anonymous_cannot_create_a_session():
    """方案 B：建会话必须登录，从源头消灭"无主会话"这个状态。

    路由层用 _require_login 拦（401）。这里钉的是**动机**：允许匿名建就
    必然产生无主会话，而"无主该给谁看"没有好答案——给所有人看是泄漏，
    只给超管看则游客读不回自己刚建的那条。
    """
    import inspect

    from routes import sliderule_full

    src = inspect.getsource(sliderule_full.create_sess)
    assert "_require_login(viewer)" in src, "建会话路由必须要求登录"
