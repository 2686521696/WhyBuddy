"""目录窄化：按题意从 358 个区块里挑一小批注进 prompt，而不是全量倒进去。

## 为什么要窄化（实测，不是猜）

2026-08-10 用 scripts/block_selection_metrics.py 量过：目录 358 个通电区块，
control 臂 10 趟共 136 次选中，其中来自原名次 >52 的只有 **2 次（1.5%）**，
而 >52 的区块占目录 **306/358（85%）**。三个竞争解释被逐一排除（PROVEN
LAYOUTS 措辞、模型排斥冷门件、描述缺失），剩下位置/可达性：把原第 279 名的
OnCallScheduleCalendar 挪到第 15 位，同题三趟从 0/3 变 3/3——同样的字数、
同样的描述，只换了位置（见 schema_legal._promote_blocks_for_experiment 头注）。

这不是本仓库特有的怪癖。业界把它叫 "too many tools"，机制是 RoPE 的
long-term decay：候选排在长清单中段时被选中的概率显著低于排在开头。通行解法
就是**先检索出一小批、再放在靠前位置注入**（Tool RAG）。

## 为什么按召回优先、而且必须保底

arXiv 2605.24660（How Many Tools Should an LLM Agent See?）实测两点，都直接
影响这里的取数：

  · 候选**越多**选得越差：BFCL 上 2 条候选时选对 93.1%，5 条时降到 87.1%；
  · 但固定砍到 5 条时，难题上"一条都没找着"——正确答案排在第 6~20 位。

所以窄化不是"越窄越好"，是**在可达区里塞进尽可能高的召回**。默认取 60 —— 比
论文里单次工具选择的 7 条大得多，因为这里一次要为 5~7 个页面选材，不是选一个
工具调用。

## 硬约束：预设点名的区块必须无条件在集合里

PROVEN LAYOUTS 那 10 档预设点名了 MetricGrid / DataTable / RecordFormDialog
等 10 个区块，prompt 里还写着"从这些起手"。要是窄化把它们筛掉了，prompt 就
自相矛盾（叫你用某个件、目录里却没有），大概率直接被结构门拒收。所以它们
**不参与竞争**，先无条件进集合，再用剩余额度装按题意检索出来的。

## 检索实现

BM25（rank_bm25，numpy-only）+ 意图词表展开 + 字段加权 + generality 加成。
四样都对齐 client/src/pages/sliderule/component-search.ts —— 那是同一个判断的
另一个消费方（用户在组件库里敲字搜索），它有 17 条查询的 Recall@k 判定清单。
意图词表与字段权重走**同一份 JSON**（services/data/block_intent_lexicon.json），
不各写一份。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

_LEXICON_FILE = Path(__file__).resolve().parent / "data" / "block_intent_lexicon.json"

#: 单字汉字：查询侧丢掉（见 tokenize_query）
_SINGLE_CJK_RE = re.compile(r"^[一-龥]$")
_ASCII_RE = re.compile(r"[a-z0-9]+")
_CAMEL_RE = re.compile(r"[A-Z][a-z0-9]+")
_CJK_RUN_RE = re.compile(r"[一-龥]+")


def _load_lexicon() -> Dict[str, Any]:
    raw = json.loads(_LEXICON_FILE.read_text(encoding="utf-8"))
    rules = []
    for r in raw.get("intentLexicon") or []:
        flags = re.IGNORECASE if "i" in str(r.get("flags") or "") else 0
        rules.append((re.compile(str(r["pattern"]), flags), str(r["terms"])))
    return {"rules": rules, "fieldWeights": raw.get("fieldWeights") or {}}


_LEXICON = _load_lexicon()


def tokenize(text: str) -> List[str]:
    """索引侧分词：ASCII 整词 + 驼峰拆分 + 汉字单字与相邻二字。

    与 component-search.ts 的 tokenize 同构（那边有实测依据的注释）。单字保留是
    真实需求（搜「表」要命中「表格」）。
    """
    out: List[str] = []
    out += _ASCII_RE.findall((text or "").lower())
    out += [w.lower() for w in _CAMEL_RE.findall(text or "")]
    for run in _CJK_RUN_RE.findall(text or ""):
        for i, ch in enumerate(run):
            out.append(ch)
            if i + 1 < len(run):
                out.append(run[i : i + 2])
    return out


def tokenize_query(text: str) -> List[str]:
    """查询侧分词：**丢掉单字汉字**，只留二字词及以上。

    索引侧留单字、查询侧丢，是刻意的不对称。TS 那边记着实测数字：查询
    「zzzz不存在」在留单字时能命中 84 条，因为「不」「存」「在」几乎每条说明
    里都有——这不是排序问题，是这些字压根不该参与检索。

    兜底：滤完一个不剩（用户就打了一个字）时退回原分词，否则变成永远搜不到。
    """
    all_tokens = tokenize(text)
    kept = [t for t in all_tokens if not _SINGLE_CJK_RE.match(t)]
    return kept or all_tokens


def intent_terms(query: str) -> str:
    """意图词表命中的能力词（不含原话）。"""
    return " ".join(terms for pat, terms in _LEXICON["rules"] if pat.search(query or ""))


def expand_intent(query: str) -> str:
    """把一句自然语言展开成「原话 + 能力词」。"""
    extra = intent_terms(query)
    return f"{query} {extra}" if extra else (query or "")


def _doc_fields(block: Dict[str, Any]) -> Dict[str, str]:
    """一个区块的可检索字段。权重见 block_intent_lexicon.json 的 fieldWeights。"""
    binding = block.get("bindingSchema") or {}
    parts = " ".join(
        str(x)
        for x in list((binding.get("entityFieldRefs") or {}).keys())
        + list(block.get("allowedRegions") or [])
    )
    return {
        "name": str(block.get("type") or ""),
        "label": str(block.get("label") or ""),
        "parts": parts,
        "tags": " ".join(
            str(x) for x in [block.get("family"), block.get("group"), block.get("generality")] if x
        ),
        "description": str(block.get("description") or ""),
    }


def _weighted_tokens(block: Dict[str, Any], weights: Dict[str, int]) -> List[str]:
    """按字段权重把 token 重复若干次——rank_bm25 没有字段加权，用重复等价实现。

    这是 BM25 里做字段加权的标准土办法（词频翻倍等于该字段权重翻倍）。选它而不
    是自己改打分函数，是为了让 rank_bm25 保持是那个被测过的实现。
    """
    toks: List[str] = []
    for field, text in _doc_fields(block).items():
        w = int(weights.get(field, 1))
        if w <= 0:
            continue
        toks += tokenize(text) * w
    return toks


def narrowing_enabled() -> bool:
    """目录窄化开关。**默认关**——上线前先用度量台把两层指标量出来。"""
    return str(os.getenv("SLIDERULE_BLOCK_CATALOG_NARROWING", "")).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def narrowing_limit(default: int = 60) -> int:
    raw = str(os.getenv("SLIDERULE_BLOCK_CATALOG_NARROWING_LIMIT", "")).strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return default


def select_blocks(
    blocks: Sequence[Dict[str, Any]],
    goal: str,
    *,
    limit: int = 60,
    mandatory: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    """按题意挑出 ≤limit 个区块，**保底集合永远在最前**。

    返回顺序即注入顺序：保底件在前（预设要用它们），其后按 BM25 得分降序——
    得分高的越靠前，正是可达性最好的位置。

    goal 为空、rank_bm25 缺失、或 limit 大于全量时，**原样返回全量**（fail-open
    ——窄化是优化，不该让生成不可用）。
    """
    all_blocks = list(blocks)
    if not (goal or "").strip() or limit >= len(all_blocks):
        return all_blocks

    keep_names = list(mandatory or [])
    by_name = {str(b.get("type")): b for b in all_blocks}
    head = [by_name[n] for n in keep_names if n in by_name]
    head_names = {str(b.get("type")) for b in head}
    rest = [b for b in all_blocks if str(b.get("type")) not in head_names]

    room = limit - len(head)
    if room <= 0:
        return head

    try:
        from rank_bm25 import BM25Okapi
    except Exception:  # noqa: BLE001 — 依赖缺失不该让生成挂掉
        return all_blocks

    weights = _LEXICON["fieldWeights"]
    corpus = [_weighted_tokens(b, weights) for b in rest]
    if not any(corpus):
        return all_blocks
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(tokenize_query(expand_intent(goal)))

    ranked = sorted(
        range(len(rest)),
        key=lambda i: (-float(scores[i]), all_blocks.index(rest[i])),
    )
    return head + [rest[i] for i in ranked[:room]]


def preset_block_names(page_kind_presets: Dict[str, Any]) -> List[str]:
    """PROVEN LAYOUTS 里点名的区块——窄化的保底集合。

    从预设本身派生，不手写清单：预设改了保底集合自动跟上。漏掉任何一个都会让
    prompt 自相矛盾（预设叫模型用它、目录里却没有）。
    """
    names: List[str] = []
    for presets in (page_kind_presets or {}).values():
        for ps in presets or []:
            for item in (ps or {}).get("blocks") or []:
                t = str((item or {}).get("type") or "").strip()
                if t and t not in names:
                    names.append(t)
    return names
