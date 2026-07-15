"""MCP 式工具注册表（P2a，2026-07-16）——能力池 MCP 化第一步。

用户裁决的 P2 切法：P2a 只读工具先行（真搜索第一个，免沙盒，证据质量
立竿见影）→ P2b 执行类工具进 E2B 沙盒。本模块是两步共用的地基：

- 工具描述符与 MCP（Model Context Protocol）对齐：name / description /
  inputSchema / readOnly / handler——P2b 的外部 MCP 服务器工具与沙盒
  执行工具接同一注册表，调用面（executor / agentic pick）不再变。
- 信任层海关（本仓独有约束）：工具产物只能作为带 provenance 溯源的
  证据进入系统（retrieval 字段如实标注来源），写结论的权力仍在门手里
  ——工具被骗/抓回脏数据，覆盖门与结构门照拦。

首个工具 web.search（真外网搜索证据源），供应商链按可用凭据自动选择：
  TAVILY_API_KEY → SERPER_API_KEY → Wikipedia 开放 API（免 key 兜底，
  zh 优先 en 补充）。全链不可用返回 None——调用方回落本地 RAG 并保留
  keyword 检索标注（诚实降级，不冒充外部证据）。
停用开关：SLIDERULE_WEB_SEARCH=off。
"""

from __future__ import annotations

import os
import re
from typing import Any, Callable, Optional

# Wikipedia 机器人政策要求 UA 携带联系方式（缺了直接 403 "respect our
# robot policy"，实测）——URL + 邮箱齐备
_UA = "SlideRuleEvidenceBot/1.0 (https://sliderule.ai; contact: bot@sliderule.ai) httpx"
_TIMEOUT_S = 12.0
_TAG_RE = re.compile(r"<[^>]+>")


def web_search_enabled() -> bool:
    return str(os.getenv("SLIDERULE_WEB_SEARCH", "on")).strip().lower() not in (
        "off",
        "0",
        "false",
    )


def _clean(text: str) -> str:
    return _TAG_RE.sub("", text or "").replace("&quot;", '"').replace("&amp;", "&").strip()


# ── 供应商实现（每家：query → list[evidence dict] | None）────────────────
# 证据 dict 形状与 rag_service 检索结果同构（content/source/score/id/
# retrieval），下游 report/evidence 汇编零改动。


def _search_tavily(query: str, top_k: int) -> Optional[list[dict[str, Any]]]:
    key = (os.getenv("TAVILY_API_KEY") or "").strip()
    if not key:
        return None
    import httpx

    r = httpx.post(
        "https://api.tavily.com/search",
        json={"api_key": key, "query": query, "max_results": top_k},
        headers={"User-Agent": _UA},
        timeout=_TIMEOUT_S,
    )
    r.raise_for_status()
    results = (r.json() or {}).get("results") or []
    return [
        {
            "content": _clean(item.get("content") or "")[:400],
            "source": item.get("url") or "tavily",
            "title": item.get("title") or "",
            "score": round(float(item.get("score") or 0.5), 2),
            "id": f"web-tavily-{i}",
            "retrieval": "web:tavily",
        }
        for i, item in enumerate(results[:top_k])
    ] or None


def _search_serper(query: str, top_k: int) -> Optional[list[dict[str, Any]]]:
    key = (os.getenv("SERPER_API_KEY") or "").strip()
    if not key:
        return None
    import httpx

    r = httpx.post(
        "https://google.serper.dev/search",
        json={"q": query, "num": top_k},
        headers={"X-API-KEY": key, "User-Agent": _UA},
        timeout=_TIMEOUT_S,
    )
    r.raise_for_status()
    organic = (r.json() or {}).get("organic") or []
    return [
        {
            "content": _clean(item.get("snippet") or "")[:400],
            "source": item.get("link") or "serper",
            "title": item.get("title") or "",
            "score": 0.7,
            "id": f"web-serper-{i}",
            "retrieval": "web:serper",
        }
        for i, item in enumerate(organic[:top_k])
    ] or None


def _wiki_api(lang: str, params: dict[str, Any]) -> dict[str, Any]:
    import httpx

    r = httpx.get(
        f"https://{lang}.wikipedia.org/w/api.php",
        params={**params, "format": "json"},
        headers={"User-Agent": _UA},
        timeout=_TIMEOUT_S,
    )
    r.raise_for_status()
    return r.json() or {}


def _wiki_titles(lang: str, term: str, limit: int) -> list[str]:
    """概念定位：只认 opensearch 标题检索（"剧本杀"直中条目）。刻意不做
    全文搜索兜底——srsearch 排序噪声大（实测"宠物医院预约问诊"头名是
    电视剧条目），精准优先、宁缺勿噪，缺口由本地基线补位。"""
    data = _wiki_api(lang, {"action": "opensearch", "search": term, "limit": limit})
    titles = [t for t in (data[1] if isinstance(data, list) and len(data) > 1 else []) if t]
    return titles[:limit]


