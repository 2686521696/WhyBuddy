"""Rollout closes spending while preserving owned source, logs and stop commands.

Exercise the HTTP commands and real durable operation, not just a boolean gate.
Static readiness intentionally makes no network/production success claim.
"""

import pytest

from services import project_rollout as rollout
from services.project_access import project_access_enabled
from test_project_runtime_route import setup
from project_actor_support import project_actor


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "allowlist")
    monkeypatch.setenv("WHYBUDDY_PROJECT_ALLOWED_USERS", "u1,u2")
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setattr(rollout.settings, "NODE_ENV", "production")
    monkeypatch.setattr(rollout.settings, "APP_STORE_DATABASE_URL", "postgresql://test.invalid/project")
    monkeypatch.setattr(rollout.settings, "APP_STORE_HTTP_API_URL", "")
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.preview.test")
    monkeypatch.setenv("WHYBUDDY_PROJECT_WORKBENCH_ORIGIN", "https://workbench.test")
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "x" * 32)
    monkeypatch.setenv("E2B_API_KEY", "test-presence-only")
    monkeypatch.setenv("WHYBUDDY_PROJECT_BROWSER_TEMPLATE", "test-browser-template")


def test_allowlist_requires_current_member_even_for_administrator(configured):
    assert project_access_enabled({"id": "u1", "is_superuser": False})
    assert not project_access_enabled({"id": "administrator", "is_superuser": True})
    assert not project_access_enabled(None)
    report = rollout.rollout_readiness()
    assert report["configured"] and report["configurationOnly"]
    assert "test-presence-only" not in str(report)


@pytest.mark.parametrize("key,value,blocker", [
    ("WHYBUDDY_PROJECT_ALLOWED_USERS", "", "project_rollout_users_missing"),
    ("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "http://{runtimeId}.preview.test", "project_private_preview_origin_required"),
    ("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://prefix-{runtimeId}.preview.test", "project_private_preview_origin_required"),
    ("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.workbench.test", "project_preview_origin_isolation_required"),
    ("WHYBUDDY_PROJECT_WORKBENCH_ORIGIN", "https://workbench.test/path", "project_workbench_origin_required"),
    ("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "short", "project_preview_gateway_key_required"),
    ("E2B_API_KEY", "", "project_sandbox_not_configured"),
    ("WHYBUDDY_PROJECT_BROWSER_TEMPLATE", "", "project_browser_not_configured"),
])
def test_missing_or_unsafe_deployment_config_cannot_open_execution(configured, monkeypatch, key, value, blocker):
    monkeypatch.setenv(key, value)
    assert blocker in rollout.rollout_readiness()["blockers"]
    assert not project_access_enabled({"id": "u1", "is_superuser": True})


def test_allowlist_rejects_ephemeral_storage_and_internal_production(configured, monkeypatch):
    monkeypatch.setattr(rollout.settings, "APP_STORE_DATABASE_URL", "sqlite:///local.db")
    assert "project_durable_database_required" in rollout.rollout_readiness()["blockers"]
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "internal")
    assert "project_internal_mode_not_for_production" in rollout.rollout_readiness()["blockers"]


def test_rollback_keeps_owner_observation_and_cancel_but_rejects_new_work(setup, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "internal")
    response = setup.client.post(setup.url, json=setup.body)
    assert response.status_code == 202
    operation = response.json()["operation"]["operationId"]
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "disabled")
    capabilities = setup.client.get("/project-capabilities").json()
    assert not capabilities["canExecute"] and capabilities["canReadOwnedProjects"]
    assert setup.client.get("/sessions/s1/project").json()["project"]["projectId"] == setup.project.projectId
    assert setup.client.get(f"/project-operations/{operation}").status_code == 200
    assert setup.client.get(f"/project-operations/{operation}/events").status_code == 200
    assert setup.client.get(f"/projects/{setup.project.projectId}/verification").status_code == 200
    assert setup.client.post(setup.url, json={**setup.body, "idempotencyKey": "blocked"}).status_code == 503
    assert setup.client.post(f"/project-operations/{operation}/touch").status_code == 503
    assert setup.client.post(f"/project-operations/{operation}/cancel").json()["operation"]["cancelRequested"]
    setup.viewer["id"] = "mallory"
    assert setup.client.get(f"/project-operations/{operation}").status_code == 404
    assert setup.client.post(f"/project-operations/{operation}/cancel").status_code == 404
    assert not setup.called


def test_cleanup_worker_can_start_during_rollback_without_enabling_actor(monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "disabled")
    monkeypatch.setenv("WHYBUDDY_PROJECT_CLEANUP_ENABLED", "1")
    assert rollout.project_worker_enabled()
    assert not project_access_enabled({"id": "u1", "is_superuser": True})


# ⚠ 2026-10-09 新服务器：用户自己的账号不在名单里，整轮落到进程内旧路径、建工程被拒、界面转圈
#   （sr-20261009164412-1EQ3PRXPZZ）。public = 所有登录账号都走新路径；部署侧的检查一项不少。

def test_public_opens_execution_to_every_signed_in_account_without_a_list(configured, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "public")
    monkeypatch.setenv("WHYBUDDY_PROJECT_ALLOWED_USERS", "")
    report = rollout.rollout_readiness()
    assert report["mode"] == "public" and report["configured"], report["blockers"]
    assert project_access_enabled({"id": "someone-not-on-any-list", "is_superuser": False})
    assert not project_access_enabled(None)                                    # 没登录照旧不放
    assert not project_access_enabled({"is_superuser": False})                 # 没有身份的不算登录账号
    from services.identity_store import User                                   # 路由里真实传进来的就是它
    assert project_access_enabled(User(id="usr-real-row", email="a@b.c", is_superuser=False))
    assert not project_access_enabled(User(id="", email="a@b.c"))


@pytest.mark.parametrize("key,value,blocker", [
    ("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.workbench.test", "project_preview_origin_isolation_required"),
    ("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "short", "project_preview_gateway_key_required"),
    ("E2B_API_KEY", "", "project_sandbox_not_configured"),
    ("WHYBUDDY_PROJECT_BROWSER_TEMPLATE", "", "project_browser_not_configured"),
])
def test_public_keeps_every_deployment_check(configured, monkeypatch, key, value, blocker):
    """反向：对所有人开放不等于放松部署检查——缺哪项照样整个关掉。"""
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "public")
    monkeypatch.setenv(key, value)
    assert blocker in rollout.rollout_readiness()["blockers"]
    assert not project_access_enabled({"id": "u1", "is_superuser": False})


def test_public_also_rejects_ephemeral_storage(configured, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "public")
    monkeypatch.setattr(rollout.settings, "APP_STORE_DATABASE_URL", "sqlite:///local.db")
    assert "project_durable_database_required" in rollout.rollout_readiness()["blockers"]


def test_an_unknown_mode_still_closes(configured, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_ROLLOUT", "everyone")
    assert rollout.rollout_mode() == "disabled"
    assert not project_access_enabled({"id": "u1", "is_superuser": True})
