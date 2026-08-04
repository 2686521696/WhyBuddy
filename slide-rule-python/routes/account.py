"""面向浏览器的账号接口（2026-08-02）。

## 为什么挂在 /api/sliderule/account 下而不是 /api/auth

`/api/auth/*` 已经被两个东西占着：Node 侧 `server/routes/auth.ts` 的遗留账号体系
（MySQL），以及 Python 侧 `routes/auth.py` 那个给 Node 桥接用的桩（要内部密钥、
不面向浏览器）。往那里加会撞路径，也会让"哪套在生效"变得含糊。

挂在 sliderule 前缀下还有个实际好处：**复用已经验证过的那条代理**
（server/routes/sliderule.ts）。浏览器 → Node → Python 这条路已经通了，不用再铺一条。

## 令牌怎么给

登录/注册成功时**同时**给两样：
  · 响应体里的 `token` —— 给脚本/CLI 用（Authorization: Bearer）
  · httpOnly Cookie —— 给浏览器用

浏览器优先用 Cookie：httpOnly 意味着 XSS 拿不到它。`localStorage` 存 JWT 是很常见
的做法，但一次 XSS 就等于永久盗号。两者都支持是因为 CLI 用不了 Cookie。

对齐 fastapi-users 的做法：它把「认证后端」拆成 transport（cookie/bearer）与
strategy（jwt/db），同一份身份可以走多个 transport。这里不需要那层抽象，但取向一致。
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Body, HTTPException, Request, Response

from middlewares.current_user import AUTH_COOKIE, CurrentUserOptional, SuperUser
from services import auth_service
from services.auth_tokens import DEFAULT_TTL_S
from services.identity_store import get_identity_store

router = APIRouter(tags=["Account"])


def _set_auth_cookie(response: Response, token: str) -> None:
    """种登录 Cookie。

    · httponly —— XSS 拿不到
    · samesite=lax —— 挡住跨站表单/图片发起的写操作，同时不影响正常的站内跳转
    · secure 跟随请求协议：本地 http 开发也要能登上，所以不硬编码 True
      （硬编码会让 http://localhost 上的 Set-Cookie 被浏览器直接丢掉，
       表现是"登录返回 200 但下一个请求还是未登录"，很难查）
    """
    response.set_cookie(
        key=AUTH_COOKIE,
        value=token,
        max_age=DEFAULT_TTL_S,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _client_is_https(request: Request) -> bool:
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").lower()
    return proto == "https"


@router.post("/account/register/start")
async def register_start(payload: dict[str, Any] = Body(...)):
    """第一步：校验 + 发验证码。

    ⚠️ 邮箱已注册时也返回成功（见 auth_service.start_registration 的说明）——
    否则这个接口就是个用户枚举器。
    """
    import asyncio

    result = await asyncio.to_thread(
        auth_service.start_registration,
        str(payload.get("email") or ""),
        str(payload.get("password") or ""),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("message") or "注册失败")
    return result


@router.post("/account/register")
async def register_complete(
    response: Response, request: Request, payload: dict[str, Any] = Body(...)
):
    """第二步：验码 + 建账号，成功即登录态。"""
    import asyncio

    result = await asyncio.to_thread(
        auth_service.complete_registration,
        str(payload.get("email") or ""),
        str(payload.get("password") or ""),
        str(payload.get("code") or ""),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("message") or "注册失败")
    _set_auth_cookie(response, result["token"])
    return result


@router.post("/account/login")
async def login(response: Response, request: Request, payload: dict[str, Any] = Body(...)):
    import asyncio

    result = await asyncio.to_thread(
        auth_service.login,
        str(payload.get("email") or ""),
        str(payload.get("password") or ""),
    )
    if not result.get("ok"):
        # 401 而不是 400：前端据此判断"要重新输密码"而不是"参数错了"。
        # 消息本身对"邮箱不存在"和"密码错误"是同一句（见 auth_service）。
        raise HTTPException(401, result.get("message") or "登录失败")
    _set_auth_cookie(response, result["token"])
    return result


@router.post("/account/password/reset/start")
async def password_reset_start(payload: dict[str, Any] = Body(...)):
    """找回密码第一步：发验证码。

    ⚠️ 邮箱**没注册**时也返回成功（不发码）——理由同注册那条：如实回答就是
    一个用户枚举器。冷却期内同样走成功出口，见 auth_service.start_password_reset。
    """
    import asyncio

    result = await asyncio.to_thread(
        auth_service.start_password_reset,
        str(payload.get("email") or ""),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("message") or "发送失败")
    return result


@router.post("/account/password/reset")
async def password_reset_complete(
    response: Response, request: Request, payload: dict[str, Any] = Body(...)
):
    """找回密码第二步：验码 + 换密码，成功即登录态。

    ⚠️ 换密码**不会**让其他设备上已签发的 token 失效（纯 JWT 没有服务端撤销，
    同 logout 的说明）。见 auth_service 里「找回密码」那段。
    """
    import asyncio

    result = await asyncio.to_thread(
        auth_service.complete_password_reset,
        str(payload.get("email") or ""),
        str(payload.get("code") or ""),
        str(payload.get("password") or ""),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("message") or "重置失败")
    _set_auth_cookie(response, result["token"])
    return result


@router.post("/account/logout")
async def logout(response: Response):
    """清 Cookie。

    ⚠️ 诚实说明：**这不会让已签发的 token 失效**。纯 JWT 没有服务端撤销，
    要做到"登出即失效"需要一张黑名单表（或改用不透明 token + 服务端会话）。
    现在的语义是"这个浏览器忘掉凭据"，对被盗的 token 无效。
    真需要强制下线时再加撤销表——那是一件独立的事，不该现在偷偷做半套。
    """
    response.delete_cookie(key=AUTH_COOKIE, path="/")
    return {"ok": True}


@router.get("/account/me")
async def me(viewer: CurrentUserOptional):
    """当前登录者。**匿名返回 200 + user=null，不是 401。**

    前端启动时要用它判断登录态，401 会在控制台刷一片红、也容易被通用的
    "401 就跳登录页"拦截器误伤。匿名是正常状态，不是错误。
    """
    return {"user": viewer.public() if viewer is not None else None}


@router.get("/account/capabilities")
async def capabilities(viewer: CurrentUserOptional):
    """当前身份能做什么——给前端决定显示哪些按钮。

    ⚠️ 这个接口**不是**权限判定，只是 UI 提示。真正的判定在每个写接口里
    （app_access.require）。前端藏起来的按钮不等于后端拦得住——那套 RBAC 后台
    的字段权限就是只藏了前端、后端照样返回全部字段。
    """
    logged_in = viewer is not None
    return {
        "loggedIn": logged_in,
        "isSuperuser": bool(viewer is not None and viewer.is_superuser),
        "can": {
            "browse": True,        # 匿名也能浏览应用中心
            "viewApp": True,
            "fork": logged_in,
            "drive": logged_in,    # 推演要登录（匿名只查看）
            "manageOwn": logged_in,
        },
    }


# ────────────────────────── 管理台 ──────────────────────────
#
# Node 的 /api/admin 原来读的是**遗留 MySQL 用户表**。那套账号体系已经整体下掉
# （2026-08-03），管理台的数据源随之切到这里——身份只剩一份，不会出现
# "管理台看到的用户和实际能登录的用户是两拨人"。
#
# 守卫是双层的：Node 侧 requireAdmin 先拦一道，这里的 SuperUser 再拦一道。
# 不省掉任何一层——Node 那层是为了不把请求白白打过来，这层才是真判定。


@router.get("/account/admin/users")
async def admin_list_users(_admin: SuperUser):
    import asyncio

    users = await asyncio.to_thread(lambda: get_identity_store().list_users())
    return {"ok": True, "items": [u.public() for u in users]}


@router.get("/account/admin/users/{user_id}")
async def admin_get_user(user_id: str, _admin: SuperUser):
    import asyncio

    user = await asyncio.to_thread(lambda: get_identity_store().get_by_id(user_id))
    if user is None:
        raise HTTPException(404, "用户不存在")
    return {"ok": True, "user": user.public()}
