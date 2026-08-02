"""邮箱注册 / 登录 / 三档权限（2026-08-02）。

产品语义：**没登录能看，登录才能改，超管能管别人的**。

这份测试盯的是那些"写错了也能跑、但会出安全事故"的地方：
  ① 匿名与拒绝走同一条判定链，不会有分支漏检；
  ② 登录失败不泄露邮箱是否注册过（响应与耗时都不能有差别）；
  ③ 无主资源默认不可写（存量数据不会因为上线权限就被敞开）；
  ④ 密码只存 Argon2 哈希，任何出口都不带 password_hash。
"""

from __future__ import annotations

import os
import time

import pytest

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系整体不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌签发不可用")

from middlewares.current_user import can_write, optional_user, require_superuser, require_user
from services import auth_service, identity_store as ident
from services.auth_tokens import create_access_token, decode_access_token


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """每条用例一个独立的临时身份库。"""
    from config.settings import settings

    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'ident.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "t" * 48)
    monkeypatch.delenv("NODE_ENV", raising=False)
    ident.reset_identity_cache()
    yield
    ident.reset_identity_cache()


def _register(email="a@example.com", password="correct-horse-battery"):
    started = auth_service.start_registration(email, password)
    code = started.get("devCode")
    assert code, "没配邮件服务时必须把验证码带回来，否则自部署第一步就卡死"
    return auth_service.complete_registration(email, password, code)


# ────────────────────── ① 注册 ──────────────────────


def test_register_then_login(_isolated):
    out = _register()
    assert out["ok"] is True
    assert out["user"]["email"] == "a@example.com"
    assert out["token"]

    got = auth_service.login("a@example.com", "correct-horse-battery")
    assert got["ok"] is True
    assert got["user"]["id"] == out["user"]["id"]


def test_first_user_becomes_superuser_rest_do_not(_isolated):
    """自部署第一个人是超管，之后的都不是。

    对齐官方模板用 FIRST_SUPERUSER 建首个超管的取向，改成自动提升——
    不用先配环境变量再启动。
    """
    first = _register("first@example.com")
    assert first["isFirstSuperuser"] is True
    assert first["user"]["isSuperuser"] is True

    second = _register("second@example.com")
    assert second["isFirstSuperuser"] is False
    assert second["user"]["isSuperuser"] is False


def test_email_is_normalized(_isolated):
    _register("Mixed.Case@Example.COM ")
    assert auth_service.login("mixed.case@example.com", "correct-horse-battery")["ok"] is True


def test_weak_password_rejected(_isolated):
    out = auth_service.start_registration("b@example.com", "short")
    assert out["ok"] is False and out["error"] == "weak_password"


def test_bad_code_is_rejected_and_burns_an_attempt(_isolated):
    auth_service.start_registration("c@example.com", "correct-horse-battery")
    bad = auth_service.complete_registration("c@example.com", "correct-horse-battery", "000000")
    assert bad["ok"] is False and bad["error"] == "code_invalid"

    store = ident.get_identity_store()
    assert int(store.get_code("c@example.com")["attempts"]) == 1, "错误尝试没有被计数，验证码可被在线爆破"


def test_code_is_not_stored_in_plaintext(_isolated):
    """库被读走时，明文验证码等于现成的账号接管工具。"""
    started = auth_service.start_registration("d@example.com", "correct-horse-battery")
    rec = ident.get_identity_store().get_code("d@example.com")
    assert started["devCode"] not in str(rec["code_hash"])


# ────────────────────── ② 不泄露邮箱是否注册过 ──────────────────────


def test_login_failure_message_is_identical_either_way(_isolated):
    """邮箱不存在 vs 密码错误 —— 响应必须逐字节相同。

    区分开等于送一个「这个邮箱注册过没有」的探测接口。
    """
    _register("known@example.com")
    wrong_pw = auth_service.login("known@example.com", "wrong-password-here")
    no_user = auth_service.login("nobody@example.com", "wrong-password-here")
    assert wrong_pw == no_user


def test_registering_an_existing_email_does_not_reveal_it(_isolated):
    """已注册的邮箱再走注册，响应不能与新邮箱有区别（否则就是用户枚举器）。"""
    _register("taken@example.com")
    again = auth_service.start_registration("taken@example.com", "correct-horse-battery")
    fresh = auth_service.start_registration("brand-new@example.com", "correct-horse-battery")
    assert again["ok"] == fresh["ok"] is True
    assert again["message"] == fresh["message"]


