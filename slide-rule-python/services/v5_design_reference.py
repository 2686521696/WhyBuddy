"""v5_design_reference — 设计菜谱语料（E40.3，千人千面第三层）。

语料来自项目 owner 提供的 37 张企业应用视觉稿（scratchpad 一次性视觉 LLM
蒸馏 + 人工检视后冻结为 data/design_recipes.json）：每条配方 = 一个域的
导航形态 / 开门页构成 / 组件清单 / 主题气质 / 命名风格。

用途边界（与 v5_skill_reference 同一纪律，刻意克制）：
  - 只作为生成 prompt 里的"设计风格参考"软引用——明确指示按用户真实业务
    建模、不照抄配方内容；结构门照常裁决，配方无任何豁免权；
  - 语料缺失 / 无命中时返回空串——prompt 不加块，生成行为与从前完全一致；
  - 检索纯本地纯确定性（ASCII 词 + 中文 bigram 重叠打分），零网络零依赖。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

_DATA_PATH = Path(__file__).resolve().parent / "data" / "design_recipes.json"

_cache: Optional[List[Dict[str, Any]]] = None


def _load_recipes() -> List[Dict[str, Any]]:
    global _cache
    if _cache is None:
        try:
            raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
            items = raw.get("recipes", raw) if isinstance(raw, dict) else raw
            _cache = [r for r in items if isinstance(r, dict) and r.get("project")]
        except Exception:
            _cache = []
    return _cache


_ASCII_WORD = re.compile(r"[a-z0-9]{2,}")
_CJK_CHAR = re.compile(r"[一-鿿]")


def _tokens(text: str) -> Set[str]:
    lowered = (text or "").lower()
    toks: Set[str] = set(_ASCII_WORD.findall(lowered))
    cjk = _CJK_CHAR.findall(lowered)
    toks.update(a + b for a, b in zip(cjk, cjk[1:]))
    return toks


def _recipe_tokens(recipe: Dict[str, Any]) -> Set[str]:
    keywords = " ".join(str(k) for k in (recipe.get("domainKeywords") or []))
    return _tokens(f"{recipe.get('project', '')} {keywords}")


def match_recipes(intent: str, k: int = 2, min_overlap: int = 2) -> List[Dict[str, Any]]:
    """意图 → top-k 配方（词面重叠计分；重叠 < min_overlap 不算命中）。"""
    intent_tokens = _tokens(intent)
    if not intent_tokens:
        return []
    scored = []
    for recipe in _load_recipes():
        overlap = len(intent_tokens & _recipe_tokens(recipe))
        if overlap >= min_overlap:
            scored.append((overlap, recipe))
    scored.sort(key=lambda pair: -pair[0])
    return [recipe for _, recipe in scored[:k]]


def design_reference_block(intent: str, k: int = 2) -> str:
    """命中配方 → 生成 prompt 的软参考块；无命中 → 空串（prompt 零变化）。"""
    hits = match_recipes(intent, k=k)
    if not hits:
        return ""
    lines = [
        "Industry design reference (STYLE INSPIRATION ONLY — model the user's "
        "ACTUAL business; never copy entities/pages from the reference; the "
        "structural gate judges your model as usual):"
    ]
    for recipe in hits:
        widgets = "/".join(str(w) for w in (recipe.get("widgets") or [])[:8])
        lines.append(
            f"- {recipe.get('project')}: nav={recipe.get('navStyle')}, "
            f"home={recipe.get('homeArchetype')}, widgets={widgets}, "
            f"accent={recipe.get('accentHint')}, naming={recipe.get('namingStyle')}"
        )
    return "\n".join(lines)
