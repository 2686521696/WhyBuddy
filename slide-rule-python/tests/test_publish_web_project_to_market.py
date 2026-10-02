"""网页工程发布到应用市场：通过交付验收的这一版上架；别人能看截图、能复刻那一版源码；没验收过的不许发。

⚠ 2026-10-01 用户审查应用市场：市场里 24 个全是老 HTML 推演的，新流程的网页工程一个都上不去——结果卡上的
  「发布」一直 disabled「发布通道尚未接通」。用户定的顺序：先修「我的应用」，再接发布。

工程、验收记录都走真链路：create_session_project 建工程、test_project_delivery.proof 用真的租约 + 验收存储
写一条通过的验收（不手拼「eligible」）。复刻走 /apps/{id}/fork 那条真路由，复刻者是另一个普通用户。
把 publication 里「reasons 非空就拒」删掉，第一条变红；把 fork 路由里 projectSnapshot 那一支删掉，第三条变红。
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import optional_user
from routes import sliderule_full
from services import app_store, persistence
from services.identity_store import User
from test_project_delivery import proof
from test_project_source_operations import setup  # noqa: F401  （夹具）

BOB = User(id="bob", is_superuser=False)


@pytest.fixture
def market(tmp_path, monkeypatch):
    from config.settings import settings
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'apps.db'}", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)
    app_store.reset_backend_cache()
    yield
    app_store.reset_backend_cache()


def _bob_client(setup, monkeypatch):
    monkeypatch.setattr(sliderule_full, "get_project_store", lambda: setup.store)
    app = FastAPI()
    app.include_router(sliderule_full.router, prefix="/api/sliderule")
    app.dependency_overrides[optional_user] = lambda: BOB
    return TestClient(app)


def test_an_unverified_project_cannot_be_published(setup, market):
    response = setup.client.post(setup.url + "/publish")
    assert response.status_code == 409
    assert "project_verification_required" in response.json()["detail"]
    assert setup.client.get(setup.url + "/publication").json()["published"] is False


def test_a_verified_project_lands_in_the_market_with_its_screenshot(setup, market):
    record, *_ = proof(setup, "react-vite-app@1")
    response = setup.client.post(setup.url + "/publish")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["published"] and body["revision"] == record.revision and body["hasPreview"]
    saved = app_store.get_app(body["appId"])
    assert saved["visibility"] == "public" and saved["owner_id"] == "alice"
    assert saved["dedup_key"] == "project:" + setup.project.projectId           # 前端认卡的那个前缀
    assert saved["model_json"]["projectSnapshot"]["revision"] == record.revision
    assert app_store.get_app_preview_png(body["appId"])                         # 市场卡封面
    # 再点一次发布不堆第二张卡
    again = setup.client.post(setup.url + "/publish").json()
    assert again["appId"] == body["appId"]


def test_someone_else_forks_exactly_the_published_revision(setup, market, monkeypatch):
    record, *_ = proof(setup, "react-vite-app@1")
    app_id = setup.client.post(setup.url + "/publish").json()["appId"]
    published_files = setup.store.read_files(setup.project.projectId, record.revision, owner_id="alice")
    # 作者发布之后又改了一版——复刻的人拿到的仍是发布的那一版。验收跑着的工程走 HTTP patch 要活的沙盒，
    # 这里直接按租约提交一版（跟运行时同步回源码的那条存储路径一样）。
    lease = setup.store.get_lease(setup.project.projectId, owner_id="alice")
    saved = setup.store.get_revision(setup.project.projectId, owner_id="alice")
    changed = {**published_files, "src/main.tsx": "export const title = 'After publish';\n"}
    setup.store.commit_revision(setup.project.projectId, owner_id="alice", expected_revision=record.revision,
        files=changed, template_version=saved.templateVersion, plan_ref=saved.planRef,
        lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    view = setup.client.get(setup.url + "/publication").json()
    assert view["stale"] is True

    forked = _bob_client(setup, monkeypatch).post(f"/api/sliderule/apps/{app_id}/fork", json={})
    assert forked.status_code == 200, forked.text
    fork = forked.json()
    copied = setup.store.read_files(fork["projectId"], owner_id="bob")
    assert {k: v for k, v in copied.items() if k != ".whybuddy-revision"} == \
        {k: v for k, v in published_files.items() if k != ".whybuddy-revision"}
    session = persistence.load_session_record(fork["sessionId"])["session"]
    assert session.ownerId == "bob" and session.projectId == fork["projectId"]
    assert session.controlTranscript[0]["kind"] == "project_forked"


def test_a_private_listing_cannot_be_forked_by_others(setup, market, monkeypatch):
    """反向：作者在「我的应用」里设回私有——别人复刻不了，读不到作者的源码。"""
    proof(setup, "react-vite-app@1")
    app_id = setup.client.post(setup.url + "/publish").json()["appId"]
    app_store.patch_app(app_id, visibility="private")
    response = _bob_client(setup, monkeypatch).post(f"/api/sliderule/apps/{app_id}/fork", json={})
    assert response.status_code in (403, 404)
