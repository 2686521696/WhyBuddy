"""积分的算法：一次模型调用 / 一分钟电脑 / 一张图，折成多少额度。纯函数，叶子。

⚠ 2026-10-09 迁到新服务器、上线开关改成 public（所有登录账号都走工程新路径）之后，任何人注册就能开 E2B 电脑、
  调模型，费用全记在平台的账上，而按账号的额度一行都没有（后台显示的「tokens」是前端按字数除以 4 估的，人人是 0）。
  用户拍板：照抄 New API（QuantumNous/new-api）的额度制——预付、兑换码、超管调额、额度明细。

单位照 New API（common/constants.go）：QuotaPerUnit = 500000 额度 = 1 美元；倍率 1 = $0.002 / 1K token。
扣费公式照 service/quota.go：
    额度 = 向上取整((未命中缓存的输入 + 命中缓存的输入 × 缓存倍率 + 输出 × 补全倍率) × 模型倍率)
New API 还有「分组倍率」，我们没有分组，等于恒为 1，不抄。
界面上用「积分」：100 积分 = 1 美元（= 5000 额度一积分），比七位数的额度好读。

New API 只管模型；我们还有 E2B 电脑和生图两笔，各给一个固定价（每分钟 / 每张），同样折成额度，记进同一本账。
默认价是估的（E2B 2 核 4G 约 $0.17/小时；未知模型按 $2.5/M 输入、$20/M 输出），超管后台能改，改了立即生效。

── 账本 ──

积分账本：余额、明细、兑换码、价格设置四张表。照 New API 的 model/user.go、model/redemption.go、model/log.go。

⚠ 2026-10-09 上线开关改成 public 后，任何登录账号都能开 E2B 电脑、调模型，费用没有按账号的上限（credit_ledger 头注）。

跟 New API 的对应：
    users.quota / used_quota / request_count   → wb_credit_account
    redemptions（key / status 1 可用 2 禁用 3 已用 / expired_time）→ wb_credit_redemption
    logs（type 1 充值 2 消费 3 管理 4 系统）    → wb_credit_log.kind = topup / consume / manage / system
    options 表里的倍率、新用户赠送              → wb_credit_option

几处跟 New API 一样的讲究：
- 扣费是一条原子的 `quota = quota - x`，不读改写，并发调用不会算丢。
- 兑换先比对状态再改写（`where status = 1` 改成 3），只有改成功的那一次加额度——同一个码两个人同时兑，只有一个拿到。
  New API 这么写是为了 SQLite 没有行锁；我们的 HTTP SQL 网关每条语句各自一个事务，同理。
- 余额允许被扣成负数：一次调用已经花出去的钱如实记账，拦截发生在下一次开始之前（credit_service）。

不同的一处：明细的 ref 唯一。带外部凭据的扣费（一个工程操作的电脑时长）先登记凭据再扣，重复结算只扣一次。

叶子（util）：只认注入的 query，不 import services 里任何模块——拼装（接到哪个库、谁是超管）在 services.credit_service。
⚠ 2026-10-10 第一版把算法单放 credit_pricing、账本放 core、装配放 flow：flow 层多一个（只许变短，test_architecture 钉着），
  于是算法并进这里成叶子，装配降到 core、库和身份由 app.py 启动时注入。
"""

from __future__ import annotations

import json
import math
import secrets
import time
import uuid
from typing import Any, Callable, Mapping


#: 1 美元 = 多少额度（New API 的 QuotaPerUnit）。
QUOTA_PER_UNIT = 500_000
#: 1 积分 = 多少额度：100 积分 = 1 美元。
QUOTA_PER_POINT = QUOTA_PER_UNIT // 100

