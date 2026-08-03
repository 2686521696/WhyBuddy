"""管理台的用户列表接口（2026-08-03）。

旧账号体系整套下掉后，Node 的 `/api/admin/users` 不再读 MySQL 的 `users` 表，
改成把浏览器凭据转发到这里。所以**这一层必须自己判超管**——不能假设
"能调到我的就是管理员"。Node 那边的 requireAdmin 只是第一道门，它挡不住
任何绕过 Node 直接打 Python 的请求。

走真实 HTTP 而不是直接调函数：判定漏挂在路由上是这类问题最常见的形状
（见 test_app_routes_access 开头的说明）。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")

API = "/api/sliderule"


@pytest.fixture
def env(tmp_path, monkeypatch, real_auth):
    """干净的本地身份库 + 一个超管两个普通用户。

    `real_auth` 摘掉 conftest 的"默认已登录"覆盖——这份测试要验匿名分支。
    """
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

    def mk(email):
        started = auth_service.start_registration(email, "correct-horse-battery")
        return auth_service.complete_registration(
            email, "correct-horse-battery", started["devCode"]
        )

    root = mk("root@example.com")  # 第一个注册的 = 超管
    alice = mk("alice@example.com")
    bob = mk("bob@example.com")

    from app import app as fastapi_app

    yield {
        "client": TestClient(fastapi_app),
        "root": root,
        "alice": alice,
        "bob": bob,
    }
    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()


def _hdr(who=None):
    h = {"x-internal-key": "dev-slide-rule-internal"}
    if who:
        h["Authorization"] = f"Bearer {who['token']}"
    return h


def test_anonymous_cannot_list_users(env):
    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr())
    assert got.status_code == 401


def test_regular_user_cannot_list_users(env):
    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["alice"]))
    assert got.status_code == 403, "普通用户拿到了全站用户名单"


def test_superuser_sees_every_user(env):
    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    assert got.status_code == 200
    emails = {u["email"] for u in got.json()["items"]}
    assert emails == {"root@example.com", "alice@example.com", "bob@example.com"}


def test_listing_never_carries_password_hashes(env):
    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    # 整个响应体里不能出现哈希：`User.public()` 是白名单式的，
    # 这条断言防的是以后有人图省事改成直接透传整行。
    assert "password" not in got.text.lower()
    assert "$argon2" not in got.text


def test_single_user_lookup_follows_the_same_guard(env):
    client, alice_id = env["client"], env["alice"]["user"]["id"]
    path = f"{API}/account/admin/users/{alice_id}"

    assert client.get(path, headers=_hdr()).status_code == 401
    assert client.get(path, headers=_hdr(env["bob"])).status_code == 403

    ok = client.get(path, headers=_hdr(env["root"]))
    assert ok.status_code == 200
    assert ok.json()["user"]["email"] == "alice@example.com"


def test_missing_user_is_404_for_superuser(env):
    got = env["client"].get(
        f"{API}/account/admin/users/nobody-here", headers=_hdr(env["root"])
    )
    assert got.status_code == 404
