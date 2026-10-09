"""自定义命令起的开发服务器走真工具：deploy_expose_port 带命令起得来，跑着时改文件不被当成死了，验收照实拒。

⚠ 2026-10-09：源码同步（模型在服务器跑着时 file_write / project_patch）之后要等服务器「发出这一版的修订标记」
  才算同步好——那是 Vite 从 public/ 发的。Django / Go 的服务器从来不发它：没改这一处的话，自定义服务器跑着时
  模型改一个字，同步就等到超时、整台服务器判死（project_source_sync_health_failed）。开箱、巡检、同步三处
  现在是同一个判断（_RuntimeTask._serving，§4）。

假沙盒照真的：自定义服务器**不**发修订标记（probe 永远 False），只在 8000 上回 HTTP。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import persistence, project_creation
from services.project_authority import approved_reference
from services.project_manifest import content_hash
from services.project_runtime_worker import ProjectRuntimeSupervisor
from services.project_store import ProjectStore
from services.project_tools import CUSTOM_SERVER_VERIFY_UNSUPPORTED, ProjectTools
from services.rehearsal_control import bound_tool_result
from services.session_blob_store import SqlSessionBlobStore
from test_project_live_source_sync import SyncProvider
from test_project_runtime_worker import eventually

FILES = {"manage.py": "import sys\n", "mysite/settings.py": "ALLOWED_HOSTS = ['*']\n", "shop/views.py": "TITLE = '商品'\n"}
START = "pip install django && python manage.py runserver 0.0.0.0:8000"


class DjangoProvider(SyncProvider):
    def probe(self, handle, port, *, expected_revision):
        return False                                                           # Django 不发我们的修订标记

    def listening_ports(self, handle, process_id):
        return [8000] if handle.sandbox_id in self.handles else []

    def probe_http(self, handle, port):
        return port == 8000 and handle.sandbox_id in self.handles


@pytest.fixture
def django(tmp_path, monkeypatch, project_actor):  # noqa: F811
    project_actor("alice")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *args: sessions)
    state = V5SessionState.server_load({"sessionId": "session-django", "ownerId": "alice",
        "goal": {"text": "Django 商品后台", "status": "clear"}, "controlTranscript": approved_plan_rows()})
    sessions.save(state.sessionId, state.model_dump(mode="json"), expected_rev=None)
    monkeypatch.setattr(project_creation, "load_project_template", lambda: (FILES.copy(), "test-vite-1"))
    provider = DjangoProvider()
    supervisor = ProjectRuntimeSupervisor(store, lambda: provider, poll_interval=0.03, lease_ttl=1,
                                          lifetime_seconds=90, idle_seconds=60)
    supervisor.start()
    tools = ProjectTools(store, supervisor, "alice")
    approval = approved_reference(state)
    project = tools.execute("project_create", {"approvalRef": approval}, state)
    assert project["ok"], project
    yield SimpleNamespace(store=store, state=state, tools=tools, provider=provider, approval=approval, project=project)
    supervisor.shutdown()
    store.close()
    sessions._engine.dispose()


def _started(world):
    result = world.tools.execute("deploy_expose_port", {"command": START}, world.state)   # 模型那一发的原样参数
    assert result["ok"], result
    op = lambda: world.store.get_operation(result["operationId"], owner_id="alice")  # noqa: E731
    eventually(lambda: op().runtime and op().runtime.status == "ready")
    return op


def test_deploy_expose_port_with_a_command_serves_the_listening_port(django):
    op = _started(django)
    assert op().runtime.port == 8000 and op().input["command"] == START


def test_editing_while_the_custom_server_runs_does_not_kill_it(django):
    op = _started(django)
    args = {"approvalRef": django.approval, "expectedRevision": django.project["revision"], "changes": [
        {"path": "shop/views.py", "expectedSha256": content_hash(FILES["shop/views.py"]), "content": "TITLE = '在售商品'\n"}]}
    patched = django.tools.execute("project_patch", args, django.state)
    assert patched["ok"], patched
    assert "要 browser_restart 重启" in patched.get("hint", ""), patched           # 生不生效看框架，照实说
    child = lambda: django.store.get_operation(patched["operationId"], owner_id="alice")  # noqa: E731
    done = eventually(lambda: child() if child().status in {"completed", "failed", "cancelled"} else None)
    assert done.status == "completed" and (done.result or {}).get("synchronized") is True, done
    assert op().runtime.status == "ready"                                      # 服务器还活着
    assert django.provider.contents["shop/views.py"] == "TITLE = '在售商品'\n"


def test_verify_on_a_custom_server_is_refused_with_what_to_do(django):
    op = _started(django)
    result = django.tools.execute("project_verify", {"runtimeOperationId": op().operationId,
        "expectedRevision": op().runtime.revision, "idempotencyKey": "verify-1"}, django.state)
    assert result["ok"] is False and result["error"] == CUSTOM_SERVER_VERIFY_UNSUPPORTED, result
    fed = bound_tool_result({"tool": "project_verify", **result}, "project_verify")
    assert "不是你的代码错了" in fed and "browser_view" in fed, fed


def test_file_write_on_a_running_custom_server_lands_and_says_reload_depends(django):
    """模型最常用的是 file_write（不是 project_patch）：同一条规矩、同一句话。"""
    _started(django)
    result = django.tools.execute("file_write", {"file": "shop/views.py", "content": "TITLE = '新品'\n"}, django.state)
    assert result["ok"], result
    assert "要 browser_restart 重启" in str(result.get("hint", "")), result
