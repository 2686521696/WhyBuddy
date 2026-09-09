# -*- coding: utf-8 -*-
"""老师傅自己列活儿清单：模型写、用户看得见、下一轮它自己也看得见。

抄的标准答案：grok-build
`xai-grok-tools/src/implementations/grok_build/todo/mod.rs`

    Create and manage a structured task list.
    **The user sees this list live — it is your primary way to show progress.**
    Use for any task with 3+ steps. Skip for trivial single-step work.

第二句是它存在的理由。只落库不给人看 = 抄了一半，工具说明第二句就成了假话。

判据分四类：
1. **活路径**（§1）——真 HTTP：模型调 → 落库 → 发事件 → **下一发的 system
   里带着这张清单**（grok 的 `summary_for_prompt` 每轮跟着走）。
2. **韧性三条**——grok 注释里逐条写了为什么，少一条模型一次疏忽就把进度冲掉。
3. **两份待办不许混**（§7）——`factoryTodo` 是闸的输入，这一份是叙述。
   混了就会出现「模型把 closure 从清单里划掉，闭环就放行」。
4. **生成侧 / 消费侧成对**（§4）——服务端发 `control_todo`，客户端得认。
   新增事件不进客户端 switch 会被**静默丢掉**，跟 data-* 不进 DOMPurify 白名单
   是同一种伤。
"""

from __future__ import annotations

import ast
import copy
import json
from pathlib import Path

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from models.v5_state import V5SessionState
from services.closed_tools import CLOSED_TOOLS, ToolScope, resolve_tool_scope
from services.plan_todo import (
    MAX_TODO_ITEMS,
    TodoStatus,
    apply as apply_todo,
    effective_merge,
    normalize,
    one_line,
    summarize,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _confirmed(sid: str) -> None:
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )


THREE = [
    {"id": "t1", "content": "先画页面", "status": "in_progress"},
    {"id": "t2", "content": "再反推数据模型"},
    {"id": "t3", "content": "最后打权限孔"},
]


# ── 一、活路径 ────────────────────────────────────────────────────────────


def test_模型列的清单_落库_发事件_下一发自己还看得见(harness):
    sid = new_sid("todo-live")
    _confirmed(sid)
    shots: list = []

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        if len(harness.llm_calls) == 1:
            return llm_tool("todo_write", {"todos": THREE, "merge": False})
        return llm_text("好的")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "这活儿分几步做？"))

    # ① 发了给人看的事件（工具说明第二句的载体）
    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev, [e.get("type") for e in events]
    assert "活儿清单" in todo_ev[0]["line"], todo_ev[0]
    assert "先画页面" in todo_ev[0]["summary"]

    # ② 真落库了
    saved = normalize(getattr(load_session(sid), "controlTodo", None))
    assert [r["id"] for r in saved] == ["t1", "t2", "t3"], saved
    assert saved[0]["status"] == TodoStatus.IN_PROGRESS.value

    # ③ **同一轮**：靠工具结果回喂（grok 的 summary_for_prompt 就是 tool 结果）。
    #
    # ⚠ 第一版这里断言的是「第二发采样的 system 里有清单」——红了才想明白：
    #   控制面的 messages[0] 只在 **WRITE 交回之后**才重建（`wrote` 那一支），
    #   todo_write 是 READ，同一轮里 system 还是回合开始时那一份。
    #   grok 也不是走系统提示词：它把 summary 放进 tool 结果。照它抄才对。
    assert len(shots) >= 2, "第二发没采样，量不到回喂"
    tool_msgs = [m for m in shots[1] if m.get("role") == "tool"]
    assert tool_msgs, shots[1]
    body = json.loads(str(tool_msgs[-1].get("content") or "{}"))
    assert "先画页面" in str(body.get("summary") or ""), body

    # ④ **下一轮**（新一发 HTTP，state 重新读）：靠系统提示词那条现场。
    shots.clear()
    harness.llm_impl = lambda messages, **kw: (
        shots.append(copy.deepcopy(messages)) or llm_text("嗯")
    )
    harness.post(six_fields(sid, "接着说"))
    system = str(shots[0][0].get("content") or "")
    assert "活儿清单" in system and "先画页面" in system, system[-500:]


