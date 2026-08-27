"""伴随式澄清：SPEC 步替用户定下的事，必须**当场**冲到流上（2026-08-27）。

## 用户原话

> 虽然功能是做完了，但是各个点感觉有点毛糙，比如澄清部分，就一次问答，
> 问题不是根据指令动态生成的，也不是伴随式的，各个环节都很敷衍。

A/B 两轮治好了前半句（问题从这句需求里长出来、答案真进生成提示词），
剩下的"不是伴随式"是这一条。

## 为什么不是"再加一轮提问"

点火**之前**能问的，只有这句话里读不出来的粗维度（谁用/在哪用/核心流程/
本期边界）——因为那时还没人开始画，更细的分叉根本不存在。而真正让产品
长得不一样的分叉是**画到第 2 步才浮出来的**：员工登录用手机号还是工号、
审批一级还是两级、库存下单扣还是发货扣。它们此前一直是静默的：模型自己
定了，一个字都不说；用户十分钟后打开成品才发现做错了，再从头精修一轮。

## 为什么不 park

让工厂中途停下来等回答，会当场撞上闭环的 fail-closed 语义（停下来算不算
没闭环、恢复算不算同一轮）。这里选的是**不停**：模型该怎么定还怎么定，
只是把定的内容如实报出来，前端非阻塞地摆在旁边，用户要改就走已经验证过的
中途排队（fb728f8）。所以"用户 → AI"的方向一行都没动，新增的只有反向的
一条只读通道。

## 这个文件守的三段接线

    spec_tree            起草时顺带声明 assumptions（同一次 LLM 调用）
    spec_first_pipeline  第 2 步出口调 _emit_assumptions
    v5_full_driver       装 sink → 排水 → yield spec_assumption → finally 卸

缺任何一段都是**静默失效**：spec 照出、模型照返、闸照绿，没有一处会红。
所以下面从**流的另一端**验，跟 test_spec_first_page_stream 同一个路子——
只查源码的话，三段各自"看着都对"、拼起来不通的情况一次都拦不住。
"""

import contextlib
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402
from services.slide_rule_coverage import author_coverage_contract  # noqa: E402
from services.spec_tree import (  # noqa: E402
    SpecTree,
    _sanitize_assumptions,
    build_spec_prompt,
)

GOAL = "做一个连锁药店的门店巡检系统，店长提交巡检单、区域经理审批"


