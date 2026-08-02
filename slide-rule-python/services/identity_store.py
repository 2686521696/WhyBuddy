"""用户身份存储（2026-08-02）。

## 设计取向

参照 **fastapi/full-stack-fastapi-template**（MIT，官方模板）和
**fastapi-users**（MIT）——这两个是 FastAPI 生态里最成熟的两套，本模块逐条对齐
它们的关键决定，而不是自己发明：

  · 密码哈希用 **pwdlib 的 Argon2**，并保留 Bcrypt 校验能力。
    模板的写法是 `PasswordHash((Argon2Hasher(), BcryptHasher()))`
    （backend/app/core/security.py:11），第一个是**写**用的算法，其余仅用于
    **验**旧哈希。fastapi-users 2026 年也把默认从 bcrypt 换成了 Argon2。
    Argon2 是内存硬的，抗 GPU 爆破，是当前的推荐算法。

  · 登录时 `verify_and_update` 返回 `(是否通过, 新哈希或None)`，旧算法的哈希
    在用户下次登录时**自动升级**（模板 security.py:29）。加密算法换代不用
    强制所有人改密码——这个细节自己写很容易漏。

  · 用户表带 `is_active` / `is_superuser` / `is_verified` 三个布尔位。
    这是两个项目共同的最小集，够表达你要的三档（匿名 / 登录用户 / 超管）。

## 为什么不直接用 fastapi-users

它把「用户模型 + 数据库适配器 + 认证后端 + 路由」整套绑在一起，要求用
SQLAlchemy 的 declarative 模型和它的 UserManager 生命周期。而这边的存储有一条
特殊要求：**必须能走 Neon SQL over HTTP**（受限网络只放行 443，见
services/session_blob_store 的说明），那条通道不是 SQLAlchemy 能覆盖的。

所以这里只借它的**判定逻辑与算法选择**，存储沿用本项目已经验证过的那套降级链。
接口保持得足够薄，将来真要换成 fastapi-users 也只需换掉这一层。

## 存哪

与应用记录、会话同一个库（`APP_STORE_DATABASE_URL`）。归属校验要和数据在同一个
库里才有意义——跨库校验既慢又会在库不一致时给出错误答案。

没配连接串时落本地 SQLite，行为一致，只是不跨机器共享。
"""

from __future__ import annotations

import os
import re
import secrets
import threading
from datetime import datetime, timezone
from typing import Any, Optional

TABLE = "sliderule_user"

# 邮箱验证码有效期。取 10 分钟：够慢的人打开邮箱，又不给撞库留太长窗口。
EMAIL_CODE_TTL_S = 600
# 同一邮箱两次发码的最小间隔，挡住"点一次发一封"的骚扰与短信/邮件账单。
EMAIL_CODE_COOLDOWN_S = 60
# 一个验证码最多试几次，超了作废——防止 6 位数字被在线爆破。
EMAIL_CODE_MAX_ATTEMPTS = 5

_MIN_PASSWORD_LEN = 8


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


# ────────────────────────── 密码哈希 ──────────────────────────

_hasher_lock = threading.Lock()
_hasher: Any = None


def _password_hasher():
    """Argon2 优先、Bcrypt 仅用于验旧哈希（对齐官方模板 security.py:11）。

    pwdlib 装不上时**直接抛**，不做降级——密码哈希没有"弱一点也能用"的选项。
    这跟本项目其他地方的 fail-open 取向不同，是刻意的：缩略图压不动只是浪费带宽，
    密码哈希降级是把所有人的密码置于风险中。
    """
    global _hasher
    with _hasher_lock:
        if _hasher is not None:
            return _hasher
        from pwdlib import PasswordHash
        from pwdlib.hashers.argon2 import Argon2Hasher

        hashers = [Argon2Hasher()]
        try:
            from pwdlib.hashers.bcrypt import BcryptHasher

            hashers.append(BcryptHasher())  # 只用于校验历史哈希，不用于新写入
        except Exception:  # noqa: BLE001 — 没有 bcrypt 也能跑，只是验不了旧哈希
            pass
        _hasher = PasswordHash(tuple(hashers))
        return _hasher


