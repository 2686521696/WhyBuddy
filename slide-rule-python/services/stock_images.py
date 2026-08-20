"""画页用的库存图：搜到真 URL 就直挂 <img src>，不下载。

2026-08-19 用户裁决：「直接接地址，就不用下载了」。

⚠ 不能让模型自己编 unsplash / pexels 的 photo id——编出来几乎全是 404。
  真机（团购那轮）页面上只有 placehold.co 色块，看起来像「网络找图没生效」。
  原因不是网断：第 3 步提示词写死了关图，外链闸只放行 placehold.co，
  Unsplash 一写进 HTML 整页校验失败（refine_page_scope 头注那次同型）。

做法：Openverse 免 key 搜（2026-08-07 生产机探过，api.openverse.org 200），
把**返回里的 URL**写进画页提示词。闸只放行这几家图床，页脚仍不许乱挂域名。

搜不到 / 超时 fail-open 回 placehold.co，不拖画页。

⚠ 2026-08-20 真机（满电青年 / 电动车综合服务）：卡片上出现枇杷和
「Battery Error」图。词表当时只有团购生鲜，对不上就回落
`fresh groceries produce`，Openverse 给水果，提示词又写「商品缩略图
优先用上面的地址」——模型照抄，话题对不上也塞进去。
错图比没图更糟：对不上词表就按话题自己的短语搜，绝不回落生鲜。

⚠ 同日第二趟：查询改成充电桩之后，预览卡上仍是番茄 / 彩椒。
规格 purpose 写了「外卖骑手」（用户分层，不是画面主体），词表
`外卖 → food delivery takeaway` 仍进前三条。Openverse 的 q 是
词或匹配，`food` 一条就把生鲜照片抬到最前，模型再照抄进卡片。
车辆族命中时丢掉食物查询；命中标题/标签是生鲜的结果也不注入。

⚠ 同日第三趟：词表挡了「外卖」查询，预览仍可能是番茄。根因是把一袋
URL 注进画页提示词——模型四处粘贴，卡片 alt 是充电桩、src 却是袋里
排第一的生鲜图。

成熟开源不这么干：
  · abi/screenshot-to-code：画页只用 placehold.co，alt 是这张图的描述；
    页面落地后再按 alt 换 src（老版 generate_images；现行 disabled 政策
    同款占位）。
  · kiluazen/tteg：一图一条检索词（batch manifest），不是全局袋子。
    托管 API 有日限额、要他们的 Unsplash key，逻辑抄、服务不接。
  · WordPress/openverse：免 key 的公开照片目录，仍作检索口。

所以：提示词不再塞 URL；画完后按每张 <img alt> 搜 Openverse 直挂地址。
"""

from __future__ import annotations

import re
from html import unescape
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse

_OPENVERSE = "https://api.openverse.org/v1/images/"
_UA = "SlideRule/stock-images (URL lookup only; no download)"
_TIMEOUT_S = 3.0
_MAX_QUERIES = 3
_MAX_HITS = 6
_MAX_FILL_QUERIES = 8

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
# 长词优先（充电桩 盖住 充电；红富士 盖住 苹果），见 _queries。
_ZH_HINTS = (
    ("充电桩", "ev charging station"),
    ("电动汽车", "electric car charging"),
    ("电动车", "electric scooter motorcycle"),
    ("电瓶车", "electric bicycle scooter"),
    ("锂电池", "lithium battery pack"),
    ("红富士", "fuji apple fruit"),
    ("生鲜", "fresh produce"),
    ("团购", "fresh groceries"),
    ("蔬菜", "fresh vegetables"),
    ("水果", "fresh fruit"),
    ("苹果", "red apple fruit"),
    ("牛奶", "fresh milk bottle"),
    ("鸡蛋", "eggs carton"),
    ("药店", "pharmacy drugstore"),
    ("药品", "medicine pharmacy"),
    ("医院", "hospital clinic"),
    ("诊所", "medical clinic"),
    ("宠物", "pet animal"),
    ("民宿", "guesthouse inn room"),
    ("酒店", "hotel lobby room"),
    ("外卖", "food delivery takeaway"),
    ("仓储", "warehouse logistics"),
    ("物流", "cargo logistics truck"),
    ("工单", "maintenance work order"),
    ("面包", "bakery bread"),
    ("电池", "electric vehicle battery"),
    ("充电", "ev charging cable"),
    ("内容团队", "creative team office"),
    ("自媒体", "content creator filming"),
    ("短视频", "smartphone filming video"),
    ("素材库", "digital content library"),
    ("创作者", "content creator studio"),
    ("素材", "photo video footage"),
    ("封面", "video thumbnail still"),
)