def _seeded_state(session_id: str) -> V5SessionState:
    state = V5SessionState(sessionId=session_id, goal={"text": GOAL}, artifacts=[])
    authored = author_coverage_contract(GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import services.v5_full_driver as driver_mod

    monkeypatch.setattr(driver_mod, "persist_state", lambda s: s)
    return driver_mod


def _drive(driver, state, hook):
    """跑一趟流，在第一个能力执行时叫一次 hook（模拟第 2 步刚起草完 spec）。"""
    from sliderule_llm import capabilities as caps

    fired = {"done": False}

    def fake_native(body, **kw):
        if not fired["done"]:
            fired["done"] = True
            hook()
        cap = body["capabilityId"]
        return {"title": cap, "summary": "s", "content": "c", "provenance": "python-llm"}

    os.environ["SLIDERULE_LLM_ROUND_CAPS"] = "1"
    old = caps.execute_capability
    caps.execute_capability = fake_native
    try:
        async def _collect():
            evs = []
            async for ev in driver.drive_full_v5_session_stream(
                state, max_loops=1, user_instruction=GOAL
            ):
                evs.append(ev)
            return evs

        return asyncio.run(_collect())
    finally:
        caps.execute_capability = old
        os.environ.pop("SLIDERULE_LLM_ROUND_CAPS", None)


ROWS = [
    {
        "id": "a1",
        "topic": "店长怎么登录",
        "decision": "工号 + 密码",
        "alternatives": ["手机号 + 验证码", "企业微信扫码"],
        "why": "需求里没说身份从哪来，连锁门店通常发工号",
    },
    {
        "id": "a2",
        "topic": "审批几级",
        "decision": "区域经理一级审批",
        "alternatives": ["区域经理 + 总部两级"],
        "why": "原话只提到区域经理",
    },
]


# ── 一、契约：起草的时候顺带声明，不另起一次调用 ─────────────────


def test_提示词真的在要这个字段_而且要的是会改变产品形态的事():
    """判据盯**语义**不盯某句话字面（本仓第二条踩过的形状）。

    钉两件事：字段名进了提示词（下游按 key 取数，这个必须字面对）；
    以及它要的是"换个选项产品就长得不一样"，不是"凡是不确定的都列出来"
    ——第一版就是后者，模型老老实实报回来配色、字号、分页条数。
    """
    content = build_spec_prompt(GOAL)[1]["content"]
    assert "assumptions" in content
    assert "alternatives" in content and "decision" in content
    # 语义：这几样明确点名"不算"
    assert "配色" in content and "字号" in content
    # 语义：不许把它做成一次阻塞提问
    assert "不会打断" in content or "不是在问问题" in content


def test_精修轮也要这个字段_不是只有新建才报():
    """精修同样在替用户做决定（"改成工号"之后，密码规则谁定？）。

    ⚠ 反向：真机上精修是主路径之一，只在新建分支加提示词 = 一半不生效
      （本仓第四条）。
    """
    refine = {"instruction": "登录改成工号", "modelDigest": "上一版：药店巡检"}
    content = build_spec_prompt(GOAL, refine=refine)[1]["content"]
    assert "assumptions" in content


def test_手机轮里_假设段在_而设备改写没有打在它身上():
    """⚠ 这条钉的是一次真实的静默失效（2026-08-27 当天）。

    build_spec_prompt 的手机分支改的是 `parts[-1]`——**按位置认人**。
    第一版把假设说明接在 JSON 形状块后面，`parts[-1]` 当场变成了它，
    于是「每一页的侧栏上 → 顶栏上」那两针全打在假设说明上，手机 SPEC
    提示词静静地退回桌面措辞。不报错、不告警。

    修法是把它挂到最后（设备改写之后）。这条判据把「假设段在」和
    「设备改写仍然到位」钉在同一个断言里——分开写的话，下一个人
    只看自己那条绿了就以为没事。
    """
    phone = build_spec_prompt(GOAL, device="phone")[1]["content"]
    assert "assumptions" in phone, "手机轮丢了假设段"
    assert "每一页的顶栏上" in phone, "设备改写打歪了——它改的是位置，不是内容"
    assert "每一页的侧栏上" not in phone


def test_模型里认这个字段_而且缺了不算错():
    """增强类字段：整份 spec 没有 assumptions 必须照样通过（本仓第七条）。"""
    tree = SpecTree.model_validate(_MIN_SPEC)
    assert tree.assumptions is None

    with_rows = SpecTree.model_validate({**_MIN_SPEC, "assumptions": ROWS})
    assert [a.topic for a in with_rows.assumptions] == ["店长怎么登录", "审批几级"]
    assert with_rows.assumptions[0].alternatives == ["手机号 + 验证码", "企业微信扫码"]


# ── 二、脏数据在进模型之前就被剥掉，剥不出东西就当没写 ────────────


def test_脏行被剥掉_而不是把整份spec拖下水():
    """⚠ 这条是 fail-open 的具象化。

    reverse：把 _sanitize_assumptions 从 generate_spec_tree 里摘掉，
    下面这份 payload 会让 SpecTree 校验直接失败——一份 pages/nodes/判据
    全对的 spec，因为顺带报出来的假设少写了一个 decision 就整轮重问，
    白烧 90 秒。那正是本仓第七条说的"把优化写成 fail-closed"。
    """
    payload = {
        **_MIN_SPEC,
        "assumptions": [
            {"topic": "登录", "decision": ""},          # 没定成什么 → 空壳
            {"topic": "", "decision": "两级"},           # 没说是什么事
            "这不是一个对象",
            {"topic": "登录", "decision": "工号"},       # 同一件事说两遍
            {"topic": "登录", "decision": "手机号"},     # dup topic
            {"topic": "扣库存", "decision": "下单扣",
             "alternatives": ["下单扣", "发货扣"]},      # 第一个"其他做法"跟已定的一样
            {"topic": "多余的第四条", "decision": "x"},
        ],
    }
    _sanitize_assumptions(payload)
    rows = payload["assumptions"]
    assert [r["topic"] for r in rows] == ["登录", "扣库存", "多余的第四条"]
    assert rows[0]["decision"] == "工号"
    # 点了等于没改的选项不许留在面板上
    assert rows[1]["alternatives"] == ["发货扣"]
    # 剥干净之后仍是一份能过闸的 spec
    assert SpecTree.model_validate(payload).assumptions is not None


def test_脏假设不许把一份好spec拖去重问():
    """⚠ 上一条验的是"洗衣机会转"，这一条验"脏衣服真的进了洗衣机"。

    只有上一条的话，是本仓第一条的经典形状：函数写对了 ≠ 它被调用了。
    变异（把 generate_spec_tree 里的 _sanitize_assumptions(payload) 摘掉）
    在上一条下面照样全绿——因为那条根本没走生成路径。

    这里让假 LLM 吐一份 pages/nodes/判据全对、只有 assumptions 写歪了的
    payload：洗了就一次通过，不洗就校验失败、白转两轮重问再抛。
    """
    from services.spec_tree import generate_spec_tree

    dirty = {
        **_MIN_SPEC,
        "assumptions": [
            {"topic": "登录", "decision": ""},
            {"没有topic这个键": 1},
            {"topic": "审批几级", "decision": "一级", "alternatives": "本该是数组"},
        ],
    }
    calls = {"n": 0}

    def fake_llm(_messages):
        calls["n"] += 1
        return dict(dirty)

    tree = generate_spec_tree(GOAL, llm_json_fn=fake_llm)
    assert calls["n"] == 1, "为了一个附带字段转了重问——那一转是整份 spec 重来"
    assert [a.topic for a in (tree.assumptions or [])] == ["审批几级"]
    # ⚠ 2026-08-27 改判：这一行原来断言的是 `== []`，也就是把裸字符串**丢掉**。
    #   那不是"洗干净"，是把模型给的那条备选静静扔了——卡退化成一句"知会
    #   一声"，用户想改都没得点。改抄 grok-build `serde_lenient.rs`：裸字符串
    #   → 单元素列表（口径与判据见 test_lenient_string_list.py）。
    #   逐字符那口仍然堵着：str 走的是"单元素"分支，不是 for 循环。
    assert tree.assumptions[0].alternatives == ["本该是数组"]


def test_一条都没剩就把键删掉_不留空壳():
    """空数组会让前端渲染一个"我替你定了 0 件事"的空面板。"""
    payload = {"assumptions": [{"topic": "  "}, {"decision": "x"}]}
    _sanitize_assumptions(payload)
    assert "assumptions" not in payload

    absent = {"pages": []}
    _sanitize_assumptions(absent)
    assert "assumptions" not in absent


def test_最多三条():
    payload = {"assumptions": [{"topic": f"t{i}", "decision": "d"} for i in range(9)]}
    _sanitize_assumptions(payload)
    assert len(payload["assumptions"]) == 3


# ── 三、接线：第 2 步的出口真的通到 SSE 流上 ─────────────────────


def test_假设在推演还在跑的时候就冲上流(driver):
    """判据是**位置**，不只是"有这个事件"。

    攒到最后随模型一起交，事件同样会出现在列表里——那正是这次要治的病：
    第 2 步（第 1~2 分钟）定死的事，等第 6 步打完孔（十分钟开外）才告诉
    用户，用户唯一能做的只剩整轮重来。所以钉的是它排在 complete 之前。
    """
    def hook():
        sink = sfp._assumption_sink_var.get()
        assert sink is not None, "驱动器没装 sink——这条链一整段静默失效"
        sink(ROWS)

    events = _drive(driver, _seeded_state("sa-1"), hook)

    hits = [e for e in events if e["type"] == "spec_assumption"]
    assert len(hits) == 1
    assert [r["topic"] for r in hits[0]["items"]] == ["店长怎么登录", "审批几级"]
    assert hits[0]["items"][0]["alternatives"] == ["手机号 + 验证码", "企业微信扫码"]

    kinds = [e["type"] for e in events]
    assert kinds.index("spec_assumption") < len(kinds) - 1, "不能攒到最后才发"


def test_管道第二步出口真的调了这个通道(driver, monkeypatch):
    """上一条验的是"驱动器那一半通"，这一条验"管道那一半真的会叫它"。

    ⚠ 只有上一条的话，是本仓第三条的经典形状：sink 装着、泵通着、
      **没有任何地方往里写**，十一条判据全绿而东西没了。
      所以这里真跑一趟 run_spec_first，让它在第 2 步之后自然失败
      （第 2.5 步要调 LLM，测试环境里没有 key），只看第 2 步有没有喊出来。
    """
    got: list = []
    sfp.set_assumption_sink(lambda rows: got.append(list(rows)))
    try:
        import services.spec_tree as spec_tree_mod

        monkeypatch.setattr(
            spec_tree_mod,
            "generate_spec_tree",
            lambda *a, **k: SpecTree.model_validate({**_MIN_SPEC, "assumptions": ROWS}),
        )
        with pytest.raises(Exception):
            sfp.run_spec_first(GOAL)
    finally:
        sfp.set_assumption_sink(None)

    assert got, "第 2 步没把假设交出来——插座通电了但没人往里插"
    assert [r["topic"] for r in got[0]] == ["店长怎么登录", "审批几级"]


def test_没有假设就一个事件都没有(driver):
    """反向：装 sink 这件事本身不判断"有没有假设"，所以"没人叫它"
    就必须是"没有事件"。钉的是没有多余的旁路去发这类事件。"""
    events = _drive(driver, _seeded_state("sa-2"), lambda: None)
    assert [e for e in events if e["type"] == "spec_assumption"] == []


def test_空清单不发事件(driver):
    """模型明确说"我没替你定过什么"（[]）→ 面板一格都不该出现。"""
    def hook():
        sink = sfp._assumption_sink_var.get()
        sink([])

    events = _drive(driver, _seeded_state("sa-3"), hook)
    assert [e for e in events if e["type"] == "spec_assumption"] == []


def test_流开始时装_结束时卸(driver, monkeypatch):
    """不卸的话，本次流之后的调用会往一个没人排水的队列里灌。

    ⚠ 第一版写的是「跑完之后 `sfp._assumption_sink_var.get() is None`」，
      变异（把 finally 里那两行删掉）**照样绿**——因为 ContextVar 是
      请求域的：驱动器在自己那份 context 拷贝里 set，测试这边从头到尾
      读到的都是 None，断言恒真。本仓第三条说的"判据打空"就是这个形状。
      改成记录调用序列：装了什么、卸了没有，两头都咬得住。

    ⚠ 2026-08-27 改：驱动器不再调裸的 `set_assumption_sink`，改成进
      `assumption_sink_scope`（装的那一行自带卸，抄 grok 的 SinkGuard）。
      所以这里记的是**作用域的进和出**——语义没变，还是"装了没有 / 卸了
      没有"，只是从两次函数调用变成一次 with 的两端。
    """
    marks: list = []
    real_scope = sfp.assumption_sink_scope

    @contextlib.contextmanager
    def recording(sink):
        marks.append(("装", sink))
        with real_scope(sink):
            yield
        marks.append(("卸", None))

    monkeypatch.setattr(sfp, "assumption_sink_scope", recording)
    _drive(driver, _seeded_state("sa-4"), lambda: None)

    assert marks, "驱动器一次都没装 sink"
    assert marks[0][0] == "装" and callable(marks[0][1]), "装上去的不是个能叫的东西"
    assert marks[-1][0] == "卸", "流结束了 sink 还挂着——下一轮会往没人排水的队列里灌"


def test_出口炸了不许拖垮推演():
    """本仓第七条：这是增强类。"顺路说一声"不许有能力打死一条已经跑了
    两分钟的链——SSE 队列满、序列化失败，都只该丢掉这一次提示。"""
    def exploding(_rows):
        raise RuntimeError("SSE 队列满了")

    sfp.set_assumption_sink(exploding)
    try:
        sfp._emit_assumptions({"assumptions": ROWS})  # 不抛就算过
    finally:
        sfp.set_assumption_sink(None)

    # sink 没装（脚本方言、老调用方）同样不抛
    sfp._emit_assumptions({"assumptions": ROWS})


_MIN_SPEC = {
    "rootNodeId": "n0",
    "version": 3,
    "appName": "巡检通",
    "personas": [{"id": "u1", "name": "店长", "goals": ["提交巡检单"]}],
    "successCriteria": [{"id": "sc1", "text": "店长 3 分钟内提交完一张巡检单"}],
    "nodes": [
        {
            "id": "n0",
            "parentId": None,
            "type": "requirement",
            "title": "提交巡检单",
            "acceptance": "当店长完成巡检时，系统应生成一张待审批的巡检单。",
            "coversCriteria": ["sc1"],
            "evidenceRefs": [],
        }
    ],
    "pages": [
        {
            "id": "p1",
            "name": "巡检单列表",
            "audience": "店长",
            "purpose": "看自己提交过的巡检单和它们的审批状态",
            "coversNodes": ["n0"],
        }
    ],
}