def _wiki_extracts(lang: str, titles: list[str]) -> list[dict[str, Any]]:
    """条目导语作证据正文（比全文搜索的碎片摘要质量高一个档）。"""
    if not titles:
        return []
    data = _wiki_api(
        lang,
        {
            "action": "query",
            "prop": "extracts",
            "exintro": 1,
            "explaintext": 1,
            "titles": "|".join(titles[:6]),
        },
    )
    pages = ((data.get("query") or {}).get("pages") or {}).values()
    out = []
    for page in pages:
        title = str(page.get("title") or "")
        extract = _clean(str(page.get("extract") or ""))[:420]
        if title and extract:
            out.append(
                {
                    "content": extract,
                    "source": f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}",
                    "title": title,
                    "score": 0.75,
                    "id": f"web-wiki-{lang}-{title[:16]}",
                    "retrieval": f"web:wikipedia:{lang}",
                }
            )
    return out


# 查询蒸馏：话题名是营销句（"XX管理与YY助手 Pro"），直接全文搜噪声大。
# 确定性拆分：连接词切段 + 剥通用后缀，每段独立检索再合并（实测
# "宠物医院预约问诊系统" 整句会命中疫情条目，蒸馏成 "宠物医院" 就正了）
_SPLIT_RE = re.compile(r"[——\-·，,、\s]+|与|和|及")
_GENERIC_RE = re.compile(
    r"(管理系统|管理平台|智能|系统|平台|助手|工具|中台|方案|服务|Pro|pro|App|app)+$"
)


def _distill_queries(query: str) -> list[str]:
    """段落 → 递减前缀候选（CJK 粗分词）：宠物医院预约问诊 →
    [宠物医院预约问诊?, 宠物医院, 宠物医, 宠物]——配合 opensearch
    只认命中，等效"从具体到一般"逐级找存在的百科概念。"""
    out: list[str] = []
    for seg in _SPLIT_RE.split(query):
        seg = _GENERIC_RE.sub("", seg.strip())
        if len(seg) < 2:
            continue
        candidates = [seg] if len(seg) <= 8 else []
        for n in (4, 3, 2):
            if len(seg) > n:
                candidates.append(seg[:n])
        for c in candidates:
            if c not in out:
                out.append(c)
    return out[:8] or [query]


def _search_wikipedia(query: str, top_k: int) -> Optional[list[dict[str, Any]]]:
    """免 key 兜底：蒸馏词逐个「opensearch 定位条目 → extracts 取导语」，
    zh 优先（无果补 en），合并去重。"""
    results: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    for term in _distill_queries(query):
        if len(results) >= top_k:
            break
        for lang in ("zh", "en"):
            got_for_term = 0
            try:
                for item in _wiki_extracts(lang, _wiki_titles(lang, term, 2)):
                    if item["source"] not in seen_sources:
                        seen_sources.add(item["source"])
                        results.append(item)
                        got_for_term += 1
                        if len(results) >= top_k:
                            break
            except Exception:
                continue
            if got_for_term:
                break  # 该词 zh 已命中就不查 en（中文话题优先中文源）
    return results[:top_k] or None


_PROVIDERS: tuple[tuple[str, Callable[[str, int], Optional[list[dict[str, Any]]]]], ...] = (
    ("tavily", _search_tavily),
    ("serper", _search_serper),
    ("wikipedia", _search_wikipedia),
)


def web_search(query: str, top_k: int = 6) -> Optional[list[dict[str, Any]]]:
    """web.search 工具入口：按供应商链取第一个有产出的。失败/停用 → None
    （调用方回落本地 RAG——诚实降级，检索方式永远如实标注）。"""
    if not web_search_enabled():
        return None
    query = (query or "").strip()
    if not query:
        return None
    for _name, provider in _PROVIDERS:
        try:
            results = provider(query, top_k)
            if results:
                return results
        except Exception:
            continue
    return None


# ── MCP 兼容注册表（P2b 的外部 MCP 服务器与沙盒执行工具接到这里）──────

MCP_TOOLS: dict[str, dict[str, Any]] = {
    "web.search": {
        "name": "web.search",
        "description": "真外网搜索取证据（只读）：返回带真实 URL 与溯源标注的检索结果",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "检索词"},
                "top_k": {"type": "integer", "default": 6},
            },
            "required": ["query"],
        },
        "readOnly": True,  # P2a 只读工具；P2b 执行类工具 readOnly=False 且必须走沙盒
        "handler": web_search,
    },
}
