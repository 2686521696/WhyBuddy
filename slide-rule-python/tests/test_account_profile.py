"""本人改昵称 / 头像（2026-08-20）。

对照 TRAE 账号设置：登录者改自己的资料。匿名 401；超管也只能改自己这条，
没有在这里开「替别人改」的口子。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")

API = "/api/sliderule"

# 1×1 PNG。判据要咬「写进去了再读得回来」，不是「接口 200」。
_TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture
def env(tmp_path, monkeypatch, real_auth):
    from config.settings import settings

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(
        settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'apps.db'}", raising=False
    )
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'id.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "u" * 48)
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)

    from services import app_store, auth_service, identity_store, session_blob_store

    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()

    started = auth_service.start_registration("alice@example.com", "correct-horse-battery")
    alice = auth_service.complete_registration(
        "alice@example.com", "correct-horse-battery", started["devCode"]
    )

    from app import app as fastapi_app

    yield {
        "client": TestClient(fastapi_app),
        "alice": alice,
    }
    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()


def _hdr(who=None):
    h = {"x-internal-key": "dev-slide-rule-internal"}
    if who:
        h["Authorization"] = f"Bearer {who['token']}"
    return h


def test_anonymous_cannot_patch_profile(env):
    got = env["client"].patch(f"{API}/account/me", json={"displayName": "谁"}, headers=_hdr())
    assert got.status_code == 401


def test_patch_display_name_roundtrips_on_me(env):
    """正：写进库。反：只 200 但 GET /me 仍是空昵称，不算改成功。"""
    c, alice = env["client"], env["alice"]
    before = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    assert not before.get("displayName")

    patched = c.patch(
        f"{API}/account/me",
        json={"displayName": "  面团同学  "},
        headers=_hdr(alice),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["user"]["displayName"] == "面团同学"

    me = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    assert me["displayName"] == "面团同学"
    assert me["email"] == "alice@example.com"


def test_patch_rejects_too_long_name(env):
    got = env["client"].patch(
        f"{API}/account/me",
        json={"displayName": "字" * 41},
        headers=_hdr(env["alice"]),
    )
    assert got.status_code == 400
    after = env["client"].get(f"{API}/account/me", headers=_hdr(env["alice"])).json()["user"]
    assert not after.get("displayName")


def test_patch_avatar_roundtrips_and_rejects_huge(env):
    c, alice = env["client"], env["alice"]
    ok = c.patch(f"{API}/account/me", json={"avatarUrl": _TINY_PNG}, headers=_hdr(alice))
    assert ok.status_code == 200, ok.text
    me = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    assert me["avatarUrl"] == _TINY_PNG

    huge = "data:image/png;base64," + ("A" * (3 * 1024 * 1024))
    bad = c.patch(f"{API}/account/me", json={"avatarUrl": huge}, headers=_hdr(alice))
    assert bad.status_code == 400
    still = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    assert still["avatarUrl"] == _TINY_PNG

    cleared = c.patch(f"{API}/account/me", json={"avatarUrl": ""}, headers=_hdr(alice))
    assert cleared.status_code == 200
    assert c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]["avatarUrl"] is None