#: 超管后台能改的全部选项及默认值。键名就是存进 wb_credit_option 的键。
DEFAULT_OPTIONS: dict[str, Any] = {
    # 新账号（第一次用到额度时）送多少：2000 积分 = $20（2026-10-10 用户定：500 → 2000）。
    # ⚠ 这只是默认值：超管后台「额度设置」点过保存，库里 wb_credit_option 就存了一份，以库里为准，
    #   改这里不影响已经存过的环境——那边要在后台改。
    "quota_for_new_user": 2000 * QUOTA_PER_POINT,
    # 没在下面三张表里点名的模型用这一组。1.25 = $2.5/M 输入；补全 8 倍 = $20/M 输出；缓存命中按输入的 1/10。
    "default_model_ratio": 1.25,
    "default_completion_ratio": 8.0,
    "default_cache_ratio": 0.1,
    # 按模型名单独定价：{"gpt-5": 0.625}。键可以是前缀（最长前缀胜出）。
    "model_ratio": {},
    "completion_ratio": {},
    "cache_ratio": {},
    # E2B 电脑每分钟多少额度：1500 × 60 = 90000/小时 = $0.18/小时。
    "computer_quota_per_minute": 1_500,
    # 生图每张多少额度：$0.04。
    "image_quota": 20_000,
    # 关掉就只记账、不拦截（出了问题的逃生口）。
    "enforcement_enabled": True,
    # 超管照记账、不拦截（自己测试不被自己卡住）。
    "superuser_exempt": True,
}

_FLOAT_KEYS = ("default_model_ratio", "default_completion_ratio", "default_cache_ratio")
_INT_KEYS = ("quota_for_new_user", "computer_quota_per_minute", "image_quota")
_MAP_KEYS = ("model_ratio", "completion_ratio", "cache_ratio")
_BOOL_KEYS = ("enforcement_enabled", "superuser_exempt")


def normalize_options(raw: Mapping[str, Any] | None) -> dict[str, Any]:
    """库里存的（可能缺键、类型不对）合上默认值，得到一份能直接用的选项。坏值退回默认，不抛。"""
    options = dict(DEFAULT_OPTIONS)
    for key, value in (raw or {}).items():
        if key not in DEFAULT_OPTIONS:
            continue
        try:
            if key in _FLOAT_KEYS:
                number = float(value)
                if math.isfinite(number) and number >= 0:
                    options[key] = number
            elif key in _INT_KEYS:
                number = int(value)
                if number >= 0:
                    options[key] = number
            elif key in _MAP_KEYS:
                if isinstance(value, Mapping):
                    options[key] = {str(name): float(ratio) for name, ratio in value.items()
                                    if math.isfinite(float(ratio)) and float(ratio) >= 0}
            elif key in _BOOL_KEYS and isinstance(value, bool):
                # 只认真的 true / false（超管页存的是 JSON 布尔）。不手抄真假词表（tests/test_env_flags.py 钉着）。
                options[key] = value
        except (TypeError, ValueError):
            continue
    return options


def _lookup(table: Mapping[str, float], model: str, default: float) -> float:
    """先认全名，再认最长前缀（gpt-5 定了价，gpt-5-2025-08-07 也按它算），都没有用默认。"""
    name = (model or "").strip().lower()
    if not name:
        return default
    lowered = {str(key).lower(): value for key, value in table.items()}
    if name in lowered:
        return lowered[name]
    best = max((key for key in lowered if name.startswith(key)), key=len, default=None)
    return lowered[best] if best is not None else default


def model_ratios(model: str, options: Mapping[str, Any]) -> tuple[float, float, float]:
    """(模型倍率, 补全倍率, 缓存倍率)。"""
    return (_lookup(options["model_ratio"], model, options["default_model_ratio"]),
            _lookup(options["completion_ratio"], model, options["default_completion_ratio"]),
            _lookup(options["cache_ratio"], model, options["default_cache_ratio"]))


def _int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def usage_tokens(usage: Mapping[str, Any] | None) -> tuple[int, int, int]:
    """(输入, 其中命中缓存的, 输出)。chat/completions 与 responses 两种写法都认。"""
    data = usage if isinstance(usage, Mapping) else {}
    prompt = _int(data.get("prompt_tokens") or data.get("input_tokens"))
    completion = _int(data.get("completion_tokens") or data.get("output_tokens"))
    details = data.get("prompt_tokens_details") or data.get("input_tokens_details") or {}
    cached = _int(details.get("cached_tokens")) if isinstance(details, Mapping) else 0
    return prompt, min(cached, prompt), completion