def test_missing_user_still_pays_the_hashing_cost(_isolated):
    """邮箱不存在时也要空跑一次哈希，否则耗时差本身就泄露了注册状态。

    Argon2 是故意慢的：不空跑的话「不存在」会快一个数量级。这里只断言**没有
    数量级差**——不断言具体毫秒数，那在 CI 上必然 flaky。
    """
    _register("timing@example.com")
    def _elapsed(email):
        t = time.perf_counter()
        auth_service.login(email, "definitely-wrong-password")
        return time.perf_counter() - t

    # 各跑两次取较小值，压掉首次导入/预热的噪声
    known = min(_elapsed("timing@example.com") for _ in range(2))
    unknown = min(_elapsed("ghost@example.com") for _ in range(2))
    assert unknown > known / 5, f"耗时差过大，可据此枚举用户: 已注册 {known:.4f}s / 未注册 {unknown:.4f}s"


# ────────────────────── ③ 密码存储 ──────────────────────


def test_password_is_argon2_hashed_never_plaintext(_isolated):
    out = _register("hash@example.com")
    row = ident.get_identity_store().get_by_id(out["user"]["id"])
    stored = str(row.get("password_hash"))
    assert "correct-horse-battery" not in stored
    assert stored.startswith("$argon2"), f"没用 Argon2: {stored[:20]}"


def test_public_view_never_leaks_the_hash(_isolated):
    """任何对外出口都不能带 password_hash。"""
    out = _register("pub@example.com")
    row = ident.get_identity_store().get_by_id(out["user"]["id"])
    assert "password_hash" not in row.public()
    assert "password_hash" not in out["user"]


def test_node_scrypt_hashes_verify_and_upgrade(_isolated):
    """现有 Node 账号体系的密码要能直接用，并在登录时自动升级到 Argon2。

    Node 侧存的是 `scrypt:{saltHex}:{derivedHex}`（server/auth/password.ts:10）。
    迁移不该强制所有人改密码——这正是 verify_and_update 那套的用途。

    ⚠️ 下面这个哈希是**真的用 node 跑出来的**，不是手算的。两个易错点：
      ① Node 把 salt 当字符串用，盐是十六进制串的 ASCII 字节，不是解码后的 16 字节
      ② 参数 N=16384 r=8 p=1、dklen=64
    任何一处不一致的表现都是「所有老用户密码全错」，而且很难往这个方向想。
    """
    node_hash = (
        "scrypt:d9bf11edcf7af1ede625ee38ddcb58e8:"
        "848aa06bc32e4098feb8cbc227afe15d763eaf63cd032f58c924bbe71320ee9b"
        "52acd3f74ea26f1795ff77f0d1966a68c05f2c099324dc93706c34a7315376c2"
    )
    out = _register("legacy@example.com")
    store = ident.get_identity_store()
    store.set_password_hash(out["user"]["id"], node_hash)

    assert auth_service.login("legacy@example.com", "correct-horse-battery")["ok"] is True
    after = str(store.get_by_id(out["user"]["id"]).get("password_hash"))
    assert after.startswith("$argon2"), "登录后没有升级成 Argon2"

    # 错的密码不能因为走了兼容分支就放行
    store.set_password_hash(out["user"]["id"], node_hash)
    assert auth_service.login("legacy@example.com", "wrong-password")["ok"] is False


def test_malformed_legacy_hash_fails_closed(_isolated):
    """哈希串损坏时判失败，不是判通过。"""
    from services.identity_store import verify_password

    for bad in ("scrypt:", "scrypt:abc", "scrypt:abc:nothex", "scrypt::x", ""):
        ok, _ = verify_password("anything", bad)
        assert ok is False, f"损坏的哈希被判通过了: {bad!r}"


# ────────────────────── ④ 三档依赖 ──────────────────────


def test_optional_user_returns_none_for_anonymous(_isolated):
    """没登录 → None，**不抛异常**。匿名要能看应用中心。"""
    assert optional_user(authorization=None, sliderule_token=None) is None
    assert optional_user(authorization="Bearer garbage", sliderule_token=None) is None
    assert optional_user(authorization="NotBearer x", sliderule_token=None) is None


