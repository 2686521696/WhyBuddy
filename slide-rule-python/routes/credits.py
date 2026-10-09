"""积分接口。照 New API 的 controller/user.go（余额、兑换）、controller/redemption.go（兑换码）、controller/log.go（明细）。

⚠ 2026-10-09 积分制（services.credit_ledger 头注）。用户三个：看余额、兑换、看明细；超管在
  /account/admin/credits/* 下（跟现有管理台同一个前缀，Node 的 requireAdmin 与这里的 SuperUser 双层守）：
  用户额度与调额、兑换码、价格设置、全站明细。

数额对外一律用「积分」（100 积分 = 1 美元），同时给原始额度，前端不用自己换算。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from middlewares.current_user import CurrentUser, SuperUser
from services.credit_ledger import LOG_KINDS, CreditError, CreditUnavailable
from services.credit_ledger import QUOTA_PER_POINT, points_to_quota, quota_to_points
from services.credit_service import account_view, configure, get_credit_store
from services.identity_store import get_identity_store
from services.project_store import get_project_store

router = APIRouter()


def _superuser(owner_id: str) -> bool:
    user = get_identity_store().get_by_id(owner_id)
    return bool(user and user.is_superuser)


def install_credit_wiring() -> None:
    """账本接到工程存储那个库、超管从身份库查。app.py 启动时调（credit_service.configure 的注释）。"""
    configure(project_store_provider=get_project_store, superuser_lookup=_superuser)


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except CreditError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CreditUnavailable as exc:
        raise HTTPException(status_code=503, detail="credit_store_unavailable") from exc


async def _call(fn, *args, **kwargs):
    return await asyncio.to_thread(_run, fn, *args, **kwargs)


def _points_log(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "points": quota_to_points(row["quota"]),
            "balancePoints": None if row["balanceAfter"] is None else quota_to_points(row["balanceAfter"])}


def _page(page: int, size: int) -> tuple[int, int]:
    size = max(1, min(int(size), 100))
    return size, (max(1, int(page)) - 1) * size


# ── 用户 ────────────────────────────────────────────────────────────────

@router.get("/credits/me")
async def my_credits(viewer: CurrentUser):
    store = await asyncio.to_thread(get_credit_store)
    account = await _call(store.account, str(viewer.id))
    options = await _call(store.options)
    return {"account": account_view(account), "quotaPerPoint": QUOTA_PER_POINT,
            "exempt": bool(viewer.is_superuser and options["superuser_exempt"]),
            "enforced": bool(options["enforcement_enabled"])}


class RedeemBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=64)


@router.post("/credits/redeem")
async def redeem_code(body: RedeemBody, viewer: CurrentUser):
    store = await asyncio.to_thread(get_credit_store)
    quota = await _call(store.redeem, str(viewer.id), body.code)
    account = await _call(store.account, str(viewer.id))
    return {"quota": quota, "points": quota_to_points(quota), "account": account_view(account)}


@router.get("/credits/logs")
async def my_credit_logs(viewer: CurrentUser, page: int = Query(default=1, ge=1),
                         size: int = Query(default=20, ge=1, le=100)):
    store = await asyncio.to_thread(get_credit_store)
    limit, offset = _page(page, size)
    rows, total = await _call(store.logs, owner_id=str(viewer.id), limit=limit, offset=offset)
    return {"items": [_points_log(row) for row in rows], "total": total, "page": page, "size": limit}


# ── 超管 ────────────────────────────────────────────────────────────────

@router.get("/account/admin/credits/users")
async def admin_credit_users(_admin: SuperUser, q: str = Query(default=""),
                             page: int = Query(default=1, ge=1), size: int = Query(default=20, ge=1, le=100)):
    """全站用户的额度。还没用过额度的账号没有账户行，显示「尚未开户」，第一次用到时按新用户赠送开户。"""
    needle = str(q or "").strip().lower()

    def _go() -> dict[str, Any]:
        users = get_identity_store().list_users(limit=5000)
        if needle:
            users = [user for user in users if needle in user.email.lower() or needle in user.id.lower()
                     or needle in str(user.get("display_name") or user.get("name") or "").lower()]
        limit, offset = _page(page, size)
        chunk = users[offset:offset + limit]
        accounts = get_credit_store().accounts([user.id for user in chunk])
        items = []
        for user in chunk:
            account = accounts.get(user.id)
            items.append({"id": user.id, "email": user.email,
                          "name": user.get("display_name") or user.get("name") or "",
                          "isSuperuser": user.is_superuser,
                          "account": account_view(account) if account else None})
        return {"items": items, "total": len(users), "page": page, "size": limit}

    return await _call(_go)


class AdjustBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["add", "set"] = "add"
    points: float = Field(ge=-1_000_000, le=1_000_000)
    note: str = Field(default="", max_length=200)


@router.post("/account/admin/credits/users/{user_id}/adjust")
async def admin_adjust_credits(user_id: str, body: AdjustBody, admin: SuperUser):
    """增减（add）或直接设成（set）多少积分。记一条「管理」明细，写明是谁、为什么。"""
    store = await asyncio.to_thread(get_credit_store)

    def _go() -> dict[str, Any]:
        current = store.account(user_id)["quota"]
        target = points_to_quota(body.points)
        delta = target - current if body.mode == "set" else target
        note = (body.note or "").strip() or ("超管设定余额" if body.mode == "set" else "超管调整")
        if delta != 0:
            store.credit(user_id, delta, kind="manage", actor=admin.email or admin.id, note=note)
        return {"account": account_view(store.account(user_id)), "deltaPoints": quota_to_points(delta)}

    return await _call(_go)


@router.get("/account/admin/credits/logs")
async def admin_credit_logs(_admin: SuperUser, userId: str = Query(default=""), kind: str = Query(default=""),
                            page: int = Query(default=1, ge=1), size: int = Query(default=20, ge=1, le=100)):
    if kind and kind not in LOG_KINDS:
        raise HTTPException(status_code=400, detail="credit_log_kind_invalid")
    store = await asyncio.to_thread(get_credit_store)
    limit, offset = _page(page, size)
    rows, total = await _call(store.logs, owner_id=userId or None, kind=kind or None, limit=limit, offset=offset)
    return {"items": [_points_log(row) for row in rows], "total": total, "page": page, "size": limit}


@router.get("/account/admin/credits/codes")
async def admin_list_codes(_admin: SuperUser, keyword: str = Query(default=""), status: str = Query(default=""),
                           page: int = Query(default=1, ge=1), size: int = Query(default=20, ge=1, le=100)):
    store = await asyncio.to_thread(get_credit_store)
    limit, offset = _page(page, size)
    rows, total = await _call(store.codes, keyword=keyword, status=status, limit=limit, offset=offset)
    return {"items": [{**row, "points": quota_to_points(row["quota"])} for row in rows],
            "total": total, "page": page, "size": limit}


class CreateCodesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    points: float = Field(gt=0, le=1_000_000)
    count: int = Field(ge=1, le=500)
    expiresAt: Optional[float] = Field(default=None, ge=0)


@router.post("/account/admin/credits/codes")
async def admin_create_codes(body: CreateCodesBody, admin: SuperUser):
    """批量生成，一次最多 500 个。返回码本身——只在这一刻成批给出，方便导出发给用户。"""
    store = await asyncio.to_thread(get_credit_store)
    created = await _call(store.create_codes, name=body.name, quota=points_to_quota(body.points),
                          count=body.count, actor=admin.email or admin.id, expires_at=body.expiresAt or 0)
    return {"items": [{**row, "points": quota_to_points(row["quota"])} for row in created]}


class CodeStatusBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["enabled", "disabled"]


@router.patch("/account/admin/credits/codes/{code_id}")
async def admin_set_code_status(code_id: str, body: CodeStatusBody, _admin: SuperUser):
    store = await asyncio.to_thread(get_credit_store)
    await _call(store.set_code_status, code_id, 1 if body.status == "enabled" else 2)
    return {"ok": True}


@router.delete("/account/admin/credits/codes/{code_id}")
async def admin_delete_code(code_id: str, _admin: SuperUser):
    store = await asyncio.to_thread(get_credit_store)
    await _call(store.delete_code, code_id)
    return {"ok": True}


def _options_view(options: dict[str, Any]) -> dict[str, Any]:
    return {**options, "quotaForNewUserPoints": quota_to_points(options["quota_for_new_user"]),
            "computerPointsPerHour": quota_to_points(options["computer_quota_per_minute"] * 60),
            "imagePoints": quota_to_points(options["image_quota"]), "quotaPerPoint": QUOTA_PER_POINT,
            "fetchedAt": time.time()}


@router.get("/account/admin/credits/options")
async def admin_get_credit_options(_admin: SuperUser):
    store = await asyncio.to_thread(get_credit_store)
    return _options_view(await _call(store.options, fresh=True))


@router.put("/account/admin/credits/options")
async def admin_set_credit_options(patch: dict[str, Any], admin: SuperUser):
    store = await asyncio.to_thread(get_credit_store)
    return _options_view(await _call(store.set_options, patch, actor=admin.email or admin.id))
