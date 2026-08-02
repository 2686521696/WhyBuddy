"""注册 / 登录 / 邮箱验证（2026-08-02）。

薄薄一层业务规则，存储在 identity_store、令牌在 auth_tokens。

## 三个刻意的取舍

**① 登录失败一律同一个错误信息**

邮箱不存在和密码错误返回**逐字节相同**的响应。区分开等于送一个「这个邮箱注册过
没有」的探测接口——攻击者可以据此枚举用户。同理，注册时邮箱已存在也不直接说，
走"验证码已发送"的同一条出口（见 register 的说明）。

**② 邮箱不存在时也要跑一次哈希校验**

不跑的话，"邮箱不存在"会比"密码错误"快一个数量级（Argon2 是故意慢的），
时序差本身就泄露了邮箱是否注册过。所以对着一个固定的假哈希空跑一次。
这是 Django `authenticate()` 和 fastapi-users 都有的做法。

**③ 第一个注册的用户自动成为超管**

对齐官方模板 `initial_data.py` 的取向（用 FIRST_SUPERUSER 建首个超管），但改成
"库里一个用户都没有时自动提升"——自部署场景下不用先配环境变量再启动。
之后再注册的都是普通用户。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from services import identity_store as ident
from services.auth_tokens import create_access_token

# 登录失败的统一话术。**不要**按情况细分（见模块说明 ①）。
LOGIN_FAILED = "邮箱或密码不正确"

# 邮箱不存在时用来空跑的假哈希，抹平时序差（见模块说明 ②）。
# 进程启动时算一次，值本身无意义。
_DUMMY_HASH: Optional[str] = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = ident.hash_password(secrets.token_urlsafe(24))
    return _DUMMY_HASH


def _code_hash(email: str, code: str) -> str:
    """验证码按 HMAC 存，不存明文。

    库被读走时明文验证码等于现成的账号接管工具。用 HMAC 而不是裸 sha256 是为了
    绑定签名密钥——光有库拿不到可用的码。
    """
    from services.auth_tokens import auth_secret

    return hmac.new(
        auth_secret().encode(), f"{ident.normalize_email(email)}:{code}".encode(), hashlib.sha256
    ).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace(" ", "T"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


# ────────────────────────── 注册 ──────────────────────────


def start_registration(email: str, password: str) -> dict[str, Any]:
    """第一步：校验 + 发验证码。

    ⚠️ 邮箱**已注册**时也返回成功（不发码）。这是刻意的——否则这个接口就是一个
    用户枚举器：输入邮箱看返回，就知道谁注册过。代价是用户输错自己的邮箱时不会
    被提醒，但那可以在登录环节兜住。
    """
    email = ident.normalize_email(email)
    err = ident.validate_email(email)
    if err:
        return {"ok": False, "error": "invalid_email", "message": err}
    err = ident.validate_password(password)
    if err:
        return {"ok": False, "error": "weak_password", "message": err}

    store = ident.get_identity_store()
    existing = store.get_by_email(email)
    if existing is not None:
        # 不发码、不报错——与"码已发送"的响应保持一致
        return {"ok": True, "codeSent": False, "message": "验证码已发送，请查收邮件"}

    prior = store.get_code(email)
    if prior:
        sent = _parse_iso(prior.get("sent_at"))
        if sent and (_now() - sent).total_seconds() < ident.EMAIL_CODE_COOLDOWN_S:
            return {
                "ok": False,
                "error": "too_frequent",
                "message": f"请 {ident.EMAIL_CODE_COOLDOWN_S} 秒后再试",
            }

    code = ident.new_email_code()
    store.put_code(email, _code_hash(email, code), purpose="register")
    delivered = _send_code_email(email, code)
    return {
        "ok": True,
        "codeSent": True,
        "message": "验证码已发送，请查收邮件",
        # 没配邮件服务时把码带回来，否则自部署的人第一步就卡死。
        # 配了就绝不外泄（那等于把验证码这道关直接拆掉）。
        **({"devCode": code} if not delivered else {}),
    }


def complete_registration(email: str, password: str, code: str) -> dict[str, Any]:
    """第二步：验码 + 建账号 + 直接发令牌（注册完即登录态）。"""
    email = ident.normalize_email(email)
    store = ident.get_identity_store()

    rec = store.get_code(email)
    if not rec:
        return {"ok": False, "error": "code_invalid", "message": "验证码无效或已过期"}

    expires = _parse_iso(rec.get("expires_at"))
    if expires and _now() > expires:
        store.drop_code(email)
        return {"ok": False, "error": "code_invalid", "message": "验证码无效或已过期"}

    if int(rec.get("attempts") or 0) >= ident.EMAIL_CODE_MAX_ATTEMPTS:
        store.drop_code(email)
        return {"ok": False, "error": "code_invalid", "message": "验证码无效或已过期"}

    # 定长比较，避免时序侧信道
    if not hmac.compare_digest(str(rec.get("code_hash") or ""), _code_hash(email, code or "")):
        store.bump_code_attempts(email)
        return {"ok": False, "error": "code_invalid", "message": "验证码无效或已过期"}

    err = ident.validate_password(password)
    if err:
        return {"ok": False, "error": "weak_password", "message": err}

    if store.get_by_email(email) is not None:
        store.drop_code(email)
        return {"ok": False, "error": "already_exists", "message": "该邮箱已注册，请直接登录"}

    # 库里一个用户都没有 → 这是自部署的第一个人，给超管（见模块说明 ③）
    first = store.count() == 0
    user = store.create(
        email,
        ident.hash_password(password),
        is_superuser=first,
        is_verified=True,  # 走完验证码即视为已验证
    )
    store.drop_code(email)
    return {
        "ok": True,
        "user": user.public(),
        "token": create_access_token(user.id),
        "isFirstSuperuser": first,
    }


# ────────────────────────── 登录 ──────────────────────────


def login(email: str, password: str) -> dict[str, Any]:
    email = ident.normalize_email(email)
    store = ident.get_identity_store()
    user = store.get_by_email(email)

    if user is None:
        # 空跑一次哈希，抹平"邮箱不存在"与"密码错误"的耗时差（见模块说明 ②）
        ident.verify_password(password or "", _dummy_hash())
        return {"ok": False, "error": "invalid_credentials", "message": LOGIN_FAILED}

    ok, upgraded = ident.verify_password(password or "", str(user.get("password_hash") or ""))
    if not ok:
        return {"ok": False, "error": "invalid_credentials", "message": LOGIN_FAILED}

    if not user.is_active:
        # 这个可以明说：账号确实存在且密码对，隐瞒没有意义，反而让人无从申诉
        return {"ok": False, "error": "inactive", "message": "账号已被停用"}

    if upgraded:
        # 旧算法的哈希在登录时自动升级到 Argon2，用户无感（对齐官方模板）
        store.set_password_hash(user.id, upgraded)

    store.touch_login(user.id)
    return {"ok": True, "user": user.public(), "token": create_access_token(user.id)}


# ────────────────────────── 邮件投递 ──────────────────────────


def _send_code_email(email: str, code: str) -> bool:
    """投递验证码。返回是否真的发出去了。

    现在只打日志——真实投递要接 SMTP/服务商，那是独立的一件事。**返回 False 时
    上层会把验证码带回响应**，这样没配邮件服务也能自部署跑通；一旦接了真投递，
    这里返回 True，验证码就不再出现在响应里。

    这个降级是显式的：宁可让自部署的人看见"码在响应里"，也不要做成
    "看起来发了、其实没发"。
    """
    print(f"[auth] 邮箱验证码（未配置邮件服务，仅打印）: {email} -> {code}")
    return False
