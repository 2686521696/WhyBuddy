"""Authoritative target-device policy for newly generated applications."""

from __future__ import annotations

import re
from typing import Any, Literal, MutableMapping


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


def resolve_preferred_device(goal: str, model_choice: Any) -> Device:
    """Resolve one device from explicit goal language, then the model choice."""
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