def hash_password(password: str) -> str:
    return _password_hasher().hash(password)


# Node 侧遗留账号体系的哈希格式（server/auth/password.ts:10）：
#     scrypt:{saltHex}:{derivedHex}
# 注意两个容易写错的地方：
#   ① Node 的 `scrypt(password, salt, 64)` 把 salt 当**字符串**用，所以盐是那串
#      十六进制的 ASCII 字节，不是解码后的 16 字节；
#   ② Node 的默认参数是 N=16384, r=8, p=1，dklen 由第三参给定（这里 64）。
# 任何一处不一致都会全部验不过，而表现是"所有老用户密码都错"——很难往这想。
_NODE_SCRYPT_N = 16384
_NODE_SCRYPT_R = 8
_NODE_SCRYPT_P = 1


def _verify_node_scrypt(password: str, stored: str) -> bool:
    """验 Node 遗留的 scrypt 哈希。用于把老账号迁过来而不强制改密码。"""
    import hashlib as _h
    import hmac as _hm

    parts = stored.split(":")
    if len(parts) != 3 or parts[0] != "scrypt" or not parts[1] or not parts[2]:
        return False
    _, salt_hex, hash_hex = parts
    try:
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    try:
        actual = _h.scrypt(
            (password or "").encode(),
            salt=salt_hex.encode(),  # ① 十六进制串本身当盐
            n=_NODE_SCRYPT_N,
            r=_NODE_SCRYPT_R,
            p=_NODE_SCRYPT_P,
            dklen=len(expected),
            maxmem=64 * 1024 * 1024,  # Node 默认 32MB 上限，给足余量
        )
    except (ValueError, MemoryError):
        return False
    return _hm.compare_digest(actual, expected)  # 定长比较，不给时序侧信道


def verify_password(password: str, stored: str) -> tuple[bool, Optional[str]]:
    """返回 (是否通过, 需要写回的新哈希或 None)。

    第二个返回值是**算法升级**用的：旧哈希验过之后给出一个 Argon2 的新哈希，
    调用方写回去即可。用户无感，不用强制改密码——这正是官方模板
    `verify_and_update` 的用途（security.py:29）。

    除 pwdlib 支持的算法外，额外认 Node 侧遗留的 scrypt 格式，让现有账号体系
    （server/auth/password.ts）里的用户可以直接迁过来。
    """
    stored = stored or ""
    if stored.startswith("scrypt:"):
        if _verify_node_scrypt(password, stored):
            return (True, hash_password(password))  # 就地升级成 Argon2
        return (False, None)
    try:
        return _password_hasher().verify_and_update(password, stored)
    except Exception:  # noqa: BLE001 — 哈希串损坏/算法未知一律判失败
        return (False, None)


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(email: str) -> str:
    """统一小写去空白。

    不做 gmail 的 dot/plus 归一化——那是各家邮箱自己的规则，替用户"聪明"地
    合并地址会让两个本来不同的账号撞在一起。
    """
    return (email or "").strip().lower()


def validate_email(email: str) -> Optional[str]:
    if not email:
        return "邮箱不能为空"
    if len(email) > 254:  # RFC 5321
        return "邮箱过长"
    if not _EMAIL_RE.match(email):
        return "邮箱格式不正确"
    return None


def validate_password(password: str) -> Optional[str]:
    """只卡长度，不卡"必须含大写/数字/符号"。

    NIST SP 800-63B 明确建议**不要**强制复合字符规则——它促使用户造出
    `Passw0rd!` 这类可预测的密码，实测效果不如单纯要求长度。
    """
    if not isinstance(password, str) or len(password) < _MIN_PASSWORD_LEN:
        return f"密码至少 {_MIN_PASSWORD_LEN} 位"
    if len(password) > 128:
        return "密码过长（最多 128 位）"  # 防 Argon2 被超长输入拖慢
    return None


