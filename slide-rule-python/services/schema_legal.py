"""五系统模型合法域——单一真相源加载器（E40.1）。

背景：此前"什么写法是合法的"记在四处——结构门的常量、修复器的本地拷贝、
生成契约手写的枚举串、客户端渲染器的手抄版。四本账靠人肉对齐，E37 的
根因（charts/stats 的 metric 合法域不对称、修复器不知情）就是漏账的代价。

本模块是唯一入口：services/data/five_system_legal.json 是账本，四方全部
从这里派生——
  - 结构门 v5_model_gate：常量改为从此 import（对外名字不变，老引用零改动）
  - 修复器 v5_model_repair：经门的 re-export 自动跟随
  - 生成契约 v5_llm_generate：_SCHEMA_INSTRUCTION 的枚举段由 enum_str() 渲染
  - 客户端 live-runtime：构建期直接 import 同一 JSON（vite 全仓上下文），
    并有 vitest parity 测试锁死（见 legal-domains parity 测试）
加枚举 = 只改 JSON；哪一方没消费到，parity 测试当场红。

参考：阿里低代码引擎《物料协议》的"一份物料描述、编辑器/渲染器/校验器
共同消费"（docs/specs/material-spec）——同一思想的最小实现。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

_LEGAL_PATH = Path(__file__).resolve().parent / "data" / "five_system_legal.json"

with _LEGAL_PATH.open(encoding="utf-8") as _f:
    _LEGAL: Dict[str, object] = json.load(_f)


def _tuple(key: str) -> tuple:
    value = _LEGAL.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(f"five_system_legal.json 缺失或为空: {key}")
    return tuple(str(v) for v in value)


LEGAL_VERSION: int = int(_LEGAL.get("version", 0))

FIELD_TYPES = _tuple("fieldTypes")
FIELD_TONES = _tuple("fieldTones")
NUMBER_FORMATS = _tuple("numberFormats")
STRING_FORMATS = _tuple("stringFormats")
STAT_FORMATS = _tuple("statFormats")
PAGE_KINDS = _tuple("pageKinds")
CHART_TYPES = _tuple("chartTypes")
METRIC_BARE = _tuple("metricBare")
CHART_METRIC_PREFIXES = _tuple("chartMetricPrefixes")
STAT_METRIC_PREFIXES = _tuple("statMetricPrefixes")


def enum_str(*keys: str) -> str:
    """把一个或多个枚举键渲染成生成契约用的 "a|b|c" 串（顺序=账本顺序）。"""
    values: List[str] = []
    for key in keys:
        values.extend(_tuple(key))
    return "|".join(values)


def legal_snapshot() -> Dict[str, object]:
    """账本原文快照（测试/审计用，防外部改动内部状态返回深拷贝）。"""
    return json.loads(json.dumps(_LEGAL))
