"""用户原件进工作区。抄 OpenHands：洗净文件名，字节进工作区根。

⚠ 2026-09-22 抽出的文字进了消息，Word 原件没进沙盒。
  删掉执行器上的拷贝，或改回只存文字，本条变红。
"""
import ast
from pathlib import Path

from services.e2b_workspace_provider import E2BWorkspaceProvider, PROJECT_ROOT
from services.project_runtime_worker import _RuntimeTask
from services.project_store import ProjectStore
from services.session_uploads import sanitize_filename, upload_fact, workspace_path
from services.workspace_provider import WorkspaceHandle


ROOT = Path(__file__).resolve().parents[1]


def test_sanitize_keeps_the_leaf_name():
    assert sanitize_filename("../../报告.docx") == "报告.docx"
    assert sanitize_filename("a\\b.xlsx") == "b.xlsx"
    assert sanitize_filename("") == ""
    assert workspace_path("报告.docx") == "/home/user/workspace/报告.docx"


def test_upload_fact_names_the_path_and_not_a_parser():
    fact = upload_fact(["/home/user/workspace/报告.docx"])
    assert fact is not None
    assert "/home/user/workspace/报告.docx" in fact
    assert "python-docx" not in fact
    assert upload_fact([]) is None


def test_bytes_roundtrip_and_mount_on_the_worker(tmp_path):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    stored = store.put_session_upload(
        "sess-1", owner_id="alice", name="notes/报告.docx", data=b"PK\x03\x04word")
    assert stored["name"] == "报告.docx"
    assert store.read_session_upload("sess-1", "报告.docx", owner_id="alice") == b"PK\x03\x04word"
    assert store.list_session_uploads("sess-1", owner_id="mallory") == []

    written = {}

    class Box:
        class files:
            @staticmethod
            def write(path, data):
                written[path] = data

    provider = E2BWorkspaceProvider.__new__(E2BWorkspaceProvider)
    provider._sandbox = lambda handle: Box()
    task = type("Task", (), {})()
    task.store = store
    task.owner_id = "alice"
    task.original = type("Op", (), {"sessionId": "sess-1"})()
    task.provider = provider
    task.handle = WorkspaceHandle("ws", "sbx")
    _RuntimeTask._mount_session_uploads(task)
    assert written[f"{PROJECT_ROOT}/报告.docx"] == b"PK\x03\x04word"
    store.close()


def test_exec_mounts_uploads_after_source_sync():
    """The copy sits on the command path, after write_files and before the command."""
    src = (ROOT / "services" / "project_runtime_worker.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    host = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
        and any(
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Attribute)
            and child.func.attr == "write_files"
            for child in ast.walk(node)
        )
    )
    calls = [
        child.func.attr
        for child in ast.walk(host)
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute)
    ]
    assert calls.index("write_files") < calls.index("_mount_session_uploads")