def test_没列过清单时提示词里不许凭空多一段(harness):
    """反向。少了它，「每轮都塞一段空清单」照样绿。"""
    sid = new_sid("todo-none")
    _confirmed(sid)
    shots: list = []

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        return llm_text("好的")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "随便聊聊"))
    assert "活儿清单" not in str(shots[0][0].get("content") or "")


def test_重复id是错误即输出_清单原样不动(harness):
    """抄 grok：`error-as-output variant so the Python side can distinguish
    this from infra errors`。分不清「模型写错了」和「我们炸了」，
    两种都会被当成后者。而且出错时清单必须原样——半张比没写更糟。"""
    sid = new_sid("todo-dup")
    _confirmed(sid)

    def impl(messages, **kw):
        n = len(harness.llm_calls)
        if n == 1:
            return llm_tool("todo_write", {"todos": THREE, "merge": False})
        if n == 2:
            return llm_tool(
                "todo_write", {"todos": [{"id": "x"}, {"id": "x"}]}, call_id="dup"
            )
        return llm_text("好的")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "列一下"))

    bad = [
        e
        for e in events
        if e.get("type") == "control_tool_result"
        and e.get("tool") == "todo_write"
        and e.get("ok") is False
    ]
    assert bad, [e.get("type") for e in events]
    assert "唯一" in str(bad[0].get("error") or "")
    # 清单没被那一笔弄坏
    saved = normalize(getattr(load_session(sid), "controlTodo", None))
    assert [r["id"] for r in saved] == ["t1", "t2", "t3"], saved


# ── 二、grok 的韧性三条 ───────────────────────────────────────────────────


def test_merge缺省为真_只翻状态不必回抄内容():
    """grok：`This lets the model mark an item from in_progress → completed
    without echoing the content back.`"""
    rows, err = apply_todo(None, THREE, merge=False)
    assert err is None
    after, err = apply_todo(rows, [{"id": "t1", "status": "completed"}])
    assert err is None
    assert [r["id"] for r in after] == ["t1", "t2", "t3"], after
    assert after[0]["content"] == "先画页面", "只翻状态把内容冲掉了"
    assert after[0]["status"] == TodoStatus.COMPLETED.value


def test_合并时内容丢了拿id兜底_永不报错():
    """grok：`so the tool never errors on a merge call. This makes the tool
    resilient to state being lost between calls.`"""
    rows, err = apply_todo(None, [{"id": "补一条"}], merge=True)
    assert err is None
    assert rows == [{"id": "补一条", "content": "补一条", "status": "pending"}]


def test_忘了写merge时自动升格_但不许扩大成猜意图():
    """grok 的自动升格。正向 + **反向**：只要有一条是新 id 或带了内容，
    就按调用方说的算——自动升格只救「明显是想改状态却忘了写 merge」。"""
    rows, _ = apply_todo(None, THREE, merge=False)
    assert effective_merge(rows, [{"id": "t1"}, {"id": "t2"}], False) is True
    # 新 id → 不升格
    assert effective_merge(rows, [{"id": "t9"}], False) is False
    # 带了内容 → 不升格（那是真的想重写）
    assert effective_merge(rows, [{"id": "t1", "content": "改一改"}], False) is False
    # 清单本来是空的 → 没什么可合并
    assert effective_merge([], [{"id": "t1"}], False) is False


def test_显式replace是真的整张换掉():
    rows, _ = apply_todo(None, THREE, merge=False)
    after, _ = apply_todo(rows, [{"id": "n1", "content": "新计划"}], merge=False)
    assert [r["id"] for r in after] == ["n1"], after


def test_认不出的状态一律当没做_不当已完成():
    """缺省是最保守那一档，不是最乐观那一档。把认不出的当成已完成，
    进度条会自己跑满。"""
    rows, _ = apply_todo(None, [{"id": "a", "status": "以后新加的状态"}])
    assert rows[0]["status"] == TodoStatus.PENDING.value


def test_清单有上限_不许把SPEC抄一遍进提示词():
    many = [{"id": f"i{n}", "content": f"第 {n} 步"} for n in range(MAX_TODO_ITEMS + 8)]
    rows, _ = apply_todo(None, many, merge=False)
    assert len(rows) == MAX_TODO_ITEMS


