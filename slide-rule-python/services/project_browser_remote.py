"""模型自己看页面（browser_view / browser_click / browser_input …）走验收同一台远程浏览器。

⚠ 2026-10-09 线上读书打卡 sr-20261009000607-914M1G425B：browser_view 回 project_browser_driver_unavailable。
  ProjectTools 只认两条路——supervisor 上注入的 browser_interactor，或本机 Playwright——线上两条都不通：
  没人注入，Python 镜像里也没有 node 和浏览器。模型的「自己看一眼」在线上从来没通过（10-08 那趟也是），
  只有 project_verify 的独立验收能开浏览器。frontend-design 要的截图自查、页面报错原文（console_observation）
  在线上全是空的，模型只能一轮轮提交验收、对着计数猜。

这里就是那个 browser_interactor：开发服务器跑着时，预览网关的隧道一直连着（运行工人每轮 ensure），
用户右栏的预览也是这么发票的（routes/project_preview.issue_project_preview_ticket）。同样给这次运行发一张
一次性票，交给 E2BProjectBrowserProvider.interact 在一台只许访问预览主机的新沙盒里做这一个动作，做完收票。

只抛 ValueError（带码）：调用点按观察类 fail-open 处理，拿不到页面也把开发服务器状态交回去（§7）。
"""

from __future__ import annotations

import logging
from typing import Callable
from urllib.parse import urlsplit

from services.project_preview_config import origin_for_runtime

logger = logging.getLogger(__name__)


class RemoteBrowserInteractor:
    def __init__(self, access, provider_factory: Callable[[], object], *,
                 origin_for: Callable[[str], str] = origin_for_runtime):
        self.access, self.provider_factory, self.origin_for = access, provider_factory, origin_for

    def __call__(self, action: dict, page: dict) -> dict:
        operation_id, runtime_id, owner_id = (page.get("operationId"), page.get("runtimeId"), page.get("ownerId"))
        if not all(isinstance(value, str) and value for value in (operation_id, runtime_id, owner_id)):
            raise ValueError("project_browser_preview_not_ready")
        try:
            origin = self.origin_for(runtime_id)
        except ValueError:
            raise ValueError("project_browser_preview_unreachable") from None
        try:
            if not self.access.has_active_tunnel(operation_id, owner_id=owner_id, audience=origin):
                raise ValueError("project_browser_preview_unreachable")
            grant = self.access.issue_browser_ticket(operation_id, owner_id=owner_id, audience=origin)
        except ValueError:
            raise
        except Exception as exc:                       # 票发不出（运行换了一代、刚停）：说成预览不通，不是代码错
            logger.warning("project browser action ticket exception=%s", type(exc).__name__)
            raise ValueError("project_browser_preview_unreachable") from None
        try:
            path = urlsplit(str(page.get("url") or "/")).path or "/"
            return self.provider_factory().interact(
                entry_url=origin + "/_whybuddy/authorize?ticket=" + grant.secret,
                page_url=origin + (path if path.startswith("/") else "/" + path), action=action)
        finally:
            try:
                self.access.revoke_grant(grant.scope.grant_id, owner_id=owner_id)
            except Exception as exc:                   # 票本身一分钟就过期；收不回不拖垮这次观察
                logger.warning("project browser action revoke exception=%s", type(exc).__name__)
