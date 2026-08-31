# -*- coding: utf-8 -*-
"""范围授权——设备 / 原型的 persist-as-authority（2026-08-30）。

对照 grok-build `xai-grok-workspace` 的 `PermissionState`：用户授予写进
持久化，内存覆盖不是权威。`persist_state` / `load_state_from_disk` 那一套
的核心不是「有个磁盘文件」，是 **grant 的来源只有一处，读的时候也只认它**。

本仓澄清答案已经这样抄了（`clarifications_from_state`：从 coverageGaps
取，不从 HTTP 再传一遍）。范围卡抄了一半——确认只把 `productArchetype`
写进 goal，`preferredDevice` 只活在 `set_preferred_device_override` 里，
工厂 `finally` 一清就没了。2026-08-30 真机两场点了「平板」的会话
（`sr-20260830144419-GEBYE95H68`、API `J274GF24KK`），checkpoint 里
零条 tablet：park 吃作曲家默认 desktop，stamp 不写设备，override 跑完就丢。

本模块补完那一半。不换五系统内核，不接通 `casual_game` / `watch`。
只依赖账本 + 设备词推断，**不许** import `rehearsal_control`。

park ≠ confirm：
  park 是提示（NeedPermission）。作曲家默认 desktop **不是**授予；句子里的
  「平板」才是。confirm 是授予（Permission{decision}）。卡上点的档压过句子。
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Mapping, Optional

from services.archetype_legal import (
    default_device,
    is_wired,
    supported_devices,
    UnknownArchetype,
)
from services.device_policy import infer_device_from_text


def wired_device(raw: Any) -> Optional[str]:
    """接通的设备档。哨兵 / watch / 空串都不是授予。"""
    name = str(raw or "").strip()
    if name in supported_devices():
        return name
    return None


def wired_archetype(raw: Any) -> Optional[str]:
    name = str(raw or "").strip()
    if not name:
        return None
    try:
        if is_wired(name):
            return name
    except UnknownArchetype:
        return None
    return None


def _as_map(raw: Any) -> Dict[str, Any]:
    return dict(raw) if isinstance(raw, Mapping) else {}


def _texts(texts: Iterable[Any] | None) -> list[str]:
    return [str(item or "") for item in (texts or [])]


def _persisted_device(last_card: Any, goal: Any) -> Optional[str]:
    card = _as_map(last_card)
    body = _as_map(goal)
    return wired_device(card.get("device")) or wired_device(body.get("preferredDevice"))


def resolve_park_device(
    *,
    last_card: Any = None,
    goal: Any = None,
    texts: Iterable[Any] | None = None,
    payload_device: Any = None,
) -> str:
    """停泊用档。句子里的唯一设备词 > 已持久化的授予 > 载荷 > 哨兵。

    ⚠ 2026-08-30：`device=str(preferred_device or "unspecified")` 让作曲家
    默认 desktop 盖掉「巡店点单平板」。park 是出卡，不是点火——默认档
    不是 Permission{decision}。
    """
    inferred = infer_device_from_text(*_texts(texts))
    if inferred:
        return inferred
    persisted = _persisted_device(last_card, goal)
    if persisted:
        return persisted
    payload = wired_device(payload_device)
    if payload:
        return payload
    return "unspecified"


def resolve_confirm_device(
    *,
    payload_device: Any = None,
    last_card: Any = None,
    goal: Any = None,
    texts: Iterable[Any] | None = None,
) -> str:
    """确认用档。卡上点的接通档是授予，压过句子和旧卡。"""
    payload = wired_device(payload_device)
    if payload:
        return payload
    card = wired_device(_as_map(last_card).get("device"))
    if card:
        return card
    persisted = wired_device(_as_map(goal).get("preferredDevice"))
    if persisted:
        return persisted
    inferred = infer_device_from_text(*_texts(texts))
    if inferred:
        return inferred
    return default_device()


def preferred_device_for_run(
    *,
    goal: Any = None,
    payload_device: Any = None,
    texts: Iterable[Any] | None = None,
) -> str:
    """本轮生成用档。本轮句子里的唯一设备词 > goal 上的授予 > 载荷 > 兜底。

    精修 POST 仍会带作曲家 localStorage 的 desktop。那不是新授予——
    对照 grok：磁盘上的 grant 压过会话里随手带上的默认值。
    """
    inferred = infer_device_from_text(*_texts(texts))
    if inferred:
        return inferred
    persisted = wired_device(_as_map(goal).get("preferredDevice"))
    if persisted:
        return persisted
    payload = wired_device(payload_device)
    if payload:
        return payload
    return default_device()


def stamp_scope_onto_goal(
    goal: Any,
    *,
    product_archetype: Any = None,
    preferred_device: Any = None,
    tools: Any = None,
) -> Dict[str, Any]:
    """把范围卡授予写进 goal。调用方随后 persist——内存 override 不是权威。"""
    body = goal if isinstance(goal, dict) else {}
    arch = str(product_archetype or "").strip()
    if arch:
        body["productArchetype"] = arch
    device = wired_device(preferred_device)
    if device:
        body["preferredDevice"] = device
    if tools is not None:
        names = [str(item).strip() for item in tools if str(item).strip()]
        if names:
            body["tools"] = names
        else:
            body.pop("tools", None)
    return body