# ── 三、两份待办不许混（§7）──────────────────────────────────────────────


def test_活儿清单碰不到闭环那本账(harness):
    """`factoryTodo` 是闭环闸的输入（非空不发合格证），这一份是叙述。

    混了就会出现「模型把 closure 从清单里划掉，闭环就放行」——§7 伪造绿灯。
    这里让模型把带 closure 字样的条目全标成完成，factoryTodo 必须纹丝不动。
    """
    sid = new_sid("todo-sep")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
        factoryTodo=["structure", "bind"],
    )
    harness.llm_impl = lambda messages, **kw: (
        llm_tool(
            "todo_write",
            {
                "todos": [
                    {"id": "structure", "content": "structure", "status": "completed"},
                    {"id": "bind", "content": "bind", "status": "completed"},
                    {"id": "closure", "content": "closure", "status": "completed"},
                ],
                "merge": False,
            },
        )
        if len(harness.llm_calls) == 1
        else llm_text("好了")
    )
    harness.post(six_fields(sid, "都标完成"))

    st = load_session(sid)
    assert list(getattr(st, "factoryTodo", None) or []) == ["structure", "bind"], (
        "活儿清单动了闭环那本账"
    )
    assert len(normalize(getattr(st, "controlTodo", None))) == 3


def test_两个字段在状态上是分开的():
    st = V5SessionState(sessionId="sep", goal={"text": "x"})
    assert "factoryTodo" in V5SessionState.model_fields
    assert "controlTodo" in V5SessionState.model_fields
    assert getattr(st, "factoryTodo", None) is None
    assert getattr(st, "controlTodo", None) is None


# ── 四、成对物：归属三处 + 生成侧/消费侧（§4）────────────────────────────


def test_归属三处齐备_客户端PUT抹不掉():
    """照 factoryTodo：PUT pop + model_dump exclude + persist 见 None 才 restore。

    ⚠ 少任何一处都不报错，只会**静静地**被客户端一次全量 PUT 抹掉——
      ownerId 那次就是这么丢的（实测 POST 建好 → PUT 一次 → DELETE 404）。
    """
    route = (ROOT / "slide-rule-python/routes/sliderule_full.py").read_text("utf-8")
    assert 'client_input.pop("controlTodo", None)' in route
    assert '"controlTodo"' in route.split("model_dump(exclude=")[1][:600]
    persist = (ROOT / "slide-rule-python/services/persistence.py").read_text("utf-8")
    at = persist.find('prior_plan = getattr(prior, "controlTodo"')
    assert at > 0, "persist 没有 restore 这一段"
    assert 'update={"controlTodo": prior_plan}' in persist[at : at + 700]


def test_服务端发的事件客户端必须认():
    """新增流事件不进客户端 switch 会被**静默丢掉**——跟新增 data-* 不进
    DOMPurify 白名单是同一种伤（CLAUDE.md §4 那张表）。"""
    driver = (ROOT / "client/src/lib/sliderule-marathon-driver.ts").read_text("utf-8")
    assert 'case "control_todo":' in driver, "客户端不认这个事件"
    assert "onControlTodo" in driver
    hook = (
        ROOT / "client/src/pages/sliderule/useSlideRuleSession.ts"
    ).read_text("utf-8")
    assert "onControlTodo" in hook, "认了但没人接 = 清单还是看不见"
    assert "appendStreamStep" in hook.split("onControlTodo")[1][:400], (
        "接了但没往左栏画 = 用户仍然看不见"
    )


def test_闭集两侧同步():
    ts = (ROOT / "client/src/lib/factory-hops.ts").read_text("utf-8")
    assert "todo_write" in CLOSED_TOOLS
    assert '"todo_write"' in ts, "TS 镜像漏了 = 芯片一半不认"
    # 它不造五系统模型 → READ（缺省），紧档的原地打转检测正好接得上。
    assert resolve_tool_scope("todo_write") is ToolScope.READ