# 车辆 vs 食物：用户分层里的「外卖骑手」不是画面要搜的东西。
_VEHICLE_EN = frozenset(
    {
        "ev charging station",
        "electric car charging",
        "electric scooter motorcycle",
        "electric bicycle scooter",
        "lithium battery pack",
        "electric vehicle battery",
        "ev charging cable",
    }
)
_FOOD_EN = frozenset(
    {
        "fuji apple fruit",
        "fresh produce",
        "fresh groceries",
        "fresh vegetables",
        "fresh fruit",
        "red apple fruit",
        "fresh milk bottle",
        "eggs carton",
        "food delivery takeaway",
        "bakery bread",
    }
)
_VEHICLE_PAD = (
    "ev charging station",
    "electric scooter motorcycle",
    "electric vehicle battery",
)

# 标题/标签里出现这些，非食物查询就丢掉。分词后比对，避免 production 误伤。
_FOOD_HIT_TOKENS = frozenset(
    {
        "tomato",
        "tomatoes",
        "pepper",
        "peppers",
        "capsicum",
        "vegetable",
        "vegetables",
        "fruit",
        "fruits",
        "apple",
        "apples",
        "banana",
        "loquat",
        "grocery",
        "groceries",
        "salad",
        "cuisine",
        "chili",
        "chilli",
        "bibimbap",
        "chippy",
        "chips",
        "takeaway",
        "takeout",
        "food",
        "meal",
        "dinner",
        "lunch",
        "breakfast",
        "produce",
        "greens",
        "leafy",
        "veg",
        "cabbage",
        "carrot",
        "broccoli",
        "lettuce",
    }
)
_FOOD_HIT_ZH = (
    "番茄",
    "西红柿",
    "蔬菜",
    "水果",
    "辣椒",
    "彩椒",
    "柿子椒",
    "枇杷",
    "苹果",
)

_BRACKET_RE = re.compile(r"【[^】]*】|\[[^\]]*\]")
_SPLIT_RE = re.compile(r"[——\-·，,、/｜|\s]+|与|和|及|一站式")
_GENERIC_TAIL_RE = re.compile(
    r"(综合服务|管理系统|管理平台|工作台|智能|系统|平台|助手|工具|中台|方案|服务|赛道)+$"
)
_IMG_RE = re.compile(r"<img\b[^>]*>", re.I | re.S)
_PLACEHOLD_SIZE_RE = re.compile(r"placehold\.co/(\d+)x(\d+)", re.I)
#: 模型常把模板英文写进 alt，placehold.co?text= 会把「AI Workflow Video」
#: 印在卡片上（2026-08-21 素材雷达）。这种 alt 不能当检索词。
_GENERIC_ALT_RE = re.compile(
    r"(workflow|dashboard|placeholder|hero(?:\s+image)?|"
    r"\bai\s+video\b|stock\s+photo|lorem|dummy)",
    re.I,
)


