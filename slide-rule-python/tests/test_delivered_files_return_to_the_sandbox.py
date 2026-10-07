"""已经交付过的文件，追问时要在沙盒里（按原路径），模型才能在原件上改。

⚠ 2026-10-07 真机 r53 sr-20261007065206-968KDGMNFE（「新员工入职须知」Word 追问：第一周改五天、去掉一个冒号、其他不要动）：
  上一轮是 heredoc 里直接 python 生成的 docx，源码里没有脚本，文件只在产物库。新起的沙盒只有源码——模型找不到原件，
  「按原文档结构重新生成」，整份重写，收尾还说「其他内容保持不变」（_RuntimeTask._mount_delivered_files 头注）。

夹具 onboarding_r52.docx 是那个工程交付出去的原件。执行器用 _mount_session_uploads 判据同一套最小骨架。
"""

from __future__ import annotations

import ast
import threading
from pathlib import Path

import pytest

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import persistence
from services.deliverable_kind import OFFICE_FILE
from services.e2b_workspace_provider import PROJECT_ROOT, E2BWorkspaceProvider
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.project_runtime_worker import _RuntimeTask
from services.workspace_provider import WorkspaceHandle
from test_office_artifacts import _project_setup, approved_reference

ROOT = Path(__file__).resolve().parents[1]
DOCX = (Path(__file__).parent / "fixtures" / "onboarding_r52.docx").read_bytes()
PATH = "output/新员工入职须知.docx"


@pytest.fixture
def delivered(tmp_path, monkeypatch):
    store, _blobs = _project_setup(tmp_path, monkeypatch)
    state = V5SessionState(sessionId="sess-r52", ownerId="alice", goal={"text": "新员工入职须知 Word"},
                           controlTranscript=approved_plan_rows("入职须知", deliverable_kind=OFFICE_FILE))
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(store, state.sessionId, owner_id="alice",
                                     approval_ref=approved_reference(state), template_id="react-vite")
    ProjectOfficeArtifactStore(store).put(project.projectId, owner_id="alice", path=PATH, data=DOCX)
    yield store, project
    store.close()


def _task(store, project, provider, *, sandbox="sbx", supervisor=None):
    task = type("Task", (), {})()
    task.store, task.owner_id, task.provider = store, "alice", provider
    task.original = type("Op", (), {"sessionId": "sess-r52", "projectId": project.projectId})()
    task.handle = WorkspaceHandle("ws", sandbox)
    task.result = {}
    task.supervisor = supervisor or type("Sup", (), {"_lock": threading.Lock(), "_mounted_uploads": {}})()
    return task


def test_the_delivered_docx_is_back_at_its_path_in_the_sandbox(delivered):
    store, project = delivered
    written = {}

    class Box:
        class files:
            @staticmethod
            def write(path, data):
                written[path] = data
    provider = E2BWorkspaceProvider.__new__(E2BWorkspaceProvider)
    provider._sandbox = lambda handle: Box()
    task = _task(store, project, provider)
    _RuntimeTask._mount_delivered_files(task)
    assert written == {f"{PROJECT_ROOT}/{PATH}": DOCX}          # 原件、原路径（output/ 下），字节一模一样
    assert "deliveredSkipped" not in task.result


def test_not_pushed_again_into_the_same_sandbox_unless_it_changed(delivered):
    """同一台沙盒、sha 没变不再推——不拿产物库的版本盖掉沙盒里刚改、还没收回的那份。"""
    store, project = delivered
    pushes = []
    provider = type("P", (), {"write_file_bytes": lambda self, h, path, data: pushes.append(path)})()
    first = _task(store, project, provider)
    _RuntimeTask._mount_delivered_files(first)
    _RuntimeTask._mount_delivered_files(_task(store, project, provider, supervisor=first.supervisor))
    assert pushes == [PATH]
    _RuntimeTask._mount_delivered_files(_task(store, project, provider, sandbox="sbx-2", supervisor=first.supervisor))
    assert pushes == [PATH, PATH]                                # 换了沙盒（新起的）要再放


def test_a_failed_mount_is_said_not_swallowed(delivered):
    """放不进去不挡命令（fail-open），但要随回执说出来（§七：不许装作放好了）。"""
    store, project = delivered

    def boom(self, handle, path, data):
        raise RuntimeError("sandbox gone")
    task = _task(store, project, type("P", (), {"write_file_bytes": boom})())
    _RuntimeTask._mount_delivered_files(task)                   # 不许抛
    assert task.result["deliveredSkipped"] == [PATH]


def test_the_provider_refuses_paths_outside_the_workspace():
    provider = E2BWorkspaceProvider.__new__(E2BWorkspaceProvider)
    provider._sandbox = lambda handle: (_ for _ in ()).throw(AssertionError("不该走到沙盒"))
    for bad in ("/etc/passwd", "../x.docx", "output/../../x.docx", "C:/x.docx", ""):
        with pytest.raises(ValueError):
            provider.write_file_bytes(WorkspaceHandle("ws", "sbx"), bad, DOCX)


def test_it_sits_on_the_command_path_after_source_sync():
    """接在链路上（§三）：命令前、源码写进去之后放（同 _mount_session_uploads）。"""
    tree = ast.parse((ROOT / "services" / "project_runtime_worker.py").read_text(encoding="utf-8"))
    host = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
                and any(isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == "write_files"
                        for c in ast.walk(node)))
    calls = [c.func.attr for c in ast.walk(host) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)]
    assert calls.index("write_files") < calls.index("_mount_delivered_files")
