"""访问令牌签发与校验（2026-08-02）。

对齐 **fastapi/full-stack-fastapi-template**（MIT）的 `core/security.py`：
HS256、`sub` 放用户 id、`exp` 绝对过期。没有引入 refresh token —— 那套要配
撤销列表才有意义，而这个产品现阶段的价值不足以支撑那个复杂度；需要时再加。

## 密钥纪律

生产环境缺 `SLIDERULE_AUTH_SECRET` **直接拒绝启动**。审查那套 RBAC 系统时见到
`secret: process.env.JWT_SECRET || 'your-secret-key'` ——兜底密钥写在开源代码里，
漏配一次等于任何人都能签发任意用户的合法令牌。这里不重复那个错误。

开发环境允许自动生成一把**进程内随机**密钥：进程重启后旧令牌全失效，这是刻意的
（不给"开发时能跑、上线忘了配"留活路）。
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

ALGORITHM = "HS256"
# 7 天。纯 JWT 没有服务端撤销，签太长等于把登出做成摆设；太短又要用户频繁登录。
DEFAULT_TTL_S = 7 * 24 * 3600

_SECRET_ENV = "SLIDERULE_AUTH_SECRET"
_MIN_SECRET_LEN = 32

_dev_secret: Optional[str] = None


def _is_production() -> bool:
    env = (os.getenv("NODE_ENV") or os.getenv("APP_ENV") or "").strip().lower()
    return env in ("production", "prod")


def auth_secret() -> str:
    """取签名密钥。生产缺配就抛——这类配置没有安全的兜底值。"""
    global _dev_secret
    raw = (os.getenv(_SECRET_ENV) or "").strip()
    if len(raw) >= _MIN_SECRET_LEN:
        return raw
    if raw:
        raise RuntimeError(f"{_SECRET_ENV} 太短（至少 {_MIN_SECRET_LEN} 字符）")
    if _is_production():
        raise RuntimeError(
            f"生产环境必须设置 {_SECRET_ENV}（至少 {_MIN_SECRET_LEN} 字符）。"
            f"生成：openssl rand -hex 32"
        )
    if _dev_secret is None:
        _dev_secret = secrets.token_hex(32)
        print(
            f"[auth] {_SECRET_ENV} 未设置，本次进程使用随机开发密钥"
            f"（重启后旧令牌失效；生产环境会拒绝启动）"
        )
    return _dev_secret


def create_access_token(user_id: str, *, ttl_s: int = DEFAULT_TTL_S, **claims: Any) -> str:
    import jwt

    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_s)).timestamp()),
        **claims,
    }
    return jwt.encode(payload, auth_secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    """校验并解出 payload；任何问题都返回 None（不区分过期/伪造）。

    不把失败原因暴露给调用方是刻意的：区分「令牌过期」和「签名不对」会给攻击者
    额外信息。前端只需要知道"重新登录"。
    """
    import jwt

    if not token:
        return None
    try:
        return jwt.decode(token, auth_secret(), algorithms=[ALGORITHM])
    except Exception:  # noqa: BLE001 — 过期/签名错/结构错一律按无效处理
        return None


def token_subject(token: str) -> Optional[str]:
    payload = decode_access_token(token)
    if not payload:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None
