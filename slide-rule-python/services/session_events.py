# -*- coding: utf-8 -*-
"""会话事件的 wire 形状。抄 grok-build `xai-grok-session-events`：

    Typed per-session event log — 事件自描述，前端不查翻译表。

本文件是叶子：不依赖 services 里任何其它模块。展示字段由调用方传入
（调用方读 stage_legal.describe），这里只冻结要上 SSE 的键。

⚠ 前端 RECIPE_CORE / 推演钟 MODULE_TO_STEP 就是对着这些键删的。
键集变了，前端渲染会空，不许在前端再补一张表。
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

#: 事件上允许出现的展示键。多一个前端也不认；少一个前端不得猜。
WIRE_KEYS = (
    "stage",
    "label",
    "group",
    "eta",
    "order",
    "of",
    "productStep",
    "refineOnly",
)


def envelope(desc: Optional[Mapping[str, Any]] = None, **extra: Any) -> Dict[str, Any]:
    """从账本描述（或 kwargs）抽出 wire 字段。名单外的键丢掉。"""
    src: Dict[str, Any] = {}
    if desc:
        src.update(desc)
    src.update(extra)
    return {k: src[k] for k in WIRE_KEYS if k in src and src[k] is not None}
