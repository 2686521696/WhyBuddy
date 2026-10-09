"""开发服务器不只是 Vite：模型给自己的启动命令（任意语言），哪个端口在听就预览哪个。

⚠ 2026-10-09：开发服务器只有一条路——npm ci + npm run dev + 5173 + Vite 从 public/ 发修订标记。Go / Django /
  Spring Boot 的工程没有 package-lock，开箱就被锁文件闸打回；端口写死 5173；探活要页面里有我们的修订标记；
  预览授权只认 5173。照 Codespaces / bolt 的做法：认「这条命令的进程在监听哪个端口」。

判据：
- 端口认法（产线脚本，本机真 /proc 跑）：只认这棵进程树开的端口，旁边别的进程开的不算；任何 HTTP 响应都算起来了；
- 真工人：前提——不给命令的 Django 工程被锁文件闸打回；给了命令就不跑 npm ci、按真在听的端口就绪；
  说了 3000 实际开在 8000，认 8000 并照实记下；之后不给命令（预览面板叫醒）照原样再起；
- 真预览授权：自定义命令开在 8000 的拿得到票；Vite 的端口对不上照旧拒（反向）；
- 验收碰上自定义服务器照实拒，说清能怎么验，不让模型白跑一轮。
"""

from __future__ import annotations

import http.server
import json
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

import pytest

from models.project_runtime import RuntimeInstance
from models.v5_state import V5SessionState
from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import persistence
from services.e2b_workspace_provider import _HTTP_PROBE_SCRIPT, _LISTENING_PORTS_SCRIPT
from services.project_creation import create_session_project
from services.project_preview_access import PreviewAccessDenied, ProjectPreviewAccess
from services.project_runtime_worker import approved_reference, authorize_operation
from services.project_store import ProjectStore
from services.session_blob_store import SqlSessionBlobStore
from services.workspace_provider import ProcessResult
from test_project_runtime_worker import Provider, eventually, setup, state  # noqa: F401  （夹具）

DJANGO = {"manage.py": "import sys\n", "mysite/settings.py": "ALLOWED_HOSTS = ['*']\n", "requirements.txt": "django\n"}
START = "pip install -r requirements.txt && python manage.py runserver 0.0.0.0:8000"


# ── 端口认法：产线脚本，本机真 /proc ─────────────────────────────────────────────────────────────

def _run(script, *args):
    return subprocess.run([sys.executable, "-c", script, *map(str, args)], capture_output=True, text=True, timeout=30)


def _serve_in_child_of_bash():
    """跟沙盒里一样：包装进程 → bash → 应用。应用自己挑端口（0），我们事先不知道。"""
    code = ("import http.server,sys;s=http.server.ThreadingHTTPServer(('0.0.0.0',0),http.server.BaseHTTPRequestHandler);"
            "print(s.server_address[1],flush=True);s.serve_forever()")
    proc = subprocess.Popen(["/bin/bash", "-c", f"{sys.executable} -c \"{code}\""], stdout=subprocess.PIPE, text=True)
    port = int(proc.stdout.readline())
    return proc, port


def test_the_port_comes_from_this_process_tree_only():
    proc, port = _serve_in_child_of_bash()
    other = http.server.ThreadingHTTPServer(("127.0.0.1", 0), http.server.BaseHTTPRequestHandler)   # 旁边别的服务
    threading.Thread(target=other.serve_forever, daemon=True).start()
    try:
        seen = json.loads(_run(_LISTENING_PORTS_SCRIPT, proc.pid).stdout)
        assert seen == [port]                                                      # 孙进程开的端口认得出
        assert other.server_address[1] not in seen                                # 别人的不算
        assert _run(_HTTP_PROBE_SCRIPT, port).returncode == 0                      # 501 也是「起来了」
    finally:
        proc.kill()
        other.shutdown()
    time.sleep(0.2)
    assert _run(_HTTP_PROBE_SCRIPT, port).returncode != 0                          # 关了就是没起来


# ── 真工人 ──────────────────────────────────────────────────────────────────────────────────────

class ServerProvider(Provider):
    """自定义命令起的服务器：起来一会儿之后在 listening 那几个端口上回 HTTP。"""

    def __init__(self, listening=(8000,)):
        super().__init__()
        self.listening, self.scans, self.started = list(listening), 0, []

    def start_process(self, handle, command, **kwargs):
        self.started.append(command)
        return super().start_process(handle, command, **kwargs)

    def listening_ports(self, handle, process_id):
        self.scans += 1
        return self.listening if self.scans > 1 else []                            # 第一次扫还没起来

    def probe_http(self, handle, port):
        return port in self.listening


@pytest.fixture
def django(setup):  # noqa: F811
    store, _, _, make_worker, _ = setup
    project = store.create_project("session-django", owner_id="alice", files=DJANGO,
        template_version="whybuddy-react-vite-1", plan_ref="plan-1")
    provider = ServerProvider()
    worker = make_worker()
    worker.provider_factory = lambda: provider
    return store, project, provider, worker