def _host_ok(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    return any(host == a or host.endswith("." + a) for a in STOCK_IMAGE_HOSTS)


def _topic_text(spec: Dict[str, Any], goal: str = "") -> str:
    pages = spec.get("pages") or []
    names = " ".join(
        f"{p.get('name', '')} {p.get('purpose', '')}"
        for p in pages
        if isinstance(p, dict)
    )
    return f"{goal} {spec.get('appName', '')} {names}"


def _topic_phrases(text: str) -> List[str]:
    """词表没命中时，用话题自己的短语搜。短于 3 字的丢掉（太泛）。"""
    cleaned = _BRACKET_RE.sub(" ", text or "")
    out: List[str] = []
    for raw in _SPLIT_RE.split(cleaned):
        seg = _GENERIC_TAIL_RE.sub("", raw.strip())
        if len(seg) < 3 or seg in out:
            continue
        out.append(seg)
        if len(out) >= _MAX_QUERIES:
            break
    return out


def _reconcile_queries(found: List[str]) -> List[str]:
    """车辆话题丢掉食物查询，空出来的槽补充电桩 / 电摩 / 车电。"""
    if any(q in _VEHICLE_EN for q in found):
        found = [q for q in found if q not in _FOOD_EN]
        for extra in _VEHICLE_PAD:
            if extra not in found and len(found) < _MAX_QUERIES:
                found.append(extra)
    return found[:_MAX_QUERIES]


def _queries(spec: Dict[str, Any], goal: str = "") -> List[str]:
    text = _topic_text(spec, goal)
    found: List[str] = []
    matched_zh: List[str] = []
    # 长词优先，避免「充电」抢在「充电桩」前面、或「苹果」误伤别的词。
    for zh, en in sorted(_ZH_HINTS, key=lambda p: len(p[0]), reverse=True):
        if zh not in text:
            continue
        if any(zh != prev and zh in prev for prev in matched_zh):
            continue
        if en not in found:
            found.append(en)
            matched_zh.append(zh)
        if len(found) >= _MAX_QUERIES:
            break
    found = _reconcile_queries(found)
    if found:
        return found
    # 对不上词表：搜话题短语。空列表 = 不注入，页面走 placehold.co。
    return _topic_phrases(text)


def _row_blob(row: Dict[str, Any]) -> str:
    title = str(row.get("title") or "")
    tags = row.get("tags") or []
    names: List[str] = []
    if isinstance(tags, list):
        for tag in tags:
            if isinstance(tag, dict):
                names.append(str(tag.get("name") or ""))
            else:
                names.append(str(tag))
    return f"{title} {' '.join(names)}"


def _query_is_food(query: str) -> bool:
    return query in _FOOD_EN


def _hit_looks_food(row: Dict[str, Any]) -> bool:
    blob = _row_blob(row)
    if any(mark in blob for mark in _FOOD_HIT_ZH):
        return True
    tokens = set(re.findall(r"[a-z0-9]+", blob.lower()))
    return bool(tokens & _FOOD_HIT_TOKENS)


def _keep_hit(query: str, row: Dict[str, Any]) -> bool:
    # 食物话题要的就是生鲜。车辆 / 其它话题：生鲜命中比缺图更糟。
    if _query_is_food(query):
        return True
    if _hit_looks_food(row):
        title = str(row.get("title") or "").strip()[:40]
        print(f"[stock_images] skip off-topic {title!r} q={query}")
        return False
    return True


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
        if not _keep_hit(query, row):
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


def _default_fetch(query: str, aspect: Optional[str] = None) -> Dict[str, Any]:
    import httpx

    params: Dict[str, Any] = {
        "q": query,
        "page_size": 20,
        "mature": "false",
        "category": "photograph",
    }
    # Openverse：wide / tall / square。tteg 按 orientation 搜 Unsplash，这里对齐。
    if aspect in ("wide", "tall", "square"):
        params["aspect_ratio"] = aspect

    response = httpx.get(
        _OPENVERSE,
        params=params,
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
    queries = _queries(spec, goal)
    print(f"[stock_images] queries={queries}")
    for query in queries:
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
        "只把上面的地址用在画面语义相符的配图上（商品照、场景照、头像）。"
        "对不上话题的格子用 https://placehold.co，不要把无关照片硬塞进去。"
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


def _attr(tag: str, name: str) -> str:
    match = re.search(
        rf'{name}\s*=\s*(["\'])(.*?)\1', tag, flags=re.I | re.S
    )
    return unescape(match.group(2)).strip() if match else ""


def _set_src(tag: str, url: str) -> str:
    if re.search(r"src\s*=", tag, flags=re.I):
        return re.sub(
            r'src\s*=\s*(["\'])([^"\']*)\1',
            lambda m: f"src={m.group(1)}{url}{m.group(1)}",
            tag,
            count=1,
            flags=re.I,
        )
    return tag


def _should_fill(src: str, alt: str) -> bool:
    if len(alt) < 2:
        return False
    low = (src or "").lower()
    if "placehold.co" in low:
        return True
    # 模型默写 unsplash 番茄图：闸放行主机，只能按 alt 重搜换掉。
    return bool(src) and _host_ok(src)


def _aspect_of(src: str) -> Optional[str]:
    match = _PLACEHOLD_SIZE_RE.search(src or "")
    if not match:
        return None
    width, height = int(match.group(1)), int(match.group(2))
    if width <= 0 or height <= 0:
        return None
    ratio = width / height
    if ratio >= 1.3:
        return "wide"
    if ratio <= 0.77:
        return "tall"
    return "square"


def _img_search_query(alt: str, topic_queries: List[str]) -> Optional[str]:
    """tteg：检索词描述**这张照片**。车辆话题里的「外卖骑手」改搜电摩，不搜外卖。"""
    text = " ".join((alt or "").split())
    if _GENERIC_ALT_RE.search(text):
        return topic_queries[0] if topic_queries else "content creator smartphone video"
    if len(text) < 3:
        return None
    vehicle_topic = any(query in _VEHICLE_EN for query in topic_queries)
    latin = len(re.findall(r"[A-Za-z]", text))
    if latin >= 6:
        query = text[:120]
    else:
        found = _queries({"appName": "", "pages": [{"name": text, "purpose": ""}]}, text)
        query = found[0] if found else None
    if not query:
        return None
    foodish = _query_is_food(query) or _hit_looks_food({"title": query, "tags": []})
    if vehicle_topic and foodish:
        low = text.lower()
        if any(mark in low for mark in ("rider", "骑手", "avatar", "头像", "portrait", "scooter")):
            return "electric scooter motorcycle"
        padded = _reconcile_queries(list(topic_queries) + [query])
        return padded[0] if padded else None
    return query


def _resolve_query(
    query: str,
    *,
    fetch_fn: Optional[Callable[[str], Any]],
    aspect: Optional[str],
    cache: Dict[str, Optional[str]],
) -> Optional[str]:
    key = f"{query}|{aspect or ''}"
    if key in cache:
        return cache[key]
    url: Optional[str] = None
    try:
        if fetch_fn is None:
            batch = _fetch_openverse(
                query, lambda q, a=aspect: _default_fetch(q, aspect=a)
            )
        else:
            batch = _fetch_openverse(query, fetch_fn)
        url = batch[0]["url"] if batch else None
    except Exception as exc:  # noqa: BLE001 — 搜图是增强
        print(f"[stock_images] ⚠ 按格查询失败（{query}）：{str(exc)[:160]}")
        url = None
    cache[key] = url
    if url:
        host = urlparse(url).hostname or ""
        print(f"[stock_images] fill q={query!r} host={host}")
    return url


def _blank_placehold_src(src: str) -> str:
    match = _PLACEHOLD_SIZE_RE.search(src or "")
    if not match:
        return src
    return f"https://placehold.co/{match.group(1)}x{match.group(2)}/e2e8f0/cbd5e1"


def _neutralize_placehold_text(html: str) -> str:
    """剥掉 placehold.co?text= 里的英文模板词。搜不到真图时卡片也不该写 AI Workflow Video。"""

    def fix(tag: str) -> str:
        src = _attr(tag, "src")
        low = (src or "").lower()
        if "placehold.co" not in low:
            return tag
        if "text=" not in low and "text%3d" not in low:
            return tag
        return _set_src(tag, _blank_placehold_src(src))

    return _IMG_RE.sub(lambda m: fix(m.group(0)), html or "")


def fill_stock_placeholders(
    html: str,
    *,
    spec: Optional[Dict[str, Any]] = None,
    goal: str = "",
    topic_queries: Optional[List[str]] = None,
    fetch_fn: Optional[Callable[[str], Any]] = None,
    cache: Optional[Dict[str, Optional[str]]] = None,
) -> str:
    """screenshot-to-code 的换图步 + tteg 的一图一查询。挂了原样返回。"""
    markup = html or ""
    if "<img" not in markup.lower():
        return markup
    topics = list(topic_queries) if topic_queries is not None else _queries(spec or {}, goal)
    store: Dict[str, Optional[str]] = cache if cache is not None else {}
    matches = list(_IMG_RE.finditer(markup))
    jobs: List[tuple[Any, str, str, Optional[str]]] = []
    seen_q = 0
    queued: set[str] = set()
    for match in matches:
        tag = match.group(0)
        src = _attr(tag, "src")
        alt = _attr(tag, "alt") or _attr(tag, "title")
        if not _should_fill(src, alt):
            continue
        query = _img_search_query(alt, topics)
        if not query:
            continue
        aspect = _aspect_of(src)
        key = f"{query}|{aspect or ''}"
        if key not in queued:
            if seen_q >= _MAX_FILL_QUERIES:
                continue
            queued.add(key)
            seen_q += 1
        jobs.append((match, tag, query, aspect))
    if not jobs:
        return _neutralize_placehold_text(markup)
    for _match, _tag, query, aspect in jobs:
        _resolve_query(query, fetch_fn=fetch_fn, aspect=aspect, cache=store)
    out = markup
    for match, tag, query, aspect in reversed(jobs):
        url = store.get(f"{query}|{aspect or ''}")
        if not url:
            continue
        out = out[: match.start()] + _set_src(tag, url) + out[match.end() :]
    return _neutralize_placehold_text(out)


def fill_stock_in_pages(
    pages: Dict[str, str],
    spec: Dict[str, Any],
    goal: str = "",
    *,
    fetch_fn: Optional[Callable[[str], Any]] = None,
    cache: Optional[Dict[str, Optional[str]]] = None,
    skip_ids: Optional[set[str]] = None,
) -> Dict[str, str]:
    """对每一页做 fill_stock_placeholders。单页挂了留下原 HTML。"""
    skip = skip_ids or set()
    store: Dict[str, Optional[str]] = cache if cache is not None else {}
    topics = _queries(spec, goal)
    out = dict(pages)
    for page_id, html in pages.items():
        if page_id in skip:
            continue
        try:
            out[page_id] = fill_stock_placeholders(
                html,
                topic_queries=topics,
                fetch_fn=fetch_fn,
                cache=store,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[stock_images] ⚠ 页 {page_id} 换图失败（不拦）：{str(exc)[:160]}")
            out[page_id] = html
    return out
