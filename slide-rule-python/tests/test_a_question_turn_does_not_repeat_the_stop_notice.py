"""问个问题的一轮，不把上一轮收尾那句缺项通知再说一遍。

⚠ 2026-09-29 隔离真机第 124 轮 sr-20260929131613-S9YHENH029（喝水记录网页）：追问「这些数据存在哪里？我换一台电脑还能看到吗？」，
  模型一个工具没调、照实答了 localStorage；宿主又补「这一轮还没有达到可交付：独立浏览器验收没能在这个
  环境里跑起来……再说『继续』也跑不起来」——跟上一轮收尾一字不差。

判据走真 ControlRunService，同一会话提交两轮，缺项是那一轮的原样（只剩环境项）。
把 service 里 _repeats_last_notice 的判断拿掉（照旧 append），第一条变红。
"""

from __future__ import annotations

import asyncio

from control_turn_support import llm_text, six_fields
from services import rehearsal_control as control
from services.control_run_service import ControlRunService
from test_control_run_service import env, settled  # noqa: F401  （夹具）

ROUND124_BLOCKED = ["project_verification_environment_blocked"]
QUESTION = "这些数据存在哪里？我换一台电脑还能看到吗？"


def _notices(record):
    return [e["text"] for e in record["events"]
            if e.get("type") == "control_text" and e.get("stopReason") == "goal_not_delivered"]


def _two_turns(env, monkeypatch, blocked_by_turn):
    async def model(messages, **kwargs):
        return llm_text("数据保存在当前浏览器的 localStorage 里，换一台电脑不会自动看到。")
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    turn = {"n": 0}

    async def reasons(self, record):
        return list(blocked_by_turn[min(turn["n"], len(blocked_by_turn) - 1)])
    monkeypatch.setattr(ControlRunService, "_goal_blocked_reasons", reasons)

    async def run():
        service = env.service()
        await service.start()
        try:
            first = await service.submit(six_fields(env.state.sessionId, "批准计划并执行"), env.owner, "first")
            first = await settled(service, first["runId"])
            turn["n"] = 1
            second = await service.submit(six_fields(env.state.sessionId, QUESTION), env.owner, "question")
            second = await settled(service, second["runId"])
            return first, second
        finally:
            await service.shutdown()
    return asyncio.run(run())


def test_the_round124_question_turn_is_not_told_the_same_thing_twice(env, monkeypatch):
    first, second = _two_turns(env, monkeypatch, [ROUND124_BLOCKED])
    assert _notices(first), "前提：上一轮收尾说过缺项"
    assert second["status"] == "waiting_user"                 # 没交付照旧不记完成
    assert not _notices(second), _notices(second)


def test_a_changed_blocker_is_said_again(env, monkeypatch):
    """反向：缺项变了（新的话），照说。"""
    first, second = _two_turns(env, monkeypatch, [ROUND124_BLOCKED, ["project_verification_required"]])
    assert _notices(first) and _notices(second) and _notices(first)[-1] != _notices(second)[-1]


def test_a_turn_that_did_something_says_it_again_even_if_the_words_match():
    """反向：这一轮动过工具（哪怕结论一样），收尾照说——它刚做了事，用户要知道结果。"""
    from services.control_goal_continuation import undelivered_notice
    notice = undelivered_notice(ROUND124_BLOCKED)

    class Store:
        def previous(self, run_id, owner_id):
            return {"events": [{"type": "control_text", "text": notice, "stopReason": "goal_not_delivered"}]}

    service = ControlRunService.__new__(ControlRunService)
    service.store = Store()
    worked = {"runId": "r2", "ownerId": "o", "events": [{"type": "control_tool_result", "tool": "file_str_replace"}]}
    idle = {"runId": "r2", "ownerId": "o", "events": [{"type": "control_text", "text": "答了一个问题"}]}
    assert asyncio.run(service._repeats_last_notice(worked, notice)) is False
    assert asyncio.run(service._repeats_last_notice(idle, notice)) is True



# ⚠ 2026-09-30 隔离真机第 138 轮 sr-20260930025424-FMGS3825MJ（便签墙，追问「刷新页面后撤销记录还在吗？」）：为了答准，模型先
#   project_search、project_read ×2 看了代码。上一版只认「一个工具都没调」，照样重复缺项。只读查看跟没调一样。
#   把 _repeats_last_notice 里 READ_ONLY_TOOLS 那一判换回「有任何工具结果就照说」，下面这条变红。
def test_the_round138_read_only_lookups_do_not_count_as_doing_something():
    from services.control_goal_continuation import undelivered_notice
    notice = undelivered_notice(ROUND124_BLOCKED)

    class Store:
        def previous(self, run_id, owner_id):
            return {"events": [{"type": "control_text", "text": notice, "stopReason": "goal_not_delivered"}]}

    service = ControlRunService.__new__(ControlRunService)
    service.store = Store()
    looked = {"runId": "r3", "ownerId": "o", "events": [
        {"type": "control_tool_result", "tool": "project_search"},
        {"type": "control_tool_result", "tool": "project_read"},
        {"type": "control_tool_result", "tool": "project_read"},
        {"type": "control_text", "text": "刷新页面后，撤销记录不会保留。"}]}
    assert asyncio.run(service._repeats_last_notice(looked, notice)) is True