def test_optional_user_reads_bearer_and_cookie(_isolated):
    out = _register("both@example.com")
    tok = out["token"]
    assert optional_user(authorization=f"Bearer {tok}", sliderule_token=None).email == "both@example.com"
    assert optional_user(authorization=None, sliderule_token=tok).email == "both@example.com"


def test_require_user_rejects_anonymous(_isolated):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e:
        require_user(None)
    assert e.value.status_code == 401


def test_require_superuser_rejects_a_normal_user(_isolated):
    from fastapi import HTTPException

    _register("boss@example.com")          # 第一个是超管
    plain = _register("staff@example.com")  # 第二个是普通用户
    user = ident.get_identity_store().get_by_id(plain["user"]["id"])

    with pytest.raises(HTTPException) as e:
        require_superuser(user)
    assert e.value.status_code == 403


def test_deactivated_user_is_treated_as_anonymous(_isolated):
    """令牌还没过期但账号被停用 → 按未登录处理，不能继续放行。"""
    out = _register("gone@example.com")
    store = ident.get_identity_store()
    store._x.execute(
        f"update {ident.TABLE} set is_active = {store._x.ph(1)} where id = {store._x.ph(2)}",
        [False, out["user"]["id"]],
    )
    assert optional_user(authorization=f"Bearer {out['token']}", sliderule_token=None) is None


def test_token_for_a_deleted_user_is_useless(_isolated):
    """用户没了，签过的令牌不能还能用。"""
    tok = create_access_token("no-such-user-id")
    assert optional_user(authorization=f"Bearer {tok}", sliderule_token=None) is None


def test_expired_token_is_rejected(_isolated):
    assert decode_access_token(create_access_token("someone", ttl_s=-1)) is None


def test_token_signed_with_another_secret_is_rejected(_isolated, monkeypatch):
    tok = create_access_token("someone")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "z" * 48)
    assert decode_access_token(tok) is None


# ────────────────────── ⑤ 归属判定 ──────────────────────


def test_owner_can_write_others_cannot(_isolated):
    a = _register("owner@example.com")   # 超管（第一个）
    b = _register("other@example.com")
    store = ident.get_identity_store()
    ua = store.get_by_id(a["user"]["id"])
    ub = store.get_by_id(b["user"]["id"])

    assert can_write(ub.id, ub) is True          # 本人
    assert can_write(ua.id, ub) is False         # 别人的
    assert can_write(ub.id, ua) is True          # 超管
    assert can_write(ub.id, None) is False       # 匿名


def test_ownerless_resources_are_not_writable_by_default(_isolated):
    """无主资源默认**谁都不能改**（超管除外）。

    存量应用没有归属字段。判成"谁都能改"等于新权限一上线就把所有历史数据敞开；
    判成"谁都不能改"最多是需要一次认领迁移。宁可少给，不可多给。
    """
    _register("su@example.com")
    plain = _register("normal@example.com")
    store = ident.get_identity_store()
    normal = store.get_by_id(plain["user"]["id"])
    su = store.get_by_id(_register("su2@example.com")["user"]["id"])
    su_real = store.get_by_email("su@example.com")

    assert can_write(None, normal) is False
    assert can_write("", normal) is False
    assert can_write(None, su_real) is True, "超管应当能处理无主的存量数据"
    assert su is not None  # 第三个注册的仍是普通用户


# ────────────────────── ⑥ 密钥纪律 ──────────────────────


def test_production_refuses_to_start_without_a_secret(_isolated, monkeypatch):
    """生产缺密钥直接抛。

    审查那套 RBAC 系统时见到 `JWT_SECRET || 'your-secret-key'` —— 兜底密钥写在
    开源代码里，漏配一次等于任何人都能签发任意用户的合法令牌。不重复那个错误。
    """
    import services.auth_tokens as at

    monkeypatch.delenv("SLIDERULE_AUTH_SECRET", raising=False)
    monkeypatch.setenv("NODE_ENV", "production")
    with pytest.raises(RuntimeError, match="SLIDERULE_AUTH_SECRET"):
        at.auth_secret()


def test_short_secret_is_rejected(_isolated, monkeypatch):
    import services.auth_tokens as at

    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "tooshort")
    with pytest.raises(RuntimeError, match="太短"):
        at.auth_secret()
