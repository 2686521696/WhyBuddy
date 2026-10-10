"""网页工程的技术栈由批准的计划定，不由工具描述定。

⚠ 2026-10-10 用户：「目前看着默认是 react_vite 工程，我们目前用的微软镜像，支持任意语言，这块再审查下，
  看看是不是有写死的地方」。编排正确性第 3 条。查下来写死在四处：
    · project_create 的描述：「For a web-app plan it is a React/TypeScript/Vite project」；
    · templateId 只有 react-vite / react-vite-tasks 两个选项，「react-vite 用于每一个网页」；
    · 控制面提示：「react-vite 仅是网页的最小电脑」；
    · 计划里从来不写栈——栈是执行时工具描述替它定的。
  计划写 Django，模型也只能先拿一份 Vite 脚手架，再在上面自己铺。

现在：计划写清技术栈；templateId=blank 是不带任何框架的空工作区；描述说「按计划点的栈选」。
没有 package.json 又没给启动命令时，开沙盒之前就说清要给命令（原来落到 Vite 配方，开完箱才失败）。

判据走真的 list_control_tools / create_session_project / supervisor.submit。每条正向配一条反向（§3）。
变异见各条 docstring。
"""
from __future__ import annotations

import pytest

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import persistence
from services import rehearsal_control as rc
from services.project_creation import (BLANK_TEMPLATE_VERSION, BLANK_WEB_README, TEMPLATE_VERSION, create_session_project,
                                       load_project_template)
from services.project_runtime_worker import START_COMMAND_REQUIRED, approved_reference
from services.project_store import ProjectStore
from services.project_tools import tool_error
from project_actor_support import project_actor  # noqa: F401  (fixture)
from test_project_runtime_worker import setup  # noqa: F401  (fixture)


def _web_plan_state(sid="s-stack", text="用 Django 做一个读书打卡网站") -> V5SessionState:
    return V5SessionState.server_load({
        "sessionId": sid, "ownerId": "alice", "goal": {"text": text, "status": "clear"},
        "controlTranscript": approved_plan_rows(text)})


@pytest.fixture
def project_tools_on():
    token = rc._PROJECT_TOOLS.set(object())
    yield
    rc._PROJECT_TOOLS.reset(token)


def _offered_create(state):
    listed = rc.list_control_tools(state)
    return next(t for t in listed if t["function"]["name"] == "project_create")["function"]


def test_the_offered_create_lets_the_plan_pick_any_stack(project_tools_on):
    """变异：templateId 去掉 blank → 第一句红；描述改回「web-app 就是 React/TypeScript/Vite project」→ 第三句红。"""
    fn = _offered_create(_web_plan_state())
    field = fn["parameters"]["properties"]["templateId"]
    assert "blank" in field["enum"]
    assert "plan names" in field["description"] and "Django" in field["description"]
    assert "For a web-app plan it is a React/TypeScript/Vite project" not in fn["description"]
    assert "stack the plan names" in fn["description"]


def test_write_plan_asks_for_the_stack():
    """计划里得写栈，执行时才有东西可照。变异：删掉 write_plan 描述里那句 → 红。"""
    state = V5SessionState(sessionId="s-plan", goal={"text": "用 Django 做一个读书打卡网站", "status": "clear"})
    tool = next(t for t in rc.list_control_tools(state) if t["function"]["name"] == "write_plan")
    assert "技术栈" in tool["function"]["description"]


def test_the_project_prompt_no_longer_says_a_web_project_is_react(project_tools_on):
    prompt = rc._system_prompt(_web_plan_state())
    assert "react-vite 仅是网页的最小电脑" not in prompt
    assert "templateId=blank" in prompt


@pytest.fixture
def creation(tmp_path, monkeypatch, project_actor):
    project_actor("alice")
    monkeypatch.chdir(tmp_path)
    from services.session_blob_store import SqlSessionBlobStore
    blobs = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: blobs)
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    yield store
    store.close()
    blobs._engine.dispose()


def _approved(sid):
    state = _web_plan_state(sid)
    assert persistence.save_session_record(state, server_write=True)["ok"]
    return state, approved_reference(state)


def test_a_blank_web_workspace_has_no_framework(creation):
    store = creation
    state, ref = _approved("s-blank")
    project = create_session_project(store, state.sessionId, owner_id="alice", approval_ref=ref, template_id="blank")
    files = store.read_files(project.projectId, owner_id="alice")
    assert store.get_revision(project.projectId, owner_id="alice").templateVersion == BLANK_TEMPLATE_VERSION
    assert files == {"README.md": BLANK_WEB_README}


def test_the_model_s_blank_wins_over_an_untouched_vite_the_browser_made_first(creation):
    """批准一落浏览器先建了 react-vite；模型照计划点 blank、工程还一字没动 → 换成空工作区。反过来也一样。
    变异：TEMPLATE_ID_FOR_VERSION 里不登记 blank → 最后一句红（认不出「生成时是 blank」，就不换回去）。"""
    store = creation
    state, ref = _approved("s-race")
    first = create_session_project(store, state.sessionId, owner_id="alice", approval_ref=ref)   # 浏览器那条：缺省模板
    assert store.get_revision(first.projectId, owner_id="alice").templateVersion == TEMPLATE_VERSION
    create_session_project(store, state.sessionId, owner_id="alice", approval_ref=ref, template_id="blank",
                           template_chosen_by_model=True)
    assert store.get_revision(first.projectId, owner_id="alice").templateVersion == BLANK_TEMPLATE_VERSION
    assert "package.json" not in store.read_files(first.projectId, owner_id="alice")
    # 反过来：模型改主意点回 react-vite，空工作区还一字没动 → 换回 Vite 起步
    create_session_project(store, state.sessionId, owner_id="alice", approval_ref=ref, template_id="react-vite",
                           template_chosen_by_model=True)
    assert store.get_revision(first.projectId, owner_id="alice").templateVersion == TEMPLATE_VERSION


def test_no_command_on_a_project_without_package_json_is_refused_before_a_sandbox_opens(setup):
    """变异：去掉 submit 里那道 package.json 检查 → 第一段红（排进队、开箱后才失败）。"""
    store, _vite_project, provider, make_worker, _ = setup
    blank_files, version = load_project_template("blank")
    blank = store.create_project("session-blank", owner_id="alice", files=blank_files,
                                 template_version=version, plan_ref="plan-1")
    worker = make_worker()
    with pytest.raises(ValueError, match=START_COMMAND_REQUIRED):
        worker.submit(blank.projectId, owner_id="alice", expected_revision=blank.currentRevision,
                      approval_ref="plan-1", idempotency_key="no-command")
    assert not provider.created
    assert tool_error(START_COMMAND_REQUIRED).get("hint", "").find("deploy_expose_port") >= 0
    # 反向：带了命令照常排队；有 package.json 的 Vite 工程不带命令也照常排队
    assert worker.submit(blank.projectId, owner_id="alice", expected_revision=blank.currentRevision,
                         approval_ref="plan-1", idempotency_key="with-command",
                         command="python3 -m http.server 8000").kind == "runtime.start"
    vite = _vite_project
    assert worker.submit(vite.projectId, owner_id="alice", expected_revision=vite.currentRevision,
                         approval_ref="plan-1", idempotency_key="vite").kind == "runtime.start"