def _start(worker, project, key, **kw):
    return worker.submit(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
                         approval_ref="plan-1", idempotency_key=key, **kw)


def test_precondition_without_a_command_a_django_project_never_starts(django):
    store, project, provider, worker = django
    op = _start(worker, project, "vite-way")
    done = eventually(lambda: state(store, op, "failed"))
    assert done.runtime.errorCode == "project_lockfile_or_reserved_path_invalid"
    assert provider.started == []


def test_the_models_command_starts_and_the_listening_port_is_previewed(django):
    store, project, provider, worker = django
    op = _start(worker, project, "django", command=START)
    ready = eventually(lambda: state(store, op, "ready"))
    assert ready.runtime.port == 8000                                              # 没说端口：认真在听的那个
    assert not any(cmd.startswith("npm ci") for cmd in provider.started)            # 不替它跑 npm ci
    assert provider.started == ["export HOST=0.0.0.0; " + START]
    assert ready.runtime.health == "revision_verified"


def test_a_wrong_port_hint_yields_to_the_real_one(django):
    store, project, provider, worker = django
    op = _start(worker, project, "hinted", command=START, port=3000)
    ready = eventually(lambda: state(store, op, "ready"))
    assert ready.runtime.port == 8000 and ready.result["requestedPort"] == 3000
    assert provider.started == ["export HOST=0.0.0.0 PORT=3000; " + START]


def test_a_later_start_without_a_command_reuses_the_last_one(django):
    """预览面板「叫醒」、browser_navigate 不知道该用什么命令：照上次的起。"""
    store, project, provider, worker = django
    first = _start(worker, project, "first", command=START)
    eventually(lambda: state(store, first, "ready"))
    worker.cancel(first.operationId, owner_id="alice")
    eventually(lambda: state(store, first, "stopped"))
    again = _start(worker, project, "wake")
    assert again.input == {"port": None, "command": START}


# ── 真预览授权 ──────────────────────────────────────────────────────────────────────────────────

def _access_world(tmp_path, monkeypatch, start_input, runtime_port):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    plan = {"planId": "plan-1", "revision": 1, "planContent": "Django 后台", "reqId": "request-1"}
    session = V5SessionState(sessionId="s1", ownerId="u1", goal={"text": plan["planContent"]}, controlTranscript=[
        {**plan, "kind": "plan_written"}, {**plan, "kind": "plan_approval"}, {**plan, "kind": "plan_approved"}])
    approval = approved_reference(session)
    persistence.save_session_record(session, server_write=True)
    project = create_session_project(store, "s1", owner_id="u1", approval_ref=approval)
    op = store.create_operation(project.projectId, owner_id="u1", kind="runtime.start",
        expected_revision=project.currentRevision, approval_ref=approval, idempotency_key="start", input=start_input)
    lease = store.acquire_lease(project.projectId, owner_id="u1", lease_owner="worker", ttl_seconds=600)
    store.claim_operation(op.operationId, owner_id="u1", lease_owner=lease.leaseOwner, generation=lease.generation)
    lease = store.renew_lease(project.projectId, owner_id="u1", lease_owner=lease.leaseOwner, generation=lease.generation,
        ttl_seconds=600, sandbox_id="sandbox-1", mounted_revision=project.currentRevision,
        process_refs={"operationId": op.operationId, "server": "pid-1"})
    runtime = RuntimeInstance(runtimeId="rt-" + op.operationId, projectId=project.projectId, workspaceId=lease.workspaceId,
        revision=project.currentRevision, status="ready", port=runtime_port, health="revision_verified",
        processId="pid-1", expiresAt=time.time() + 900, lastHeartbeat="2026-10-09T00:00:00Z")
    store.update_runtime_operation(op.operationId, owner_id="u1", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=runtime)
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.preview.example.com")
    from services.project_preview_config import origin_for_runtime
    access = ProjectPreviewAccess(store, authorizer=authorize_operation)
    return SimpleNamespace(store=store, sessions=sessions, access=access, op=op,
                           audience=origin_for_runtime(runtime.runtimeId))


def test_a_custom_server_on_8000_gets_a_preview_ticket(tmp_path, monkeypatch, project_actor):  # noqa: F811
    project_actor("u1")
    world = _access_world(tmp_path, monkeypatch, {"port": None, "command": START}, 8000)
    try:
        grant = world.access.issue_browser_ticket(world.op.operationId, owner_id="u1", audience=world.audience)
        assert grant.scope.port == 8000
    finally:
        world.store.close()
        world.sessions._engine.dispose()


def test_a_vite_runtime_on_the_wrong_port_is_still_refused(tmp_path, monkeypatch, project_actor):  # noqa: F811
    project_actor("u1")
    world = _access_world(tmp_path, monkeypatch, {"port": 5173}, 8000)
    try:
        with pytest.raises(PreviewAccessDenied):
            world.access.issue_browser_ticket(world.op.operationId, owner_id="u1", audience=world.audience)
    finally:
        world.store.close()
        world.sessions._engine.dispose()