def llm_quota(model: str, usage: Mapping[str, Any] | None, options: Mapping[str, Any]) -> int:
    """一次模型调用的额度。没有用量（服务商没报）就是 0——不猜。"""
    prompt, cached, completion = usage_tokens(usage)
    if prompt == 0 and completion == 0:
        return 0
    model_ratio, completion_ratio, cache_ratio = model_ratios(model, options)
    raw = ((prompt - cached) + cached * cache_ratio + completion * completion_ratio) * model_ratio
    quota = math.ceil(raw)
    # New API：倍率不为 0、算出来却是 0 的，至少扣 1。
    return max(quota, 1) if model_ratio > 0 else 0


def computer_quota(seconds: float, options: Mapping[str, Any]) -> int:
    """电脑开了 seconds 秒的额度，按秒折算、向上取整。"""
    if not seconds or seconds <= 0:
        return 0
    return math.ceil(seconds * options["computer_quota_per_minute"] / 60)


def quota_to_points(quota: int) -> float:
    return round(quota / QUOTA_PER_POINT, 2)


def points_to_quota(points: float) -> int:
    return int(round(float(points) * QUOTA_PER_POINT))


# ── 账本 ──────────────────────────────────────────────────────────────────

Query = Callable[[str, list[Any]], list[dict[str, Any]]]

CODE_ENABLED, CODE_DISABLED, CODE_USED = 1, 2, 3
LOG_KINDS = ("topup", "consume", "manage", "system")
MAX_CODES_PER_BATCH = 500

_DDL = (
    "create table if not exists wb_credit_account (owner_id varchar(240) primary key, quota bigint not null, "
    "used_quota bigint not null default 0, request_count integer not null default 0, "
    "created_at double precision not null, updated_at double precision not null)",
    "create table if not exists wb_credit_log (id varchar(80) primary key, ref varchar(240) not null unique, "
    "owner_id varchar(240) not null, kind varchar(20) not null, quota bigint not null, balance_after bigint, "
    "model varchar(160), prompt_tokens integer, cached_tokens integer, completion_tokens integer, "
    "seconds double precision, note text, actor varchar(240), created_at double precision not null)",
    "create index if not exists wb_credit_log_owner on wb_credit_log(owner_id, created_at)",
    "create table if not exists wb_credit_redemption (id varchar(80) primary key, code varchar(64) not null unique, "
    "name varchar(120) not null, quota bigint not null, status integer not null, created_by varchar(240), "
    "created_at double precision not null, expires_at double precision not null default 0, "
    "used_by varchar(240), used_at double precision)",
    "create table if not exists wb_credit_option (key varchar(80) primary key, value text not null, "
    "updated_at double precision not null, updated_by varchar(240))",
)


class CreditUnavailable(RuntimeError):
    """账本读写失败（库挂了）。调用方决定 fail-open 还是 fail-closed。"""


class CreditError(ValueError):
    """用户能看懂的业务错误：码不存在 / 已用 / 过期 / 参数不对。消息是给前端映射的机器码。"""