def new_email_code() -> str:
    """6 位数字验证码，用 secrets 而不是 random——后者可预测。"""
    return f"{secrets.randbelow(1_000_000):06d}"


# ────────────────────────── 存储 ──────────────────────────

_DDL_PG = f"""
create table if not exists {TABLE} (
    id varchar(64) primary key,
    email varchar(254) not null unique,
    password_hash text not null,
    is_active boolean not null default true,
    is_superuser boolean not null default false,
    is_verified boolean not null default false,
    display_name varchar(120),
    created_at timestamptz,
    last_login_at timestamptz
)
"""

_DDL_SQLITE = f"""
create table if not exists {TABLE} (
    id varchar(64) primary key,
    email varchar(254) not null unique,
    password_hash text not null,
    is_active integer not null default 1,
    is_superuser integer not null default 0,
    is_verified integer not null default 0,
    display_name varchar(120),
    created_at text,
    last_login_at text
)
"""

_CODE_TABLE = "sliderule_email_code"

_CODE_DDL_PG = f"""
create table if not exists {_CODE_TABLE} (
    email varchar(254) primary key,
    code_hash text not null,
    purpose varchar(32) not null,
    attempts integer not null default 0,
    sent_at timestamptz,
    expires_at timestamptz
)
"""

_CODE_DDL_SQLITE = f"""
create table if not exists {_CODE_TABLE} (
    email varchar(254) primary key,
    code_hash text not null,
    purpose varchar(32) not null,
    attempts integer not null default 0,
    sent_at text,
    expires_at text
)
"""


class User(dict):
    """用户记录。用 dict 子类而不是 pydantic 模型——这一层要能被三种后端
    （SQLAlchemy / Neon HTTP / SQLite）用同一份代码产出，dict 最省事。"""

    @property
    def id(self) -> str:
        return str(self.get("id") or "")

    @property
    def email(self) -> str:
        return str(self.get("email") or "")

    @property
    def is_active(self) -> bool:
        return bool(self.get("is_active"))

    @property
    def is_superuser(self) -> bool:
        return bool(self.get("is_superuser"))

    @property
    def is_verified(self) -> bool:
        return bool(self.get("is_verified"))

    def public(self) -> dict[str, Any]:
        """对外可见的字段。**password_hash 永远不出现在这里**。"""
        return {
            "id": self.id,
            "email": self.email,
            "displayName": self.get("display_name"),
            "isSuperuser": self.is_superuser,
            "isVerified": self.is_verified,
            "createdAt": self.get("created_at"),
        }


