"""应用接口的权限（2026-08-02）。

上一份 test_app_access 验的是**判定模型**，这份验的是**路由真的挂上了**。
两者必须分开：模型对但路由忘了挂，正是我在那套 RBAC 后台里看到的形状——
`hasPermission` 写得好好的，53 个路由文件一个都没用。

所以这里全部走真实 HTTP（TestClient），不直接调函数。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")


@pytest.fixture
def env(tmp_path, monkeypatch, real_auth):
    """一个干净的本地库 + 三个用户（一个超管两个普通）。

    `real_auth` 必须带上：conftest 给全套件装了"默认已登录"的依赖覆盖
    （几十条推演管线测试需要它），而这份测试恰恰要验匿名分支——不摘掉的话
    "匿名看不见私有应用"这类断言会因为访问者其实是登录用户而失去意义。
    """
    from config.settings import settings

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(
        settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'apps.db'}", raising=False
    )
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'id.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "r" * 48)
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)

    from services import app_store, auth_service, identity_store, session_blob_store

    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()

    def mk(email):
        started = auth_service.start_registration(email, "correct-horse-battery")
        return auth_service.complete_registration(email, "correct-horse-battery", started["devCode"])

    root = mk("root@example.com")   # 第一个 = 超管
    alice = mk("alice@example.com")
    bob = mk("bob@example.com")

    from app import app as fastapi_app

    client = TestClient(fastapi_app)
    yield {
        "client": client,
        "root": root,
        "alice": alice,
        "bob": bob,
        "store": app_store,
    }
    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()


def _hdr(who=None):
    h = {"x-internal-key": "dev-slide-rule-internal"}
    if who:
        h["Authorization"] = f"Bearer {who['token']}"
    return h


def _seed(store, *, owner_id=None, visibility="public", name="演示应用"):
    model = {"appbundle": {"appIdentity": {"productName": name}}, "dataModel": {"entities": []}}
    return store.save_app(
        model, goal=name, session_id=None, gate_passed=True,
        owner_id=owner_id, visibility=visibility,
    )


API = "/api/sliderule"


# ────────────────────── 列表 ──────────────────────


def test_anonymous_list_hides_private_apps(env):
    store, c = env["store"], env["client"]
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public", name="公开的")
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="私密的")

    got = c.get(f"{API}/apps", headers=_hdr()).json()["apps"]
    names = {a.get("product_name") for a in got}
    assert "公开的" in names
    assert "私密的" not in names, "匿名列表里出现了私有应用"


def test_owner_sees_own_private_app_in_the_list(env):
    store, c = env["store"], env["client"]
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="只有我看得见")

    mine = c.get(f"{API}/apps", headers=_hdr(env["alice"])).json()["apps"]
    others = c.get(f"{API}/apps", headers=_hdr(env["bob"])).json()["apps"]
    assert "只有我看得见" in {a.get("product_name") for a in mine}
    assert "只有我看得见" not in {a.get("product_name") for a in others}


def test_unlisted_is_not_in_anyone_elses_list(env):
    store, c = env["store"], env["client"]
    app_id = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="unlisted", name="不公开列表")

    listed = c.get(f"{API}/apps", headers=_hdr(env["bob"])).json()["apps"]
    assert "不公开列表" not in {a.get("product_name") for a in listed}
    # 但有链接（知道 id）就能打开——这正是 unlisted 与 private 的区别
    assert c.get(f"{API}/apps/{app_id}", headers=_hdr(env["bob"])).status_code == 200


def test_legacy_ownerless_apps_stay_visible(env):
    """存量应用没有 owner_id —— 部署那一刻应用中心不能突然空掉。"""
    store, c = env["store"], env["client"]
    _seed(store, owner_id=None, visibility="public", name="老应用")
    got = c.get(f"{API}/apps", headers=_hdr()).json()["apps"]
    assert "老应用" in {a.get("product_name") for a in got}


# ────────────────────── 详情 ──────────────────────


def test_private_app_returns_404_not_403(env):
    """403 等于确认「这个 id 存在」，可用来枚举别人的私有应用。"""
    store, c = env["store"], env["client"]
    app_id = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private")

    assert c.get(f"{API}/apps/{app_id}", headers=_hdr()).status_code == 404
    assert c.get(f"{API}/apps/{app_id}", headers=_hdr(env["bob"])).status_code == 404
    assert c.get(f"{API}/apps/{app_id}", headers=_hdr(env["alice"])).status_code == 200
    assert c.get(f"{API}/apps/{app_id}", headers=_hdr(env["root"])).status_code == 200


# ────────────────────── 删除 ──────────────────────


def test_only_owner_or_superuser_can_delete(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public")

    assert c.delete(f"{API}/apps/{aid}", headers=_hdr(env["bob"])).status_code == 403
    assert c.delete(f"{API}/apps/{aid}", headers=_hdr()).status_code == 401
    assert c.delete(f"{API}/apps/{aid}", headers=_hdr(env["alice"])).status_code == 200


def test_superuser_can_delete_an_ownerless_legacy_app(env):
    """无主存量应用：普通用户不能删，超管可以（迁移期由它处理）。"""
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=None, visibility="public")
    assert c.delete(f"{API}/apps/{aid}", headers=_hdr(env["bob"])).status_code == 403
    assert c.delete(f"{API}/apps/{aid}", headers=_hdr(env["root"])).status_code == 200


# ────────────────────── Fork ──────────────────────


def test_fork_requires_login(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public")
    assert c.post(f"{API}/apps/{aid}/fork", headers=_hdr()).status_code == 401


def test_fork_assigns_the_new_app_to_the_forker(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public")

    resp = c.post(f"{API}/apps/{aid}/fork", json={"name": "我的副本"}, headers=_hdr(env["bob"]))
    assert resp.status_code == 200
    forked = store.get_app(resp.json()["id"])
    assert forked["owner_id"] == env["bob"]["user"]["id"], "副本没有归到 Fork 的人名下"


def test_fork_of_a_private_app_stays_private(env):
    """**最容易做反的一条。**

    Fork 产出的是新记录、新所有者，写成默认公开非常自然——那样 Fork 就成了绕过
    私有的后门。这里用超管去 Fork 一个别人的私有应用（超管读得到），断言副本仍私有。
    """
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private")

    resp = c.post(f"{API}/apps/{aid}/fork", headers=_hdr(env["root"]))
    assert resp.status_code == 200
    forked = store.get_app(resp.json()["id"])
    assert forked["visibility"] == "private", f"私有应用的副本变成了 {forked['visibility']}"

    # 而且副本对第三方仍然不可见
    assert c.get(f"{API}/apps/{forked['id']}", headers=_hdr(env["bob"])).status_code == 404


def test_cannot_fork_what_you_cannot_see(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private")
    assert c.post(f"{API}/apps/{aid}/fork", headers=_hdr(env["bob"])).status_code == 404


# ────────────────────── 推演：匿名只能查看 ──────────────────────


def test_anonymous_cannot_drive(env):
    """用户裁决（2026-08-02）：**匿名只能查看**。

    拦在后端而不是只靠前端藏按钮——那套 RBAC 后台的字段权限就是只藏了前端、
    后端照样返回全部字段。前端藏起来的按钮不等于后端拦得住。
    """
    c = env["client"]
    for path in ("/drive-turn", "/drive-full", "/drive-full-stream"):
        r = c.post(
            f"{API}{path}",
            json={
                "state": {"sessionId": "s-1", "goal": {"text": "试试", "status": "needs_refinement"}},
                "userText": "试试",
                "turnId": "t-1",
                "max_loops": 1,
            },
            headers=_hdr(),
        )
        assert r.status_code == 401, f"{path} 放行了匿名推演（{r.status_code}）"


def test_logged_in_user_can_reach_the_drive_endpoint(env):
    """登录之后不该被身份这一关挡住。

    只断言"不是 401"——推演本身要 LLM，这里不跑真链路。
    """
    c = env["client"]
    # 合法的最小 state：缺字段会在身份关卡**之后**触发校验异常，
    # 那样这条断言就变成了"没被 401 挡住"以外的东西（实测踩过）。
    state = {"sessionId": "s-2", "goal": {"text": "试试", "status": "needs_refinement"}}
    r = c.post(f"{API}/drive-full", json={"state": state, "userText": "试试", "max_loops": 1},
               headers=_hdr(env["alice"]))
    assert r.status_code != 401, "登录用户被身份关卡挡住了"


def test_account_me_reports_anonymous_as_200_not_401(env):
    """前端启动时用它判断登录态——匿名是正常状态，不是错误。"""
    c = env["client"]
    r = c.get(f"{API}/account/me", headers=_hdr())
    assert r.status_code == 200
    assert r.json()["user"] is None

    r2 = c.get(f"{API}/account/me", headers=_hdr(env["alice"]))
    assert r2.json()["user"]["email"] == "alice@example.com"


def test_capabilities_reflect_login_state(env):
    c = env["client"]
    anon = c.get(f"{API}/account/capabilities", headers=_hdr()).json()
    assert anon["can"]["browse"] is True and anon["can"]["drive"] is False

    user = c.get(f"{API}/account/capabilities", headers=_hdr(env["alice"])).json()
    assert user["can"]["drive"] is True and user["can"]["fork"] is True


def test_login_via_http_sets_an_httponly_cookie(env):
    """浏览器靠 httpOnly Cookie 保持登录——localStorage 存 JWT 一次 XSS 就永久盗号。"""
    c = env["client"]
    r = c.post(f"{API}/account/login",
               json={"email": "alice@example.com", "password": "correct-horse-battery"},
               headers=_hdr())
    assert r.status_code == 200
    raw = r.headers.get("set-cookie") or ""
    assert "sliderule_token=" in raw
    assert "HttpOnly" in raw, "登录 Cookie 不是 httpOnly"


def test_wrong_password_is_401_with_a_generic_message(env):
    c = env["client"]
    r = c.post(f"{API}/account/login",
               json={"email": "alice@example.com", "password": "nope-nope-nope"},
               headers=_hdr())
    assert r.status_code == 401
    # 与"邮箱不存在"同一句话，不泄露账号是否存在
    r2 = c.post(f"{API}/account/login",
                json={"email": "ghost@example.com", "password": "nope-nope-nope"},
                headers=_hdr())
    assert r2.json().get("message") == r.json().get("message")


def test_anonymous_checks_must_not_reuse_a_logged_in_client(env):
    """TestClient 会保留 Cookie —— 复用会让"匿名"请求带上之前登录的凭据。

    写端到端验证脚本时踩过：注册那步把登录 Cookie 种进了同一个 client，
    之后那条"匿名推演应当 401"的检查实际是以登录身份发的，**真的把 LLM 跑起来了**，
    而我差点据此以为守卫失效。

    这条测试把行为钉住：新开的 client 必须是匿名的。
    """
    from fastapi.testclient import TestClient

    from app import app as fastapi_app

    c = env["client"]
    r = c.post(
        f"{API}/account/login",
        json={"email": "alice@example.com", "password": "correct-horse-battery"},
        headers=_hdr(),
    )
    assert r.status_code == 200
    # 同一个 client 现在带着 Cookie，是登录态
    assert c.get(f"{API}/account/me", headers=_hdr()).json()["user"] is not None
    # 新开的必须是匿名
    fresh = TestClient(fastapi_app)
    assert fresh.get(f"{API}/account/me", headers=_hdr()).json()["user"] is None


def test_cookie_alone_authenticates_without_a_bearer_header(env):
    """浏览器只有 Cookie、没有 Authorization——这条路必须走得通。

    Node 代理透传 cookie 就是为了它（server/routes/sliderule.ts）。
    """
    c = env["client"]
    c.post(
        f"{API}/account/login",
        json={"email": "alice@example.com", "password": "correct-horse-battery"},
        headers=_hdr(),
    )
    # 只带内部 key，不带 Authorization——身份完全靠 Cookie
    me = c.get(f"{API}/account/me", headers=_hdr()).json()
    assert me["user"]["email"] == "alice@example.com"
    caps = c.get(f"{API}/account/capabilities", headers=_hdr()).json()
    assert caps["can"]["drive"] is True
