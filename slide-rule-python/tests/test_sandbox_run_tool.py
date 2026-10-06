"""对话档临时沙盒（sandbox_run）：没有工程也能跑技能自带的脚本。

⚠ 2026-10-06 真机 r41 sr-20261006075045-XT7WJ8NCP5（@ui-ux-pro-max 宠物医院小程序配色）：技能写明先跑
  scripts/search.py 查设计库，直接回答的回合没有任何能执行代码的工具，模型凭经验给色值（services/scratch_sandbox 头注）。
技能包用仓库里真的种子（ui-ux-pro-max，含 scripts/search.py），命令照它 SKILL.md 给的写法；走真 HTTP（ControlHarness）。
沙盒提供方换成内存里的假的：E2B 不进单测，记下「起了几个、写了什么、跑了什么」。
"""

from __future__ import annotations

import copy
import json

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from models.v5_state import V5SessionState
from services import rehearsal_control as control
from services.scratch_sandbox import ScratchSandboxes
from services.skill_catalog_store import local_seed_files, local_seed_skill_info
from services.workspace_provider import ProcessResult, WorkspaceHandle

TOPIC = "@ui-ux-pro-max 给一个宠物医院预约小程序的首页推荐配色和字体，给出具体色值和理由就行，不用做页面"
SCRIPT = ".sliderule/skills/ui-ux-pro-max/scripts/search.py"
COMMAND = f'python3 {SCRIPT} "pet clinic booking mini program" --design-system'


class FakeProvider:
    def __init__(self):
        self.created, self.files, self.commands = [], {}, []

    def find_workspaces(self, *, workspace_id):
        return [h for h in self.created if h.workspace_id == workspace_id]

    def create(self, *, workspace_id, template=None, timeout_seconds=900):
        handle = WorkspaceHandle(workspace_id, f"sbx-{len(self.created)}")
        self.created.append(handle)
        return handle

    def connect(self, handle, *, timeout_seconds=900):
        return handle

    def write_files(self, handle, files):
        self.files.update(files)

    def run(self, handle, command, *, timeout_seconds=60):
        self.commands.append(command)
        if SCRIPT in command and SCRIPT in self.files:
            return ProcessResult(stdout="PRIMARY #0F766E  ACCENT #F97316  FONT Nunito", exit_code=0)
        return ProcessResult(stderr=f"python3: can't open file '{SCRIPT}'", exit_code=2)

    def renew(self, handle, *, timeout_seconds=900):
        pass


@pytest.fixture
def setup(monkeypatch):
    provider = FakeProvider()
    monkeypatch.setattr(control, "_scratch_sandboxes", lambda: sandboxes)
    sandboxes = ScratchSandboxes(provider)
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [local_seed_skill_info("ui-ux-pro-max")])
    monkeypatch.setattr(control, "installed_skill_files", lambda owner, slug: None)   # 商店取不到 → 种子兜底
    return ControlHarness(monkeypatch), provider


def _turn(harness, steps):
    seen, tools, it = [], [], iter(steps)

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        tools.append([t["function"]["name"] for t in kw.get("tools") or []])
        return next(it)
    harness.llm_impl = impl
    sid = new_sid("scratch")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    _, events = harness.post(six_fields(sid, TOPIC))
    return seen, tools, events


def _tool_reply(seen, call_id):
    return next(m for m in seen[-1] if m.get("role") == "tool" and m.get("tool_call_id") == call_id)["content"]


def test_the_skill_script_runs_and_its_output_reaches_the_model(setup):
    harness, provider = setup
    seen, tools, _ = _turn(harness, [
        llm_tool("skill", {"name": "ui-ux-pro-max"}, call_id="s-1"),
        llm_tool("sandbox_run", {"command": COMMAND}, call_id="r-1"),
        llm_text("按设计库给的主色 #0F766E……"),
    ])
    assert "sandbox_run" in tools[0] and "shell_exec" not in tools[0]          # 没有工程：摆的是临时沙盒
    assert provider.files[SCRIPT] == local_seed_files("ui-ux-pro-max")["scripts/search.py"]  # 真脚本写进去了
    back = json.loads(_tool_reply(seen, "r-1"))
    assert back["ok"] is True and "#0F766E" in back["stdout"] and back.get("sandboxStarted") is True


def test_one_sandbox_per_session_reused_and_skills_written_once(setup):
    harness, provider = setup
    _turn(harness, [
        llm_tool("skill", {"name": "ui-ux-pro-max"}, call_id="s-1"),
        llm_tool("sandbox_run", {"command": COMMAND}, call_id="r-1"),
        llm_tool("sandbox_run", {"command": "ls .sliderule/skills"}, call_id="r-2"),
        llm_text("好。"),
    ])
    assert len(provider.created) == 1 and len(provider.commands) == 2


def test_a_failing_command_is_reported_not_dressed_up(setup):
    """反向：脚本跑不起来就是跑不起来——照实交回退出码和 stderr（§七）。"""
    harness, provider = setup
    seen, _, _ = _turn(harness, [
        llm_tool("sandbox_run", {"command": "python3 missing.py"}, call_id="r-1"),
        llm_text("脚本没跑起来。"),
    ])
    back = json.loads(_tool_reply(seen, "r-1"))
    assert back["ok"] is False and back["exitCode"] == 2 and "can't open file" in back["stderr"]


def test_not_offered_with_a_project_or_without_a_sandbox_provider(monkeypatch):
    state = V5SessionState(sessionId="sr-scratch-x", ownerId="alice", goal={"text": TOPIC})
    monkeypatch.setattr(control, "_scratch_sandboxes", lambda: ScratchSandboxes(FakeProvider()))
    assert control.should_list_tool("sandbox_run", state)
    state.projectId, state.runtimeKind = "prj-1", "project"
    assert not control.should_list_tool("sandbox_run", state)                 # 有工程用 shell_exec
    state.projectId = None
    monkeypatch.setattr(control, "_scratch_sandboxes", lambda: None)
    assert not control.should_list_tool("sandbox_run", state)                 # 没配 E2B 就不摆


def test_the_provider_comes_from_the_injected_runtime():
    """真路径：沙盒提供方取注入的 ProjectTools.supervisor.provider（control 组不许直接 import workspace 组）。"""
    from types import SimpleNamespace
    provider = FakeProvider()
    token = control._PROJECT_TOOLS.set(SimpleNamespace(supervisor=SimpleNamespace(provider=provider)))
    try:
        got = control._scratch_sandboxes()
        assert got is not None and got.provider is provider and control._scratch_sandboxes() is got   # 同一份复用
    finally:
        control._PROJECT_TOOLS.reset(token)
    token = control._PROJECT_TOOLS.set(SimpleNamespace(supervisor=SimpleNamespace(provider=None)))
    try:
        assert control._scratch_sandboxes() is None                            # 没有沙盒提供方 → 不摆
    finally:
        control._PROJECT_TOOLS.reset(token)