class IdentityStore:
    """身份存储。三种后端共用这一个类，差异只在 `_q` 怎么执行 SQL。"""

    def __init__(self, executor: Any, *, is_sqlite: bool) -> None:
        self._x = executor
        self._is_sqlite = is_sqlite
        self._x.execute(_DDL_SQLITE if is_sqlite else _DDL_PG)
        self._x.execute(_CODE_DDL_SQLITE if is_sqlite else _CODE_DDL_PG)

    # ── 用户 ──────────────────────────────────────────
    def get_by_email(self, email: str) -> Optional[User]:
        rows = self._x.query(
            f"select * from {TABLE} where email = {self._x.ph(1)}", [normalize_email(email)]
        )
        return User(rows[0]) if rows else None

    def get_by_id(self, user_id: str) -> Optional[User]:
        rows = self._x.query(f"select * from {TABLE} where id = {self._x.ph(1)}", [user_id])
        return User(rows[0]) if rows else None

    def count(self) -> int:
        rows = self._x.query(f"select count(*) as n from {TABLE}", [])
        # ⚠️ Neon HTTP 端点对 count(*)（int8）返回的是**字符串**，必须显式转
        # （见 app_store._neon_normalize_row 里对真库逐类型的实测说明）。
        return int(rows[0]["n"]) if rows else 0

    def create(
        self,
        email: str,
        password_hash: str,
        *,
        is_superuser: bool = False,
        is_verified: bool = False,
        display_name: Optional[str] = None,
    ) -> User:
        uid = secrets.token_urlsafe(16)
        p = self._x.ph
        self._x.execute(
            f"insert into {TABLE} (id, email, password_hash, is_active, is_superuser,"
            f" is_verified, display_name, created_at)"
            f" values ({p(1)},{p(2)},{p(3)},{p(4)},{p(5)},{p(6)},{p(7)},{p(8)})",
            [
                uid,
                normalize_email(email),
                password_hash,
                True,
                is_superuser,
                is_verified,
                display_name,
                _now_iso(),
            ],
        )
        created = self.get_by_id(uid)
        assert created is not None
        return created

    def set_password_hash(self, user_id: str, password_hash: str) -> None:
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set password_hash = {p(1)} where id = {p(2)}",
            [password_hash, user_id],
        )

    def mark_verified(self, user_id: str) -> None:
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set is_verified = {p(1)} where id = {p(2)}", [True, user_id]
        )

    def touch_login(self, user_id: str) -> None:
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set last_login_at = {p(1)} where id = {p(2)}",
            [_now_iso(), user_id],
        )

    def set_superuser(self, user_id: str, value: bool) -> None:
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set is_superuser = {p(1)} where id = {p(2)}", [value, user_id]
        )

    # ── 邮箱验证码 ────────────────────────────────────
    def put_code(self, email: str, code_hash: str, purpose: str) -> None:
        """一个邮箱同一时刻只保留一个有效码（主键是 email，直接覆盖）。

        这样"重发"天然作废旧码，不会出现多个码同时有效——那是常见的实现漏洞。
        """
        p = self._x.ph
        email = normalize_email(email)
        now = _now()
        expires = datetime.fromtimestamp(now.timestamp() + EMAIL_CODE_TTL_S, tz=timezone.utc)
        self._x.execute(f"delete from {_CODE_TABLE} where email = {p(1)}", [email])
        self._x.execute(
            f"insert into {_CODE_TABLE} (email, code_hash, purpose, attempts, sent_at, expires_at)"
            f" values ({p(1)},{p(2)},{p(3)},0,{p(4)},{p(5)})",
            [email, code_hash, purpose, now.isoformat(), expires.isoformat()],
        )

    def get_code(self, email: str) -> Optional[dict[str, Any]]:
        rows = self._x.query(
            f"select * from {_CODE_TABLE} where email = {self._x.ph(1)}",
            [normalize_email(email)],
        )
        return rows[0] if rows else None

    def bump_code_attempts(self, email: str) -> int:
        p = self._x.ph
        self._x.execute(
            f"update {_CODE_TABLE} set attempts = attempts + 1 where email = {p(1)}",
            [normalize_email(email)],
        )
        rec = self.get_code(email)
        return int(rec["attempts"]) if rec else 0

    def drop_code(self, email: str) -> None:
        self._x.execute(
            f"delete from {_CODE_TABLE} where email = {self._x.ph(1)}", [normalize_email(email)]
        )


# ────────────────────────── 执行器：三种后端 ──────────────────────────


class _SqlExecutor:
    """SQLAlchemy 执行器（Postgres / SQLite）。"""

    def __init__(self, url: str) -> None:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        from .app_store import _sql_engine_config

        self._text = text
        connect_args, kwargs = _sql_engine_config(url, NullPool)
        self._engine = create_engine(url, connect_args=connect_args, **kwargs)
        self.is_sqlite = url.startswith("sqlite")

    def ph(self, n: int) -> str:
        return f":p{n}"

    def _bind(self, params: list[Any]) -> dict[str, Any]:
        return {f"p{i + 1}": v for i, v in enumerate(params)}

    def query(self, sql: str, params: list[Any]) -> list[dict[str, Any]]:
        with self._engine.connect() as conn:
            rows = conn.execute(self._text(sql), self._bind(params)).mappings().all()
        return [dict(r) for r in rows]

    def execute(self, sql: str, params: Optional[list[Any]] = None) -> None:
        with self._engine.begin() as conn:
            conn.execute(self._text(sql), self._bind(params or []))