class CreditStore:
    def __init__(self, query: Query, *, dialect: str = "sqlite"):
        self._query = query
        self._dialect = dialect
        for statement in _DDL:
            self._q(statement)
        self._options_cache: tuple[float, dict[str, Any]] | None = None

    def _q(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        try:
            return self._query(sql, params or [])
        except Exception as exc:
            raise CreditUnavailable("credit_store_unavailable") from exc

    # ── 选项 ───────────────────────────────────────────────────────────────

    def options(self, *, fresh: bool = False) -> dict[str, Any]:
        """价格与开关。缓存 10 秒：每次模型调用都要读，别每次打一趟库。"""
        cached = self._options_cache
        if cached is not None and not fresh and time.monotonic() - cached[0] < 10:
            return cached[1]
        raw: dict[str, Any] = {}
        for row in self._q("select key, value from wb_credit_option", []):
            try:
                raw[row["key"]] = json.loads(row["value"])
            except (TypeError, ValueError):
                continue
        options = normalize_options(raw)
        self._options_cache = (time.monotonic(), options)
        return options

    def set_options(self, patch: dict[str, Any], *, actor: str) -> dict[str, Any]:
        known = normalize_options({})
        unknown = sorted(set(patch) - set(known))
        if unknown:
            raise CreditError("credit_option_unknown:" + ",".join(unknown))
        checked = normalize_options(patch)
        now = time.time()
        for key in patch:
            value = json.dumps(checked[key], ensure_ascii=False)
            if self._dialect == "postgresql":
                self._q("insert into wb_credit_option(key, value, updated_at, updated_by) values ($1,$2,$3,$4) "
                        "on conflict (key) do update set value=excluded.value, updated_at=excluded.updated_at, "
                        "updated_by=excluded.updated_by", [key, value, now, actor])
            else:
                self._q("insert or replace into wb_credit_option(key, value, updated_at, updated_by) "
                        "values ($1,$2,$3,$4)", [key, value, now, actor])
        self._options_cache = None
        return self.options(fresh=True)

    # ── 账户 ───────────────────────────────────────────────────────────────

    def account(self, owner_id: str) -> dict[str, Any]:
        """读余额；第一次见到的账号当场开户，送新用户额度并记一条系统明细（New API 的注册赠送）。"""
        owner_id = _owner(owner_id)
        rows = self._q("select * from wb_credit_account where owner_id=$1", [owner_id])
        if rows:
            return _account_row(rows[0])
        grant = int(self.options()["quota_for_new_user"])
        now = time.time()
        created = self._q("insert into wb_credit_account(owner_id, quota, used_quota, request_count, created_at, "
                          "updated_at) values ($1,$2,0,0,$3,$3) on conflict (owner_id) do nothing returning owner_id",
                          [owner_id, grant, now])
        if created and grant > 0:
            self._log(owner_id, "system", grant, balance_after=grant, note="新用户赠送")
        rows = self._q("select * from wb_credit_account where owner_id=$1", [owner_id])
        return _account_row(rows[0])

    def accounts(self, owner_ids: list[str]) -> dict[str, dict[str, Any]]:
        """超管列表用：只读已开户的，不替别人开户。"""
        ids = [str(item) for item in owner_ids if str(item or "").strip()]
        if not ids:
            return {}
        marks = ",".join(f"${i + 1}" for i in range(len(ids)))
        rows = self._q(f"select * from wb_credit_account where owner_id in ({marks})", ids)
        return {row["owner_id"]: _account_row(row) for row in rows}

    def consume(self, owner_id: str, quota: int, *, model: str | None = None,
                tokens: tuple[int, int, int] | None = None, seconds: float | None = None,
                ref: str | None = None, note: str | None = None) -> int | None:
        """扣 quota 额度、计一次请求。返回扣后余额；带 ref 且这笔已经记过就什么都不做、返回 None。"""
        owner_id = _owner(owner_id)
        quota = max(0, int(quota))
        self.account(owner_id)
        log_id = None
        if ref:
            # 先占凭据：同一个凭据第二次进来在这里就停，不会再扣。
            log_id = self._log(owner_id, "consume", -quota, ref=ref, model=model, tokens=tokens,
                               seconds=seconds, note=note)
            if log_id is None:
                return None
        rows = self._q("update wb_credit_account set quota=quota-$1, used_quota=used_quota+$1, "
                       "request_count=request_count+1, updated_at=$2 where owner_id=$3 returning quota",
                       [quota, time.time(), owner_id])
        balance = int(rows[0]["quota"]) if rows else None
        if log_id is not None:
            self._q("update wb_credit_log set balance_after=$1 where id=$2", [balance, log_id])
        else:
            self._log(owner_id, "consume", -quota, balance_after=balance, model=model, tokens=tokens,
                      seconds=seconds, note=note)
        return balance

    def credit(self, owner_id: str, quota: int, *, kind: str, actor: str | None = None,
               note: str | None = None, ref: str | None = None) -> int:
        """加（或超管减）额度，不动已用量。kind：topup 兑换 / manage 超管调整 / system 系统。"""
        if kind not in ("topup", "manage", "system"):
            raise CreditError("credit_kind_invalid")
        owner_id = _owner(owner_id)
        quota = int(quota)
        self.account(owner_id)
        rows = self._q("update wb_credit_account set quota=quota+$1, updated_at=$2 where owner_id=$3 returning quota",
                       [quota, time.time(), owner_id])
        balance = int(rows[0]["quota"])
        self._log(owner_id, kind, quota, balance_after=balance, actor=actor, note=note, ref=ref)
        return balance

    def _log(self, owner_id: str, kind: str, quota: int, *, balance_after: int | None = None,
             model: str | None = None, tokens: tuple[int, int, int] | None = None, seconds: float | None = None,
             note: str | None = None, actor: str | None = None, ref: str | None = None) -> str | None:
        log_id = "cl-" + uuid.uuid4().hex
        prompt, cached, completion = tokens or (None, None, None)
        rows = self._q(
            "insert into wb_credit_log(id, ref, owner_id, kind, quota, balance_after, model, prompt_tokens, "
            "cached_tokens, completion_tokens, seconds, note, actor, created_at) "
            "values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (ref) do nothing returning id",
            [log_id, ref or log_id, owner_id, kind, int(quota), balance_after, (model or None) and str(model)[:160],
             prompt, cached, completion, seconds, (note or None) and str(note)[:500], actor, time.time()])
        return log_id if rows else None

    def logs(self, *, owner_id: str | None = None, kind: str | None = None,
             limit: int = 20, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
        where, params = [], []
        if owner_id:
            params.append(str(owner_id))
            where.append(f"owner_id=${len(params)}")
        if kind:
            if kind not in LOG_KINDS:
                raise CreditError("credit_log_kind_invalid")
            params.append(kind)
            where.append(f"kind=${len(params)}")
        clause = (" where " + " and ".join(where)) if where else ""
        total = int(self._q(f"select count(*) as n from wb_credit_log{clause}", list(params))[0]["n"])
        limit, offset = max(1, min(int(limit), 200)), max(0, int(offset))
        rows = self._q(f"select * from wb_credit_log{clause} order by created_at desc, id desc "
                       f"limit ${len(params) + 1} offset ${len(params) + 2}", [*params, limit, offset])
        return [_log_row(row) for row in rows], total

    # ── 兑换码 ─────────────────────────────────────────────────────────────

    def create_codes(self, *, name: str, quota: int, count: int, actor: str,
                     expires_at: float = 0) -> list[dict[str, Any]]:
        name = str(name or "").strip()[:120]
        quota, count = int(quota), int(count)
        if not name:
            raise CreditError("credit_code_name_required")
        if quota <= 0:
            raise CreditError("credit_code_quota_invalid")
        if not 1 <= count <= MAX_CODES_PER_BATCH:
            raise CreditError("credit_code_count_invalid")
        if expires_at and float(expires_at) <= time.time():
            raise CreditError("credit_code_expiry_in_past")
        created, now = [], time.time()
        for _ in range(count):
            code = secrets.token_hex(16)          # New API：32 位，不可猜
            code_id = "cc-" + uuid.uuid4().hex
            self._q("insert into wb_credit_redemption(id, code, name, quota, status, created_by, created_at, "
                    "expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
                    [code_id, code, name, quota, CODE_ENABLED, actor, now, float(expires_at or 0)])
            created.append({"id": code_id, "code": code, "name": name, "quota": quota,
                            "status": CODE_ENABLED, "createdAt": now, "expiresAt": float(expires_at or 0)})
        return created

    def codes(self, *, keyword: str = "", status: str = "", limit: int = 20,
              offset: int = 0) -> tuple[list[dict[str, Any]], int]:
        where, params = [], []
        if keyword:
            params.append(str(keyword).strip() + "%")
            where.append(f"(name like ${len(params)} or code like ${len(params)})")
        now = time.time()
        if status == "expired":
            params.append(now)
            where.append(f"status={CODE_ENABLED} and expires_at<>0 and expires_at<${len(params)}")
        elif status == "enabled":
            params.append(now)
            where.append(f"status={CODE_ENABLED} and (expires_at=0 or expires_at>=${len(params)})")
        elif status == "disabled":
            where.append(f"status={CODE_DISABLED}")
        elif status == "used":
            where.append(f"status={CODE_USED}")
        elif status:
            raise CreditError("credit_code_status_invalid")
        clause = (" where " + " and ".join(where)) if where else ""
        total = int(self._q(f"select count(*) as n from wb_credit_redemption{clause}", list(params))[0]["n"])
        limit, offset = max(1, min(int(limit), 200)), max(0, int(offset))
        rows = self._q(f"select * from wb_credit_redemption{clause} order by created_at desc, id desc "
                       f"limit ${len(params) + 1} offset ${len(params) + 2}", [*params, limit, offset])
        return [_code_row(row) for row in rows], total

    def set_code_status(self, code_id: str, status: int) -> None:
        if status not in (CODE_ENABLED, CODE_DISABLED):
            raise CreditError("credit_code_status_invalid")
        # 用掉的码不许改回可用——否则同一个码能兑两次。
        rows = self._q("update wb_credit_redemption set status=$1 where id=$2 and status<>$3 returning id",
                       [status, code_id, CODE_USED])
        if not rows:
            raise CreditError("credit_code_not_changeable")

    def delete_code(self, code_id: str) -> None:
        rows = self._q("delete from wb_credit_redemption where id=$1 and status<>$2 returning id", [code_id, CODE_USED])
        if not rows:
            raise CreditError("credit_code_not_changeable")

    def redeem(self, owner_id: str, code: str) -> int:
        """兑换：先把码从「可用」改成「已用」，改成功的那一次才加额度。返回加了多少额度。"""
        owner_id = _owner(owner_id)
        code = str(code or "").strip()
        if not code:
            raise CreditError("credit_code_required")
        now = time.time()
        claimed = self._q(
            "update wb_credit_redemption set status=$1, used_by=$2, used_at=$3 "
            "where code=$4 and status=$5 and (expires_at=0 or expires_at>=$3) returning id, quota",
            [CODE_USED, owner_id, now, code, CODE_ENABLED])
        if not claimed:
            rows = self._q("select status, expires_at from wb_credit_redemption where code=$1", [code])
            if not rows:
                raise CreditError("credit_code_invalid")
            row = rows[0]
            if int(row["status"]) == CODE_USED:
                raise CreditError("credit_code_used")
            if int(row["status"]) == CODE_DISABLED:
                raise CreditError("credit_code_disabled")
            raise CreditError("credit_code_expired")
        code_id, quota = claimed[0]["id"], int(claimed[0]["quota"])
        try:
            self.credit(owner_id, quota, kind="topup", note="兑换码充值", ref="redeem:" + code_id)
        except Exception:
            # 码已经标成用掉、额度却没加上：退回可用，别让用户白丢一个码。
            self._q("update wb_credit_redemption set status=$1, used_by=null, used_at=null where id=$2 and used_by=$3",
                    [CODE_ENABLED, code_id, owner_id])
            raise
        return quota


def _owner(owner_id: str) -> str:
    value = str(owner_id or "").strip()
    if not value:
        raise CreditError("credit_owner_required")
    return value


def _account_row(row: dict[str, Any]) -> dict[str, Any]:
    return {"ownerId": row["owner_id"], "quota": int(row["quota"]), "usedQuota": int(row["used_quota"]),
            "requestCount": int(row["request_count"]), "createdAt": float(row["created_at"]),
            "updatedAt": float(row["updated_at"])}


def _log_row(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "ownerId": row["owner_id"], "kind": row["kind"], "quota": int(row["quota"]),
            "balanceAfter": None if row.get("balance_after") is None else int(row["balance_after"]),
            "model": row.get("model"), "promptTokens": row.get("prompt_tokens"),
            "cachedTokens": row.get("cached_tokens"), "completionTokens": row.get("completion_tokens"),
            "seconds": row.get("seconds"), "note": row.get("note"), "actor": row.get("actor"),
            "createdAt": float(row["created_at"])}


def _code_row(row: dict[str, Any]) -> dict[str, Any]:
    status = int(row["status"])
    expires_at = float(row.get("expires_at") or 0)
    expired = status == CODE_ENABLED and expires_at and expires_at < time.time()
    return {"id": row["id"], "code": row["code"], "name": row["name"], "quota": int(row["quota"]),
            "status": "expired" if expired else {CODE_ENABLED: "enabled", CODE_DISABLED: "disabled",
                                                 CODE_USED: "used"}.get(status, "unknown"),
            "createdBy": row.get("created_by"), "createdAt": float(row["created_at"]),
            "expiresAt": expires_at, "usedBy": row.get("used_by"),
            "usedAt": None if row.get("used_at") is None else float(row["used_at"])}
