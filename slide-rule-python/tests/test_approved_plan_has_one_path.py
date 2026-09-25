"""计划批准后只有一条路：沙盒。五系统工厂不在这条闭环里。

⚠ 2026-09-25 luna 隔离真机 sr-20260925011309-62DQZAH83G：PPT 计划批准后、
  project_create 之前，runtimeKind 还是 html-prototype。那一发给模型的清单
  （后端日志 `[control] … offered=[…]`，15 件）里 workflow / rehearse / spec
  跟 project_create 并排，模型挑了 workflow(structure-bind)，四跳 SPEC 0、
  页面 0，一条沙盒命令都没跑。上一轮同一话题挑的是 project_create，7 分钟交付。

判据走真的 list_control_tools 和 _dispatch_tool，不直接调闸函数。
把 _project_tool_error 里的 `or _plan_runs_in_sandbox(state)` 删掉，前两条变红。
"""

from __future__ import annotations

import asyncio

import pytest

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import rehearsal_control as rc
from services.closed_tools import TOOL_SCOPE, ToolScope
from services.deliverable_kind import OFFICE_FILE

FACTORY_WRITE = sorted(k for k, v in TOOL_SCOPE.items() if v == ToolScope.WRITE)


def _approved(kind=None) -> V5SessionState:
    rows = (approved_plan_rows("做一份 PPT", deliverable_kind=kind)
            if kind else approved_plan_rows("做一个待办网页"))
    return V5SessionState.server_load({
        "sessionId": "s-one-path", "ownerId": "alice",
        "goal": {"text": "做一份 PPT", "status": "clear"},
        "controlTranscript": rows,
    })


@pytest.fixture
def project_tools_on():
    token = rc._PROJECT_TOOLS.set(object())
    yield
    rc._PROJECT_TOOLS.reset(token)


def _offered(state) -> set[str]:
    return {t["function"]["name"] for t in rc.list_control_tools(state)}


@pytest.mark.parametrize("kind", [OFFICE_FILE, None])
def test_after_approval_only_the_sandbox_is_offered(project_tools_on, kind):
    state = _approved(kind)
    assert state.runtimeKind == "html-prototype"  # 真机那一刻：工程还没建
    offered = _offered(state)
    assert "project_create" in offered
    assert not (offered & set(FACTORY_WRITE)), sorted(offered & set(FACTORY_WRITE))


def test_dispatching_a_factory_tool_after_approval_is_refused(project_tools_on):
    state = _approved(OFFICE_FILE)

    async def run():
        return [ev async for ev in rc._dispatch_tool(
            "workflow", {"name": "structure-bind"}, state, "", [], [], "desktop", None, "")]

    events = asyncio.run(run())
    result = next(ev for ev in events if ev["type"] == "control_tool_result")
    assert result["ok"] is False
    assert result["error"] == "project_html_factory_not_supported"


def test_html_mode_without_project_tools_keeps_the_factory():
    """反向：没有工程能力（纯 HTML 推演部署），批准后工厂照常可用。"""
    assert rc._PROJECT_TOOLS.get() is None
    offered = _offered(_approved(OFFICE_FILE))
    assert "rehearse" in offered or "workflow" in offered, sorted(offered)


def test_the_offered_project_create_says_it_is_the_office_tool(project_tools_on):
    """办公计划批准后，模型看到的 project_create 必须说清它就是办公文件那台电脑。

    ⚠ 2026-09-25 第三轮真机 sr-20260925020530-S3ZKS8EM8P：工厂挡掉之后，清单里
      project_create 的描述第一句是「React/TypeScript/Vite project」。模型回
      「当前工具集中没有可用于创建或导出 .pptx 文件的办公文件工具，只有网页
      工程创建能力」，一跳没动就收工。盯语义：描述里要讲到办公文件、要讲到
      写出的文件就是交付物。把描述改回只讲 React 项目，本条变红。
    """
    listed = rc.list_control_tools(_approved(OFFICE_FILE))
    desc = next(t for t in listed if t["function"]["name"] == "project_create")["function"]["description"]
    assert ".pptx" in desc
    assert "deliverable" in desc
    assert "empty workspace" in desc or "office-file plan" in desc


def test_the_offered_project_create_makes_react_vite_the_web_default(project_tools_on):
    """⚠ 2026-09-25 隔离真机 sr-20260925053053-T4TJXXCW0Z：记账网页选了
    react-vite-tasks，交付被锁在任务清单验收上，永远交不了。模型看到的描述与
    参数说明都要讲清：react-vite 是任何网页（含浏览器本地存储）的默认；任务模板
    选错的后果是永远交付不了。盯语义，把描述改回「a minimal computer」本条变红。"""
    listed = rc.list_control_tools(_approved())
    fn = next(t for t in listed if t["function"]["name"] == "project_create")["function"]
    desc = fn["description"]
    field = fn["parameters"]["properties"]["templateId"].get("description", "")
    for text in (desc, field):
        assert "default" in text and "localStorage" in text
        assert "never be delivered" in text
    assert "minimal computer" not in desc
