"""工程电脑带齐常用语言：网页 / 后端工程开箱用全家桶镜像，模型看到的「电脑上有什么」跟实装一致。

⚠ 2026-10-09：工程电脑只有 E2B 默认镜像——真沙盒里逐个 command -v：Python 3.13、Node 20、gcc、Java 11，
  Go / PHP / Ruby / .NET / Rust / Maven 全都没有。通用 Agent 接到「Go 写个短链服务」「Laravel 后台」，
  电脑上连编译器都没有，而模型以为什么都有（提示里只有一句「保证语言运行时」）。
  scripts/build_workspace_e2b_template.py 建的那张镜像 2026-10-09 在真 E2B 上建过、verify 过，十三条命令都在。

判据：
- 真工人开箱：网页工程拿全家桶镜像，办公工作区仍是办公镜像，没配就是默认（不许因为少一张镜像开不了箱）；
- 模型看到的那句话按真用的镜像说：配了说全家桶，没配照实说缺什么；办公工作区不说这句；
- 那句话跟构建脚本装的清单成对（§4）：脚本里确认的每条命令，话里都点了名。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from models.v5_state import V5SessionState
from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import rehearsal_control as control
from services.deliverable_kind import (
    DEFAULT_TOOLCHAINS_FACT, WORKSPACE_TEMPLATE_VERSION, WORKSPACE_TOOLCHAINS_FACT, office_workspace_files,
)
from test_project_command_worker import command_setup, submit  # noqa: F401  （夹具）
from test_project_runtime_worker import eventually, setup, state  # noqa: F401  （夹具）

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_workspace_e2b_template.py"


def _build_script():
    spec = importlib.util.spec_from_file_location("build_workspace_e2b_template", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ── 真工人开箱用哪张镜像 ─────────────────────────────────────────────────────────────────────────

def test_web_projects_boot_the_any_language_image(command_setup, monkeypatch):  # noqa: F811
    monkeypatch.setenv("WHYBUDDY_WORKSPACE_E2B_TEMPLATE", "whybuddy-workspace")
    monkeypatch.setenv("WHYBUDDY_OFFICE_E2B_TEMPLATE", "whybuddy-office")
    store, project, provider, worker, _ = command_setup
    web = submit(worker, project, command="check", key="web-image")
    assert eventually(lambda: state(store, web, "stopped")).status == "completed"
    office = store.create_project("session-office-any-language", owner_id="alice", files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    op = worker.submit_command(office.projectId, owner_id="alice", expected_revision=office.currentRevision,
        approval_ref="plan-1", idempotency_key="office-image", command="shell", script="python3 --version")
    assert eventually(lambda: state(store, op, "stopped")).status == "completed"
    assert provider.templates == ["whybuddy-workspace", "whybuddy-office"]       # 办公仍是办公那张


def test_without_the_image_configured_the_web_project_still_boots(command_setup, monkeypatch):  # noqa: F811
    monkeypatch.delenv("WHYBUDDY_WORKSPACE_E2B_TEMPLATE", raising=False)
    store, project, provider, worker, _ = command_setup
    web = submit(worker, project, command="check", key="web-default-image")
    assert eventually(lambda: state(store, web, "stopped")).status == "completed"
    assert provider.templates == [None]


# ── 模型看到的那句话 ────────────────────────────────────────────────────────────────────────────

def _project_session(kind="web-app"):
    plan = {"planId": "plan-go", "revision": 1, "planContent": "用 Go 写一个短链服务", "deliverableKind": kind}
    return V5SessionState(sessionId="sr-any-language", ownerId="alice", runtimeKind="project", projectId="prj-1",
        goal={"text": "用 Go 写一个短链服务", "status": "clear"},
        controlTranscript=[{**plan, "kind": "plan_written", "role": "assistant", "text": plan["planContent"]}])


def test_the_model_is_told_what_this_computer_really_has(monkeypatch):
    monkeypatch.setenv("WHYBUDDY_WORKSPACE_E2B_TEMPLATE", "whybuddy-workspace")
    prompt = control._system_prompt(_project_session())
    assert WORKSPACE_TOOLCHAINS_FACT in prompt and DEFAULT_TOOLCHAINS_FACT not in prompt
    monkeypatch.delenv("WHYBUDDY_WORKSPACE_E2B_TEMPLATE")
    prompt = control._system_prompt(_project_session())
    assert DEFAULT_TOOLCHAINS_FACT in prompt and WORKSPACE_TOOLCHAINS_FACT not in prompt   # 没配就照实说缺什么
    assert "没有 Go" in prompt


def test_office_workspaces_are_not_told_about_compilers(monkeypatch):
    monkeypatch.setenv("WHYBUDDY_WORKSPACE_E2B_TEMPLATE", "whybuddy-workspace")
    prompt = control._system_prompt(_project_session(kind="office-file"))
    assert WORKSPACE_TOOLCHAINS_FACT not in prompt and DEFAULT_TOOLCHAINS_FACT not in prompt


def test_the_sentence_names_every_command_the_image_build_checks():
    """§4：镜像装的和模型被告知的是一张清单。构建脚本多确认一条命令、话里没提，本条红。"""
    module = _build_script()
    missing = [cmd for cmd in module.EXPECTED_COMMANDS if cmd not in WORKSPACE_TOOLCHAINS_FACT]
    assert missing == [], missing
    assert module.ALIAS == "whybuddy-workspace"                                  # 跟 .env.example 写的名字一致


@pytest.mark.parametrize("name", ["", "bad name", "../escape"])
def test_a_malformed_image_name_falls_back_to_the_default(monkeypatch, name):
    from services.deliverable_kind import workspace_e2b_template
    monkeypatch.setenv("WHYBUDDY_WORKSPACE_E2B_TEMPLATE", name)
    assert workspace_e2b_template() is None