def test_工具说明第二句必须在():
    """grok 的说明只有两句，第二句「用户看得见」是它存在的理由。
    砍掉就只剩模型自言自语，而这条判据在别处**量不到**——
    提示词里没有它，模型不知道这清单是给人看的。"""
    from services.rehearsal_control import CONTROL_TOOLS

    desc = next(
        (t["function"]["description"] for t in CONTROL_TOOLS
         if (t.get("function") or {}).get("name") == "todo_write"),
        "",
    )
    assert "用户看得见" in desc, desc
    assert "三步以上" in desc, desc


def test_渲染标记只有一处():
    """状态 → 标记只许一张表。第二处会漂（同 _STOP_TABLE 那条纪律）。"""
    src = (ROOT / "slide-rule-python/services/plan_todo.py").read_text("utf-8")
    tree = ast.parse(src)
    tables = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.AnnAssign)
        and isinstance(n.target, ast.Name)
        and n.target.id == "_TAG"
    ]
    assert len(tables) == 1
    assert summarize([{"id": "a", "content": "x", "status": "completed"}]).startswith("●")
    assert one_line([]) == ""


# ── 五、真机 todo-1788951017 逮到的：送了 N 条不许静默变 0 条 ────────────


@pytest.mark.parametrize(
    "shape",
    [
        pytest.param([{"content": "设计数据模型"}, {"content": "规划页面"}], id="没带id"),
        pytest.param(["设计数据模型", "规划页面"], id="整条是字符串"),
        pytest.param([{"task": "设计数据模型"}, {"text": "规划页面"}], id="别的键名"),
    ],
)
def test_模型送了几条清单里就得有几条(shape):
    """⚠ 这条是真机打出来的。todo-1788951017：模型在正文里老老实实列了四步，
    `control_todo` 事件里却是「还没有列活儿清单。」，工具还回 `ok: true`。

    真因是它没带 id，而第一版那句 `if not rid: continue` 把四条全丢了——
    **正向判据全绿、东西没了**（CLAUDE.md §3）。改造前那批单测全都是我自己
    构造的、每条都带 id 的输入，所以一条都没红：判据自己喂了护栏想要的形状
    （§一之二）。

    这一条钉的是不变量本身：**非空输入不许产出空清单**。以后模型再换一种
    填法，红的是这里，不是用户那边。
    """
    rows, err = apply_todo(None, shape)
    assert err is None, err
    assert len(rows) == len(shape), (shape, rows)
    assert all(r["content"] for r in rows), rows
    assert all(r["id"] for r in rows), rows


def test_没带id时拿内容当id_下一笔还能对上():
    """兜底的 id 必须**稳定**，否则合并永远命不中，每一笔都变成新条目，
    清单越滚越长——用户看着进度反着走。"""
    rows, _ = apply_todo(None, [{"content": "设计数据模型"}, {"content": "规划页面"}])
    assert [r["id"] for r in rows] == ["设计数据模型", "规划页面"]
    after, err = apply_todo(rows, [{"id": "设计数据模型", "status": "completed"}])
    assert err is None
    assert len(after) == 2, "合并没命中，长出了新条目"
    assert after[0]["status"] == TodoStatus.COMPLETED.value


def test_空输入才允许是空清单():
    """反向：不许为了让上面那条过，把空输入也塞出一条来。"""
    rows, err = apply_todo(None, [])
    assert rows == [] and err is None
    assert summarize(rows) == "还没有列活儿清单。"


def test_工具不许在吞掉了内容之后还说ok(harness):
    """活路径上的同一条不变量：模型送了东西、清单是空的，`ok` 不许是 true。"""
    sid = new_sid("todo-noid")
    _confirmed(sid)
    harness.llm_impl = lambda messages, **kw: (
        llm_tool(
            "todo_write",
            {"todos": [{"content": "第一步"}, {"content": "第二步"}, {"content": "第三步"}]},
        )
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "分几步做"))

    todo_ev = [e for e in events if e.get("type") == "control_todo"]
    assert todo_ev, [e.get("type") for e in events]
    assert len(todo_ev[-1]["todos"]) == 3, todo_ev[-1]
    assert "第一步" in todo_ev[-1]["summary"]
    assert todo_ev[-1]["line"], "左栏那一句是空的 = 用户还是看不见"
    res = [
        e for e in events
        if e.get("type") == "control_tool_result" and e.get("tool") == "todo_write"
    ]
    assert res and res[-1].get("count") == 3, res