class _NeonHttpExecutor:
    """Neon SQL-over-HTTP 执行器。受限网络只放行 443 时的通道。"""

    def __init__(self, database_url: str, endpoint: str) -> None:
        import httpx

        self.is_sqlite = False
        self._endpoint = endpoint
        self._client = httpx.Client(
            timeout=15,
            headers={
                "Neon-Connection-String": database_url,  # 凭据只在头里，不进日志
                "Content-Type": "application/json",
            },
        )

    def ph(self, n: int) -> str:
        return f"${n}"

    def query(self, sql: str, params: list[Any]) -> list[dict[str, Any]]:
        from .app_store import _neon_http_error

        resp = self._client.post(self._endpoint, json={"query": sql, "params": params})
        if resp.status_code >= 400:
            raise _neon_http_error(resp)
        return resp.json().get("rows") or []

    def execute(self, sql: str, params: Optional[list[Any]] = None) -> None:
        self.query(sql, params or [])


# ────────────────────────── 单例 ──────────────────────────

_store_lock = threading.Lock()
_store: Optional[IdentityStore] = None
_store_sig: Optional[str] = None

# 没配远端库时，身份落这个本地 SQLite。与 App Store 的本地档同一取向。
_LOCAL_SQLITE = "sqlite:///data/sliderule-identity.db"


def _signature() -> str:
    from config.settings import settings

    from .app_store import prefer_neon_http

    return f"{(getattr(settings, 'APP_STORE_DATABASE_URL', '') or '').strip()}|{int(prefer_neon_http())}"


def get_identity_store() -> IdentityStore:
    """身份存储单例。

    ⚠️ 与本项目其他存储不同，**这一层不 fail-open 到"没有存储"**：身份查不到
    就该拒绝登录，而不是放行。降级只发生在"用哪个库"这一层（远端 → 本地
    SQLite），不会降级成"跳过校验"。
    """
    global _store, _store_sig
    with _store_lock:
        sig = _signature()
        if _store is not None and _store_sig == sig:
            return _store
        _store = _build_store()
        _store_sig = sig
        return _store


def _build_store() -> IdentityStore:
    from pathlib import Path

    from config.settings import settings

    from .app_store import neon_http_endpoint, prefer_neon_http

    url = (getattr(settings, "APP_STORE_DATABASE_URL", "") or "").strip()
    if url:
        endpoint = neon_http_endpoint(url)
        if prefer_neon_http() and endpoint:
            try:
                x = _NeonHttpExecutor(url, endpoint)
                print("[identity] 身份存储：Neon SQL over HTTP")
                return IdentityStore(x, is_sqlite=False)
            except Exception as exc:  # noqa: BLE001
                print(f"[identity] HTTP 通道不可用，继续降级: {str(exc)[:200]}")
        try:
            x = _SqlExecutor(url)
            print("[identity] 身份存储：远端数据库（TCP）")
            return IdentityStore(x, is_sqlite=x.is_sqlite)
        except Exception as exc:  # noqa: BLE001
            tcp_err = str(exc)[:200]
            if endpoint:
                try:
                    x2 = _NeonHttpExecutor(url, endpoint)
                    print(f"[identity] TCP 不可用（{tcp_err}），改走 Neon SQL over HTTP")
                    return IdentityStore(x2, is_sqlite=False)
                except Exception as http_exc:  # noqa: BLE001
                    print(f"[identity] 远端两条通道均不可用: HTTP={str(http_exc)[:200]}")
            print(f"[identity] 远端不可用，身份改存本地 SQLite（不跨机器共享）: {tcp_err}")

    local = (os.getenv("SLIDERULE_IDENTITY_SQLITE") or _LOCAL_SQLITE).strip()
    if local.startswith("sqlite:///"):
        Path(local[len("sqlite:///") :]).parent.mkdir(parents=True, exist_ok=True)
    x = _SqlExecutor(local)
    return IdentityStore(x, is_sqlite=True)


def reset_identity_cache() -> None:
    """测试用。"""
    global _store, _store_sig
    with _store_lock:
        _store = None
        _store_sig = None
