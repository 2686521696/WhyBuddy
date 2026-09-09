"""第 7 格：同一个老师傅，更像老师傅。

抄 grok-build：complete the request；工具描述自己干什么，不教课表；
host 跑完一件再挑下一件；NeedPermission 不管产品形态。

每条都有反向。变异：把手册句子加回 tool description / 把四跳焊回一次
handoff / 把「在哪用」写回 system → 对应条红。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from control_turn_support import (
    PY_ROOT,
    ControlHarness,
    event_types,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from models.v5_state import V5SessionState
from services.rehearsal_control import (
    CONTROL_TOOLS,
    POST_WRITE_FALLBACK,
    TOOL_PERMISSION,
    _system_prompt,
    list_control_tools,
    should_list_tool,
)

pytest.importorskip("fastapi")

_RC = PY_ROOT / "services" / "rehearsal_control.py"
SYLLABUS = (
    "下一跳请挑",
    "不要一次把后面全跑完",
    "跑完交回来再挑下一跳",
    "选项必须带",
    "先用 clarify",
)


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _tool_description(name: str) -> str:
    for item in CONTROL_TOOLS:
        fn = item.get("function") or {}
        if fn.get("name") == name:
            return str(fn.get("description") or "")
    raise AssertionError(f"missing tool {name}")


class Test提示词不教课表:
    def test_system_is_complete_the_request(self):
        text = _system_prompt(
            V5SessionState(
                sessionId="p7-sys",
                goal={"text": "做个水果店收银台", "status": "clear"},
            )
        )
        assert "把这件事做完" in text
        assert "水果店收银台" in text
        for banned in ("还没读到", "在哪用", "产品类型", "请先选择", "已经问过一轮"):
            assert banned not in text, banned

    def test_tool_catalog_is_not_a_syllabus(self):
        src = strip_python(_RC)
        for banned in SYLLABUS:
            assert banned not in src, banned
        for name in ("rehearse", "spec", "pages", "structure", "bind", "refine"):
            desc = _tool_description(name)
            for banned in SYLLABUS:
                assert banned not in desc, (name, banned)

    def test_scope_card_does_not_advertise_type_or_device_gate(self):
        desc = _tool_description("scope_card")
        assert "不当门禁" in desc
        assert "设备/类型" not in desc


class Test批准不管产品形态:
    def test_product_type_is_not_a_permission(self):
        """NeedPermission 只管写模型。产品类型 / 设备不在批准表里。"""
        assert "productArchetype" not in TOOL_PERMISSION
        assert "preferredDevice" not in TOOL_PERMISSION
        for name in ("spec", "pages", "rehearse"):
            assert name in TOOL_PERMISSION

    def test_clarify_is_not_on_the_catalog(self):
        """clarify 2026-09-09 整件退役，不只是「不列出」。

        ⚠ 上一版断言 `should_list_tool("clarify", …) is False`——那是靠
          `TOOL_LIST_WHEN` 里一条 `lambda st: False` 把它按住。工具本体退役
          之后那条谓词也没了，`should_list_tool` 对没声明的名字**默认放行**，
          于是这条断言会红——但它红得没有道理：目录里根本没有这件工具了。
          改成直接问目录，这才是「模型能不能看见它」的真判据。
        """
        state = V5SessionState(
            sessionId="p7-clar",
            goal={"text": "做个水果店收银台", "status": "clear"},
        )
        names = {
            ((t.get("function") or {}).get("name"))
            for t in list_control_tools(state)
        }
        assert "clarify" not in names
        # 反向：目录没被读空，真产品会话该有的工具还在
        assert "scope_card" in names or "spec" in names


class Test真产品第一句不许再考功能:
    def test_fruit_shop_lists_scope_card_on_empty_goal(self):
        """真机载荷：goal 空，当前句是做个水果店收银台。"""
        st = V5SessionState(
            sessionId="p7-live-list",
            goal={"text": "", "status": "needs_refinement"},
            controlTranscript=[
                {"role": "user", "kind": "turn", "text": "做个水果店收银台"},
            ],
        )
        names = {
            ((t.get("function") or {}).get("name"))
            for t in list_control_tools(st)
        }
        assert "scope_card" in names
        assert "clarify" not in names

    def test_hello_still_does_not_list_scope_card(self):
        st = V5SessionState(
            sessionId="p7-hello-list",
            goal={"text": "", "status": "needs_refinement"},
            controlTranscript=[{"role": "user", "kind": "turn", "text": "hello"}],
        )
        names = {
            ((t.get("function") or {}).get("name"))
            for t in list_control_tools(st)
        }
        # ⚠ 清单不再猜意图（2026-09-09 照 grok 改：`Tool::should_list` 在 grok 全仓只被覆写 3 次、全在管道层，`ListToolsContext` 里根本没有用户消息）。保证挪到了分发那层：没有真产品就不画卡、改成再问一句——**模型硬挑 scope_card 也挡得住**，比「菜单里不摆」更强。
        #   「你好不许得到一张卡」这条保证仍然钉着，见
        #   `test_cheap_followup_is_not_a_product` 里的分发判据。
        assert "scope_card" in names
        assert "ask_user" in names

    def test_fruit_shop_ask_user_is_redirected_to_restatement(self, harness):
        """真机 sr-20260909041801：模型问核心功能。不许 park 那张考卷。

        变异：ask_user 分支不再看 `_unstamped_product_turn` → 本条红。
        """
        sid = new_sid("p7-fruit-ask")
        seed_session(sid, goal={"text": "", "status": "needs_refinement"})
        harness.llm_impl = lambda messages, **kw: llm_tool(
            "ask_user",
            {
                "question": (
                    "请问这个水果店收银台需要包含哪些核心功能，例如："
                    "商品录入与管理、条形码扫描、称重计价、会员积分、还是打印小票？"
                )
            },
        )
        _, events = harness.post(six_fields(sid, "做个水果店收银台"))
        types = event_types(events)
        assert "control_ask_user" not in types, types
        assert "control_scope_card" in types, types
        assert harness.helper_calls == []
        card = next(e for e in events if e.get("type") == "control_scope_card")
        blob = str(card.get("restatement") or "") + str(card)
        assert "核心功能" not in blob
        assert "Web 后台" not in blob


class TestHost自己挑下一跳:
    def test_fruit_shop_does_not_ask_type_or_device(self, harness):
        """人话进环。有产品话题就复述，不许被我们改成类型门。"""
        sid = new_sid("p7-fruit-talk")
        seed_session(
            sid,
            goal={"text": "做个水果店收银台", "status": "needs_refinement"},
        )
        harness.llm_impl = lambda messages, **kw: llm_tool(
            "scope_card",
            {"restatement": "街边水果店收银台，称重改价结账。"},
        )
        _, events = harness.post(six_fields(sid, "做个水果店收银台"))
        types = event_types(events)
        assert "control_scope_card" in types
        assert "control_clarify" not in types
        card = next(e for e in events if e.get("type") == "control_scope_card")
        blob = str(card)
        assert "Web 后台" not in blob
        assert "请先选择" not in blob

    def test_host_picks_remaining_hops_one_at_a_time(self, harness):
        """开始推演只点火 spec。交回后 host 按模型挑 pages → structure → bind。
        四件不许焊在同一次 handoff 里。"""
        sid = new_sid("p7-hops")
        seed_session(
            sid,
            goal={"text": "水果店收银台", "status": "clear"},
            awaitReason="control_scope",
            awaitDetail="水果店收银台",
        )
        picked: list[str] = []

        def impl(messages, **kw):
            n = len(harness.llm_calls)
            if n == 1:
                picked.append("pages")
                return llm_tool("pages", {}, call_id="h-pages")
            if n == 2:
                picked.append("structure")
                return llm_tool("structure", {}, call_id="h-structure")
            if n == 3:
                picked.append("bind")
                return llm_tool("bind", {}, call_id="h-bind")
            return llm_text("页面已经出来。要改哪一页，或者说继续精修、补齐缺口。")

        harness.llm_impl = impl
        _, events = harness.post(
            six_fields(sid, "将做成：水果店收银台", forcedTool="rehearse")
        )
        tools = [c.get("goal_tools") for c in harness.helper_calls]
        assert tools[0] == ["spec"], tools
        assert ["pages"] in tools, tools
        assert ["structure"] in tools, tools
        assert ["bind"] in tools, tools
        for batch in tools:
            assert list(batch or []) != [
                "spec",
                "pages",
                "structure",
                "bind",
            ], f"课表又焊回来了：{tools}"
        texts = [
            str(e.get("text") or "")
            for e in events
            if e.get("type") == "control_text"
        ]
        blob = "\n".join(texts)
        assert "没点火" not in blob
        assert "额度用完" not in blob
        assert POST_WRITE_FALLBACK in blob or "页面已经出来" in blob
        assert picked == ["pages", "structure", "bind"], picked
        assert types_ok(events)


def types_ok(events) -> bool:
    types = event_types(events)
    assert types[-1] == "complete"
    assert "control_handoff_factory" in types
    return True
