"""v5_skill_reference — 业界技能参考语料（技能库二期"化为己用"）。

语料来自 TRAE 技能创作赛的宽松协议开源仓库（scripts/harvest-skill-semantics.mjs
采集，data/skill_semantics.json，每条带协议标签与署名回链）。检索是零依赖的
词面重叠打分：ASCII 词 + 中文 bigram，对意图取 top-k。

用途边界（刻意克制）：
  - 只作为生成 prompt 里的"命名与输入输出风格参考"，明确指示不复制内容；
  - 语料文件缺失 / 无命中时返回空——prompt 不加块，生成行为与从前完全一致；
  - 检索纯本地纯确定性，不引入任何网络与三方依赖。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "skill_semantics.json"

_cache: Optional[List[Dict[str, Any]]] = None


def _load_items() -> List[Dict[str, Any]]:
    global _cache
    if _cache is None:
        try:
            raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
            _cache = [it for it in raw.get("items", []) if (it.get("name") or "").strip()]
        except Exception:
            _cache = []
    return _cache


_ASCII_WORD = re.compile(r"[a-z0-9]{2,}")
_CJK_CHAR = re.compile(r"[一-鿿]")


def _tokens(text: str) -> Set[str]:
    """ASCII 词 + 中文 bigram（中文无空格分词，bigram 是零依赖的够用近似）。"""
    lowered = (text or "").lower()
    toks: Set[str] = set(_ASCII_WORD.findall(lowered))
    cjk = _CJK_CHAR.findall(lowered)
    toks.update(a + b for a, b in zip(cjk, cjk[1:]))
    return toks


def _item_tokens(it: Dict[str, Any]) -> Set[str]:
    return _tokens(f"{it.get('name', '')} {it.get('description', '')}")


def _df_weight(df: int) -> float:
    """文档频次 → 词权：罕见领域词（标书/小说/股票…）定乾坤，
    通用产品词（管理/系统/一个…）几乎不计分——防无关命中。"""
    if df <= 1:
        return 1.0
    if df <= 3:
        return 0.7
    if df <= 10:
        return 0.25
    return 0.05


_MIN_SCORE = 1.2


def pick_reference_skills(
    intent: str,
    k: int = 4,
    items: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, str]]:
    """df 加权词面重叠取 top-k 相似技能；加权分 < 1.2 视为无关不入选（至少两个罕见领域词共现，单词偶合不过线）。

    `items` 可注入（测试用）；缺省读 data/skill_semantics.json。
    """
    query_tokens = _tokens(intent)
    if not query_tokens:
        return []
    corpus = items if items is not None else _load_items()
    token_sets = [_item_tokens(it) for it in corpus]
    df: Dict[str, int] = {}
    for toks in token_sets:
        for t in toks:
            df[t] = df.get(t, 0) + 1
    scored: List[tuple[float, Dict[str, Any]]] = []
    for it, toks in zip(corpus, token_sets):
        score = sum(_df_weight(df[t]) for t in query_tokens & toks)
        if score >= _MIN_SCORE:
            scored.append((score, it))
    scored.sort(key=lambda pair: -pair[0])
    return [
        {
            "name": str(it.get("name", ""))[:60],
            "description": str(it.get("description", ""))[:120],
            "url": str(it.get("url", "")),
        }
        for _score, it in scored[:k]
    ]


def reference_prompt_block(intent: str, k: int = 4) -> str:
    """生成 prompt 参考块；无命中返回空串（调用方按空跳过）。"""
    refs = pick_reference_skills(intent, k)
    if not refs:
        return ""
    lines = [
        "Industry reference skills (for naming & input/output style only — do NOT copy their content):"
    ]
    for ref in refs:
        desc = f" — {ref['description']}" if ref["description"] else ""
        lines.append(f"- {ref['name']}{desc}")
    return "\n".join(lines)
