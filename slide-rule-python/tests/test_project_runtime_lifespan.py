"""Exercise the application lifecycle, including disabled and failed workers."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI

import app as app_module
from services import node_bridge_runtime


@pytest.fixture
def startup(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setattr(app_module.settings, "NODE_ENV", "development")
    monkeypatch.delenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", raising=False)
    monkeypatch.setattr(app_module, "_warm_storage_backends", lambda: None)
    monkeypatch.setattr(app_module, "_dry_run_calendars", lambda: None)
    monkeypatch.setattr(node_bridge_runtime, "configure_node_bridge_runtimes", lambda: False)
    made = []
    store = SimpleNamespace(_q=lambda *args, **kwargs: [])
    monkeypatch.setattr(app_module, "get_project_store", lambda: store)
    monkeypatch.setattr(app_module, "ProjectPreviewAccess", lambda actual_store, **_: SimpleNamespace(store=actual_store))
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", raising=False)

    class Supervisor:
        def __init__(self, actual_store, provider_factory, **config):
            assert actual_store is store
            assert provider_factory is app_module.E2BWorkspaceProvider
            self.store = actual_store
            self.config = config
            self.running = False
            self.shutdown_calls = 0
            made.append(self)

        def start(self):
            self.running = True

        def shutdown(self):
            self.shutdown_calls += 1
            self.running = False

    monkeypatch.setattr(app_module, "ProjectRuntimeSupervisor", Supervisor)
    return SimpleNamespace(app=FastAPI(), made=made, store=store)


def test_real_lifespan_starts_and_stops_enabled_worker(startup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")

    async def run():
        async with app_module.lifespan(startup.app):
            supervisor = startup.app.state.project_runtime_supervisor
            assert supervisor is startup.made[0]
            assert supervisor.running
        assert supervisor.shutdown_calls == 1 and not supervisor.running
        assert startup.app.state.project_runtime_supervisor is None

    asyncio.run(run())


@pytest.mark.parametrize("reason", ["disabled", "process-production", "settings-production"])
def test_disabled_or_production_lifespan_does_not_open_store_or_provider(startup, monkeypatch, reason):
    if reason != "disabled": monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    if reason == "process-production": monkeypatch.setenv("NODE_ENV", "production")
    if reason == "settings-production": monkeypatch.setattr(app_module.settings, "NODE_ENV", "production")

    def forbidden():
        pytest.fail("disabled worker must not open the runtime store")

    monkeypatch.setattr(app_module, "get_project_store", forbidden)

    async def run():
        async with app_module.lifespan(startup.app):
            assert startup.app.state.project_runtime_supervisor is None

    asyncio.run(run())
    assert startup.made == []


def test_worker_start_failure_preserves_application_lifecycle(startup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")

    def unavailable():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(app_module, "get_project_store", unavailable)

    async def run():
        async with app_module.lifespan(startup.app):
            assert startup.app.state.project_runtime_supervisor is None

    asyncio.run(run())
    assert startup.made == []


def test_lifespan_shutdown_runs_when_application_body_raises(startup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")

    async def run():
        with pytest.raises(RuntimeError, match="request-failed"):
            async with app_module.lifespan(startup.app):
                raise RuntimeError("request-failed")
        assert startup.made[0].shutdown_calls == 1
        assert startup.app.state.project_runtime_supervisor is None

    asyncio.run(run())


def test_worker_configuration_bounds_reach_real_constructor(startup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    for key, value in {"MAX_WORKERS": "1000", "POLL_SECONDS": "0", "LEASE_SECONDS": "oops",
            "LIFETIME_SECONDS": "60", "IDLE_SECONDS": "900", "INSTALL_SECONDS": "9999", "READY_SECONDS": "-1"}.items():
        monkeypatch.setenv("SLIDERULE_PROJECT_" + key, value)
    supervisor = app_module._start_project_runtime_supervisor()
    assert supervisor.config == {"max_workers": 8, "poll_interval": 1, "lease_ttl": 120,
        "lifetime_seconds": 60, "idle_seconds": 60, "install_timeout": 600, "ready_timeout": 5,
        "browser_provider_factory": app_module.E2BProjectBrowserProvider}


def test_app_configuration_is_accepted_by_actual_worker(startup, monkeypatch, tmp_path):
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from services.project_store import ProjectStore

    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setenv("SLIDERULE_PROJECT_INSTALL_SECONDS", "9999")
    monkeypatch.setattr(app_module, "ProjectRuntimeSupervisor", ProjectRuntimeSupervisor)
    monkeypatch.setattr(ProjectRuntimeSupervisor, "start", lambda self: None)
    store = ProjectStore.from_url("sqlite:///" + (tmp_path / "lifespan.db").as_posix())
    monkeypatch.setattr(app_module, "get_project_store", lambda: store)
    try:
        supervisor = app_module._start_project_runtime_supervisor()
        assert isinstance(supervisor, ProjectRuntimeSupervisor)
        assert supervisor.install_timeout == 600
        assert supervisor.verification_store.store is store
        assert supervisor.browser_provider_factory is app_module.E2BProjectBrowserProvider
    finally:
        store.close()


# ⚠ 2026-09-30 隔离真机第 132 轮：容器被硬杀后第一次起栈，启动时工程库抛 ProjectStoreUnavailable，
#   控制面整个进程生命期都是 None，每一轮 POST /control-turn-stream 都 503，页面停在空白二十分钟——
#   库几秒后就好了。一次性的抖动要后台重试到接上。把 lifespan 里 _retry_project_runtime 那个 task 拿掉，
#   第一条变红。
class _ControlService:
    made = []

    def __init__(self, control_store, project_store, supervisor, **config):
        # config：2026-10-10 起 app 传 max_workers（SLIDERULE_CONTROL_MAX_WORKERS）。桩原来不收它，
        # TypeError 被 lifespan 的重试吞成「worker still unavailable」，第一条红了却像抖动。
        self.supervisor, self.config, self.started, self.stopped = supervisor, config, False, False
        _ControlService.made.append(self)

    async def start(self):
        self.started = True

    async def shutdown(self):
        self.stopped = True


def _flaky_store(monkeypatch, failures, store):
    calls = []

    def get_store():
        calls.append(1)
        if len(calls) <= failures:
            from services.project_store import ProjectStoreUnavailable
            raise ProjectStoreUnavailable("database is locked")
        return store
    monkeypatch.setattr(app_module, "get_project_store", get_store)
    monkeypatch.setattr(app_module, "ControlRunStore", lambda query: SimpleNamespace(query=query))
    monkeypatch.setattr(app_module, "ControlRunService", _ControlService)
    monkeypatch.setattr(app_module, "_RUNTIME_RETRY_FIRST_SECONDS", 0.01)
    _ControlService.made = []
    return calls


def test_a_store_that_is_briefly_unavailable_at_boot_comes_online(startup, monkeypatch):
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    _flaky_store(monkeypatch, failures=2, store=startup.store)

    async def run():
        async with app_module.lifespan(startup.app):
            assert startup.app.state.control_run_service is None          # 第一次没接上
            for _ in range(200):
                if startup.app.state.control_run_service is not None:
                    break
                await asyncio.sleep(0.01)
            service = startup.app.state.control_run_service
            assert service is not None and service.started, "一次性的抖动让控制面永久下线"
            assert len(startup.made) == 1                                  # 重试不多起第二个工人
        assert service.stopped and startup.app.state.control_run_service is None

    asyncio.run(run())


def test_a_store_that_stays_down_stops_being_retried_at_shutdown(startup, monkeypatch):
    """反向：一直接不上，应用照常关；关了之后不再有人去敲库。"""
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    calls = _flaky_store(monkeypatch, failures=10_000, store=startup.store)

    async def run():
        async with app_module.lifespan(startup.app):
            await asyncio.sleep(0.05)
            assert startup.app.state.control_run_service is None
        seen = len(calls)
        await asyncio.sleep(0.1)
        assert len(calls) == seen

    asyncio.run(run())
