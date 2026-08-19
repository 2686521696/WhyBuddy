"""Authoritative target-device policy for newly generated applications."""

from __future__ import annotations

import re
from typing import Any, Literal, MutableMapping, Optional


Device = Literal["desktop", "phone"]
DEVICE_AUTHORITY = "single-v1"

_DESKTOP_EXPLICIT = re.compile(
    r"(?<![A-Za-z0-9])(?:pc|web|website)(?![A-Za-z0-9])|电脑|桌面端|网页|网站",
    re.IGNORECASE,
)
_PHONE_EXPLICIT = re.compile(
    r"(?<![A-Za-z0-9])app(?![A-Za-z0-9])|手机|移动端|小程序",
    re.IGNORECASE,
)

# 作曲家「应用 / Web」开关。模块级而不是 ContextVar：spec-first 跑在
# asyncio.to_thread 里，ContextVar 过不了线程（installed_skills 同款）。
# 本地单人推演可接受；finally 必须清掉，否则下一轮脏读。
_override: Optional[Device] = None


def set_preferred_device_override(raw: Any) -> None:
    """本轮推演的用户显式选择。非法值 / None = 不清、走话题推断。"""
    global _override
    _override = raw if raw in ("desktop", "phone") else None


def preferred_device_override() -> Optional[Device]:
    return _override


def resolve_preferred_device(goal: str, model_choice: Any) -> Device:
    """用户开关 > 话题里的显式设备词 > 模型已有选择 > desktop。

    开关要压过「网站/App」用词：空态点了「应用」再写「做个库存系统」，
    必须出竖屏，不能等用户把「手机」写进句子才认。
    """
    if _override in ("desktop", "phone"):
        return _override

    text = str(goal or "")
    asks_desktop = bool(_DESKTOP_EXPLICIT.search(text))
    asks_phone = bool(_PHONE_EXPLICIT.search(text))

    if asks_desktop != asks_phone:
        return "desktop" if asks_desktop else "phone"
    if model_choice in ("desktop", "phone"):
        return model_choice
    return "desktop"


def normalize_model_preferred_device(
    goal: str, model: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Write the single authoritative device before gate and enrichment."""
    appbundle = model.get("appbundle")
    if not isinstance(appbundle, dict):
        appbundle = {}
        model["appbundle"] = appbundle

    appbundle["preferredDevice"] = resolve_preferred_device(
        goal, appbundle.get("preferredDevice")
    )
    appbundle["deviceAuthority"] = DEVICE_AUTHORITY
    return model
