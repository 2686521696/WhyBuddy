"""画页用的库存图：搜到真 URL 就直挂 <img src>，不下载。

2026-08-19 用户裁决：「直接接地址，就不用下载了」。

⚠ 不能让模型自己编 unsplash / pexels 的 photo id——编出来几乎全是 404。
  真机（团购那轮）页面上只有 placehold.co 色块，看起来像「网络找图没生效」。
  原因不是网断：第 3 步提示词写死了关图，外链闸只放行 placehold.co，
  Unsplash 一写进 HTML 整页校验失败（refine_page_scope 头注那次同型）。

做法：Openverse 免 key 搜（2026-08-07 生产机探过，api.openverse.org 200），
把**返回里的 URL**写进画页提示词。闸只放行这几家图床，页脚仍不许乱挂域名。

搜不到 / 超时 fail-open 回 placehold.co，不拖画页。
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse

_OPENVERSE = "https://api.openverse.org/v1/images/"
_UA = "SlideRule/stock-images (URL lookup only; no download)"
_TIMEOUT_S = 3.0
_MAX_QUERIES = 3
_MAX_HITS = 6

# 闸与提示词共用。不在这里的主机，搜到了也不注入——否则模型抄了仍会被拦。
STOCK_IMAGE_HOSTS = (
    "images.unsplash.com",
    "images.pexels.com",
    "upload.wikimedia.org",
    "staticflickr.com",
    "rawpixel.com",
)

_OK_LICENSE = frozenset({"cc0", "pdm"})

# 中文意图 → Openverse 英语查询。只做桥，答案仍是搜到的 URL。
_ZH_HINTS = (
    ("红富士", "fuji apple fruit"),
    ("苹果", "red apple fruit"),
    ("蔬菜", "fresh vegetables"),
    ("水果", "fresh fruit"),
    ("牛奶", "fresh milk bottle"),
    ("鸡蛋", "eggs carton"),
    ("团购", "fresh groceries"),
    ("生鲜", "fresh produce"),
    ("药品", "medicine pharmacy"),
    ("宠物", "pet animal"),
    ("面包", "bakery bread"),
)


def _host_ok(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    return any(host == a or host.endswith("." + a) for a in STOCK_IMAGE_HOSTS)


def _queries(spec: Dict[str, Any], goal: str = "") -> List[str]:
    pages = spec.get("pages") or []
    names = " ".join(
        f"{p.get('name', '')} {p.get('purpose', '')}"
        for p in pages
        if isinstance(p, dict)
    )
    text = f"{goal} {spec.get('appName', '')} {names}"
    found: List[str] = []
    for zh, en in _ZH_HINTS:
        if zh in text and en not in found:
            found.append(en)
        if len(found) >= _MAX_QUERIES:
            break
    return found or ["fresh groceries produce"]


def _fetch_openverse(query: str, fetch_fn: Callable[..., Any]) -> List[Dict[str, str]]:
    payload = fetch_fn(query)
    rows = (payload or {}).get("results") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    picked: List[Dict[str, str]] = []
    rest: List[Dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        # ⚠ 真机（2026-08-19）：thumbnail 一律是 api.openverse.org 代理，
        # 不在图床白名单里——优先拿它等于搜到 8 条、注入 0 条，页面还是色块。
        # 用户要的是直挂地址，用原图 url。
        url = str(row.get("url") or row.get("thumbnail") or "").strip()
        if not url.startswith("https://") or not _host_ok(url):
            continue
        item = {
            "url": url,
            "query": query,
            "label": str(row.get("title") or query).strip()[:40] or query,
            "source": "openverse",
            "license": str(row.get("license") or "").lower(),
        }
        if item["license"] in _OK_LICENSE:
            picked.append(item)
        else:
            rest.append(item)
        if len(picked) >= 2:
            break
    # 薄语料时退到带署名的图，总比只有色块强。
    while len(picked) < 2 and rest:
        picked.append(rest.pop(0))
    return picked


def _default_fetch(query: str) -> Dict[str, Any]:
    import httpx

    response = httpx.get(
        _OPENVERSE,
        params={"q": query, "page_size": 8, "mature": "false"},
        headers={"User-Agent": _UA, "Accept": "application/json"},
        timeout=_TIMEOUT_S,
    )
    response.raise_for_status()
    data = response.json()
    return data if isinstance(data, dict) else {}


def lookup_stock_images(
    spec: Dict[str, Any],
    goal: str = "",
    *,
    fetch_fn: Optional[Callable[[str], Any]] = None,
) -> List[Dict[str, str]]:
    """零 LLM。挂了或空结果返回 []，由调用方继续用 placehold.co。"""
    fetch = fetch_fn or _default_fetch
    hits: List[Dict[str, str]] = []
    seen: set[str] = set()
    for query in _queries(spec, goal):
        try:
            batch = _fetch_openverse(query, fetch)
        except Exception as exc:  # noqa: BLE001 — 搜图是增强，不许拖画页
            print(f"[stock_images] ⚠ 查询失败（{query}）：{str(exc)[:160]}")
            continue
        for item in batch:
            url = item["url"]
            if url in seen:
                continue
            seen.add(url)
            hits.append(item)
            if len(hits) >= _MAX_HITS:
                return hits
    return hits


def render_stock_images(hits: List[Dict[str, str]]) -> str:
    if not hits:
        return ""
    lines = [
        "## 库存图（直接写进 <img src>，不要改 URL、不要另编图床地址）",
    ]
    for item in hits:
        lines.append(f"- {item.get('label') or item.get('query')}：{item['url']}")
    lines.append(
        "商品缩略图、头像、凭证预览优先用上面的完整地址。"
        "对不上的再用 https://placehold.co。"
    )
    return "\n".join(lines)


def attach_stock_images(style: str, block: str) -> str:
    prose = (style or "").strip()
    extra = (block or "").strip()
    if not extra:
        return prose
    if not prose:
        return extra
    if extra in prose:
        return prose
    return f"{prose}\n\n{extra}"
