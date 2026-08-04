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

## 自动续期（2026-08-04）

令牌过半程之后，下一次请求顺手换一张新的（滑动窗口）。7 天于是从"绝对上限"
变成"**闲置**上限"——一直在用就不会被打断，真闲置 7 天才要重新登录。

只对 **Cookie** 来路续期：Bearer 的调用方（脚本/CLI）拿不到 Set-Cookie，
给它签一张新的也没人收，白烧一次 HMAC。
"""

from __future__ import annotations

import hmac
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import Cookie, Depends, Header, HTTPException, Response, status

from services.auth_tokens import (
    DEFAULT_TTL_S,
    create_access_token,
    decode_access_token,
    password_stamp,
)
from services.identity_store import User, get_identity_store

# Cookie 名。与前端登录后写入的名字保持一致。
AUTH_COOKIE = "sliderule_token"


def _extract_bearer_token(authorization: Optional[str]) -> str:
    """只取 Authorization 里的 Bearer。续期要靠它区分来路（Cookie 才续）。"""
    if not authorization:
        return ""
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return ""


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


#: 令牌走过这么久之后就换一张新的（滑动续期，见模块头）。
#: 取 TTL 的一半：太短会让几乎每个请求都重签一次（白烧 HMAC + 每次都发
#: Set-Cookie），太长又让"快过期了"的窗口太窄，用户可能在窗口外被踢。
RENEW_AFTER_S = DEFAULT_TTL_S // 2


def _maybe_renew(
    response: Optional[Response],
    payload: dict,
    user: User,
    *,
    from_cookie: bool,
) -> None:
    """过半程就换新令牌（只对 Cookie 来路，见模块头）。

    任何异常都吞掉：续期是**锦上添花**，失败的后果只是用户早一点需要重新登录，
    不该让一个正常的请求 500。
    """
    if response is None or not from_cookie:
        return
    try:
        issued = int(payload.get("iat") or 0)
        if not issued:
            return
        age = int(datetime.now(timezone.utc).timestamp()) - issued
        if age < RENEW_AFTER_S:
            return
        fresh = create_access_token(
            user.id, password_hash=str(user.get("password_hash") or "")
        )
        # Cookie 属性必须跟签发处（routes/account._set_auth_cookie）一致，
        # 否则续期会写出一个属性不同的 Cookie，浏览器当成另一个，出现两份并存。
        response.set_cookie(
            key=AUTH_COOKIE,
            value=fresh,
            max_age=DEFAULT_TTL_S,
            httponly=True,
            samesite="lax",
            path="/",
        )
    except Exception:  # noqa: BLE001 — 见 docstring
        return


def optional_user(
    response: Response,
    authorization: Annotated[Optional[str], Header()] = None,
    sliderule_token: Annotated[Optional[str], Cookie(alias=AUTH_COOKIE)] = None,
) -> Optional[User]:
    """有登录就给 User，没有就 None。**从不抛异常。**

    用在"匿名也能看"的接口上：应用中心列表、应用详情、缩略图。
    路由内部据此决定给不给写操作的入口，而不是靠前端藏按钮。

    ## 判定顺序（2026-08-04 起有四道，不是一道）

        ① 签名与过期    decode_access_token
        ② 账号还在、还活着
        ③ pv 密码戳对得上   —— 改了密码，旧令牌全灭
        ④ jti 没被撤销      —— 登出的那一张失效

    ③④ 的来源与理由见 services/auth_tokens 的模块头。**四道都在这一个函数里**
    是刻意的：require_user / require_superuser 都建在它上面，新增一道检查不会
    出现"某个入口漏做了"的情况（这正是抄 fastapi-users 那条"匿名和拒绝共用
    同一条判定链"的原因）。
    """
    token = _extract_token(authorization, sliderule_token)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    user_id = str(payload.get("sub") or "")
    if not user_id:
        return None
    try:
        store = get_identity_store()
        user = store.get_by_id(user_id)
    except Exception:  # noqa: BLE001 — 身份库抖动时按匿名处理，不拖垮只读接口
        return None
    # 停用的账号等同未登录：令牌还没过期但人已经被停了，不能继续按登录态放行。
    if user is None or not user.is_active:
        return None

    # ③ 密码戳。**缺 pv 的令牌一律拒绝**——这是 2026-08-04 之前签发的存量令牌，
    #    它们正是"改了密码也踢不掉"的那一批，放行等于这次改动对存量无效。
    #    代价是这次上线会把所有已登录用户踢下线一次，那是可接受的一次性成本，
    #    而且**这正是我们想要的效果**（存量令牌本来就该作废）。
    stamp = str(payload.get("pv") or "")
    expected = password_stamp(str(user.get("password_hash") or ""))
    if not stamp or not hmac.compare_digest(stamp, expected):
        return None

    # ④ 撤销名单。放在最后：前面几道都是纯内存计算，这一道要查库，
    #    没必要为一张签名就不对的令牌白查一次。
    try:
        if store.is_token_revoked(str(payload.get("jti") or "")):
            return None
    except Exception:  # noqa: BLE001 — 撤销表查不动时**放行**
        # 这一处是 fail-open，与上面几道相反，理由：撤销表是"额外收紧"的机制，
        # 它挂掉时退回到"没有撤销表"的行为（即改动前的状态），而不是把所有
        # 已登录用户全部锁在门外。身份判定本身（①②③）不依赖这张表。
        pass

    # 过半程换新（见模块头「自动续期」）。放在全部判定通过之后——
    # 一张验不过的令牌当然不该被续。
    _maybe_renew(
        response,
        payload,
        user,
        from_cookie=not _extract_bearer_token(authorization),
    )
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
