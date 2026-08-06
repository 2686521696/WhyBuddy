"""复刻（fork）出来的会话：归属、话题、耗时。

三条都是 2026-08-06 用户实测反馈出来的，且都不是"偶发"，是必现。

## ① 副本会话没有归属

fork 里建 V5SessionState 时没传 ownerId → 副本会话**无主**。而 2026-08-06
的会话隔离把无主会话收紧成"只有超管看得见"，于是复刻完的人自己都打不开
刚复刻出来的东西。加归属列那次没有回头检查还有谁在建会话。

## ② 副本的话题是源应用的，本人的指令顶不掉它

用户原话：「我发布的是从文献到引用的话题，回答的是电动车方面的内容，
但是生成的应用又却是对的。」——各能力吃 state.goal（继承来的电动车），
五系统生成吃 user_instruction（本人的新话题），过程和结果讲两件事。

## ③ fork 慢：一次复刻打 14 次 Wikipedia

剖析（scratchpad/profile_fork.py）：

    _ensure_runtime_closure_evidence   11027 ms   占总耗时 99.3%
      └ 14 次 Wikipedia 请求             9910 ms

复刻的是一份已推演完的模型，重建闭环证据不需要重新去外网找证据。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── ② 继承来的话题让位 ──────────────────────────────────────────
class _State:
    def __init__(self, goal):
        self.goal = goal


def test_inherited_goal_is_replaced_by_first_user_instruction():
    from routes.sliderule_full import adopt_user_goal

    st = _State({"text": "电动车一站式综合服务", "status": "clear", "inherited": True})
    adopt_user_goal(st, "做一个学术文献引用管理平台")
    assert st.goal["text"] == "做一个学术文献引用管理平台"
    # 标记必须清掉：只顶一次，之后的都是正常精修
    assert st.goal["inherited"] is False


def test_second_instruction_does_not_overwrite_again():
    """第二条指令是精修，不能再把话题冲掉。

    否则「把提醒改成短信」会变成整个会话的话题，模型下一轮就没了上下文。
    """
    from routes.sliderule_full import adopt_user_goal

    st = _State({"text": "学术文献引用管理平台", "status": "clear", "inherited": False})
    adopt_user_goal(st, "把提醒改成短信")
    assert st.goal["text"] == "学术文献引用管理平台"


def test_normal_session_goal_is_never_touched():
    """自己新建的会话没有 inherited 标记，一个字都不该动。"""
    from routes.sliderule_full import adopt_user_goal

    st = _State({"text": "我自己提的话题", "status": "clear"})
    adopt_user_goal(st, "随便一条指令")
    assert st.goal["text"] == "我自己提的话题"


def test_empty_instruction_keeps_inherited_goal():
    """空指令不能把话题清成空——那会让副本变成一个没有话题的壳。"""
    from routes.sliderule_full import adopt_user_goal

    st = _State({"text": "电动车一站式综合服务", "status": "clear", "inherited": True})
    adopt_user_goal(st, "   ")
    assert st.goal["text"] == "电动车一站式综合服务"
    assert st.goal["inherited"] is True


# ── ① 副本会话必须有主 · ③ 不打外网 ───────────────────────────────
def test_fork_route_sets_owner_and_suppresses_web_search():
    """这两件事都在 fork 路由里，用源码断言钉住——它们一旦被删掉，
    表现分别是"复刻完自己打不开"和"复刻要等十几秒"，都不会报错。"""
    import inspect

    from routes import sliderule_full

    src = inspect.getsource(sliderule_full.fork_generated_app)
    assert "ownerId=viewer.id" in src, "副本会话必须归复刻的人所有"
    assert "with suppress_web_search():" in src, "重建闭环证据不该打外网"
    assert '"inherited": True' in src, "继承来的话题要打标记"
    # 11 秒的同步活儿不能占着事件循环——那会卡住所有并发请求（含推演 SSE）
    assert "asyncio.to_thread(_init_fork_session)" in src, "会话初始化要挪出事件循环"


# ── ③ 的机制本身 ──────────────────────────────────────────────
def test_suppress_web_search_is_request_scoped():
    """必须是请求域的，不能是全局开关。

    全局关等于把正常推演的外部证据也一起关掉；而并发下一个 fork 不该影响
    别人正在跑的推演。
    """
    import os

    from services.mcp_tools import suppress_web_search, web_search_enabled

    # 基线跟着环境走（测试环境可能本来就把 SLIDERULE_WEB_SEARCH 关了），
    # 这里钉的是**这个上下文管理器造成的差值**，不是某个绝对值。
    os.environ.pop("SLIDERULE_WEB_SEARCH", None)
    baseline = web_search_enabled()
    assert baseline is True, "清掉环境变量后默认应当是开的"

    with suppress_web_search():
        assert web_search_enabled() is False
    # 退出即恢复，异常路径也要恢复（contextmanager 的 finally）
    assert web_search_enabled() is baseline

    try:
        with suppress_web_search():
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    assert web_search_enabled() is baseline, "异常退出后必须恢复，否则整个进程再也搜不了"


def test_web_search_returns_none_when_suppressed():
    """停用时返回 None —— 调用方据此回落本地 RAG 并如实标注检索方式，
    不会冒充外部证据。"""
    from services.mcp_tools import suppress_web_search, web_search

    with suppress_web_search():
        assert web_search("任意查询", 6) is None
