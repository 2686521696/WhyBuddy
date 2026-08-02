"""当前用户的三个依赖：匿名可读 / 必须登录 / 必须超管（2026-08-02）。

## 三档对应的产品语义

    optional_user   → User | None   没登录也能用（浏览应用中心、看应用）
    require_user    → User          必须登录（Fork、推演、改自己的东西）
    require_superuser → User        必须超管（跨用户的管理操作）

## 形状取自哪里

**fastapi-users**（MIT）把这三档做成同一个 `current_user(optional=, superuser=)`
工厂，判定走同一条路径，只在最后一步分叉
（fastapi_users/authentication/authenticator.py:189）：

    if not user and not optional:
        raise HTTPException(status_code=status_code)

这个结构值得照抄：**匿名和拒绝共用一条判定链**，不存在"匿名分支忘了做某项检查"
的可能。本文件用三个具名依赖而不是一个带参工厂，是因为 FastAPI 的 `Depends`
在具名函数下 OpenAPI 文档更清楚，而我们只需要三档、不需要 fastapi-users 那样
的动态组合。

**fastapi/full-stack-fastapi-template**（MIT）的 `api/deps.py` 贡献了两点：
  · 用 `Annotated[User, Depends(...)]` 定义可复用的类型别名，路由签名干净；
  · 超管依赖建在**已激活用户**之上，而不是直接建在 get_current_user 上
    （模板自己的 issue #537 就是踩了这个：超管没检查 is_active）。
    本文件的 require_superuser 依赖 require_user，后者已经查过 is_active。

## 令牌从哪读

Authorization: Bearer 优先，其次 Cookie。两个都支持是因为前端目前是同源部署
（Cookie 更省事、且 httpOnly 能挡 XSS 取 token），而脚本/CLI 调用惯用 Bearer。
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Cookie, Depends, Header, HTTPException, status

from services.auth_tokens import token_subject
from services.identity_store import User, get_identity_store

# Cookie 名。与前端登录后写入的名字保持一致。
AUTH_COOKIE = "sliderule_token"


def _extract_token(
    authorization: Optional[str], cookie_token: Optional[str]
) -> Optional[str]:
    if authorization:
        parts = authorization.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            candidate = parts[1].strip()
            if candidate:
                return candidate
    return (cookie_token or "").strip() or None


def optional_user(
    authorization: Annotated[Optional[str], Header()] = None,
    sliderule_token: Annotated[Optional[str], Cookie(alias=AUTH_COOKIE)] = None,
) -> Optional[User]:
    """有登录就给 User，没有就 None。**从不抛异常。**

    用在"匿名也能看"的接口上：应用中心列表、应用详情、缩略图。
    路由内部据此决定给不给写操作的入口，而不是靠前端藏按钮。
    """
    token = _extract_token(authorization, sliderule_token)
    if not token:
        return None
    user_id = token_subject(token)
    if not user_id:
        return None
    try:
        user = get_identity_store().get_by_id(user_id)
    except Exception:  # noqa: BLE001 — 身份库抖动时按匿名处理，不拖垮只读接口
        return None
    # 停用的账号等同未登录：令牌还没过期但人已经被停了，不能继续按登录态放行。
    if user is None or not user.is_active:
        return None
    return user


def require_user(user: Annotated[Optional[User], Depends(optional_user)]) -> User:
    """必须登录。用在 Fork、推演、改自己东西这类操作上。"""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_superuser(user: Annotated[User, Depends(require_user)]) -> User:
    """必须超管。

    建在 require_user 之上（而不是 optional_user）——这样 is_active 已经被查过。
    官方模板的 issue #537 正是漏了这一层：超管依赖直接建在 get_current_user 上，
    导致被停用的超管仍能通过检查。
    """
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限"
        )
    return user


CurrentUserOptional = Annotated[Optional[User], Depends(optional_user)]
CurrentUser = Annotated[User, Depends(require_user)]
SuperUser = Annotated[User, Depends(require_superuser)]


def can_write(resource_owner_id: Optional[str], user: Optional[User]) -> bool:
    """能不能改这个资源：本人或超管。

    **无主资源（owner_id 为空）不允许任何人改**——这条是刻意的。历史数据没有
    归属字段，如果判成"谁都能改"，等于新权限一上线就把所有存量应用敞开；判成
    "谁都不能改"最多是需要一次数据迁移来认领。宁可少给，不可多给。
    超管不受此限（下面单独放行），迁移期由超管代为处理。
    """
    if user is None:
        return False
    if user.is_superuser:
        return True
    if not resource_owner_id:
        return False
    return resource_owner_id == user.id
