"""计划里要写清用到的技能规定的步骤落在这次的哪一步——写成「计划里有什么」，不写成流程命令。

⚠ 2026-10-04 真机 @frontend-design 两轮（咖啡店 sr-20261004015422-02T1R1SA0W、番茄钟 sr-20261004023522-E80W3W0J4R）：
  技能正文都加载了，计划只摘了结论（配色、动效时长），它规定的「设计方案 → 对照需求自查 → 写代码 →
  截图自评」两轮都没有自查；同期 @pptx-deck-context 那轮按决策顺序问了框架、记了来源编号。
  write_plan 说明补上这一条之后，同一句番茄钟需求重跑（sr-20261004025119-AH4YJX296P）的计划多出一节「技能落点」：
  @frontend-design → 第 2、7 步（视觉 token、截图自检），@interaction-design → 第 3、5、7 步。

判据走模型真拿到的那份工具清单（list_control_tools），不读源码常量——改在不通电的插座上照样会红（§一）。
"""

from models.v5_state import V5SessionState
from services import rehearsal_control as rc


def _write_plan_description() -> str:
    state = V5SessionState(sessionId="sr-plan-desc", ownerId="alice", goal={"text": "做一个番茄钟"})
    tools = rc.list_control_tools(state)
    tool = next(t for t in tools if (t.get("function") or {}).get("name") == "write_plan")
    return tool["function"]["description"]


def test_the_plan_asks_where_each_skill_step_lands_and_why_any_is_skipped():
    text = _write_plan_description()
    assert "技能" in text and "哪几步落在这次的哪一步" in text
    assert "跳过的写为什么" in text


def test_it_is_stated_as_plan_content_not_as_a_procedure():
    """反向：本仓的边界——写成「计划里有什么」，不许写成「你必须先…再…」的流程命令（_system_prompt 头注）。"""
    text = _write_plan_description()
    for command in ("必须先", "必须按", "严格按照", "一步一步"):
        assert command not in text
