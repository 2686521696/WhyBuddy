"""抓 forum.trae.cn 话题 → 结构化「话题档」。

    cd slide-rule-python
    .venv/bin/python scripts/forum_fetch.py <链接清单> <输出.jsonl>
    .venv/bin/python scripts/forum_neon.py  <输出.jsonl>      # 落 Neon
    .venv/bin/python scripts/forum_analyze.py                 # 出分析报告

链接清单一行一条，完整 URL / `/t/topic/123` / 光秃秃一个数字都能认。
现成的一份在 scripts/data/trae_contest_topics_300.tsv（第三列是链接）。

论坛是 Discourse，/t/topic/{id}.json 直接给结构化数据，不用解 HTML 页面。
正文在 post_stream.posts[0].cooked（是 HTML），回帖在后面几条。

**断点续跑**：输出文件已有的话题会跳过，中途挂了直接重跑同一条命令即可。
单条失败（404/限流）只记一行错，不中断整批——300 条里有几条挂掉不该让
前面两百多条白抓。
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable, Optional

import httpx

BASE = "https://forum.trae.cn"
UA = "Mozilla/5.0 (compatible; WhyBuddy-topic-archiver/1.0)"


# ── URL / ID ────────────────────────────────────────────────
_ID_RE = re.compile(r"/t/(?:topic/)?(?:[^/]+/)?(\d+)")


def parse_topic_id(raw: str) -> Optional[int]:
    """从一行输入里取话题 id：完整 URL、/t/topic/123、或者光秃秃一个数字都吃。"""
    s = (raw or "").strip()
    if not s or s.startswith("#"):
        return None
    if s.isdigit():
        return int(s)
    m = _ID_RE.search(s)
    return int(m.group(1)) if m else None


# ── HTML → 纯文本 ────────────────────────────────────────────
class _Text(HTMLParser):
    """把 Discourse 的 cooked HTML 抽成可读纯文本，顺带收集图片和外链。

    没装 bs4，用标准库够了——cooked 是服务端渲染过的干净 HTML，
    不需要容错解析器。"""

    _SKIP = {"script", "style"}
    # Discourse 灯箱会在图片下挂一块 meta（文件名/2167×725/110 KB），
    # 那是 UI 装饰不是正文——混进 body_text 会污染后面的文本分析
    _SKIP_CLASS = {"meta", "informations", "filename", "expand"}
    _BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
              "blockquote", "pre", "table", "hr"}

    # 空元素不进栈——它们没有闭合标签，压栈会让深度永远退不回来
    _VOID = {"img", "br", "hr", "input", "meta", "link", "source", "col", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.images: list[str] = []
        self.links: list[str] = []
        # 每个未闭合元素一项，值表示「它是否是要跳过的元素」；
        # 用栈而不是计数器，嵌套 div 才不会把外层的跳过状态提前退掉
        self._stack: list[bool] = []

    @property
    def _skip_depth(self) -> int:
        return sum(self._stack)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        a = dict(attrs)
        classes = set((a.get("class") or "").split())
        skip_me = tag in self._SKIP or bool(classes & self._SKIP_CLASS)
        if tag not in self._VOID:
            self._stack.append(skip_me)
        if tag == "img":
            src = a.get("src") or ""
            # Discourse 会给表情、头像塞 img，滤掉，只留正文配图
            if src and "/images/emoji/" not in src and "/user_avatar/" not in src:
                self.images.append(src)
        elif tag == "a":
            href = a.get("href") or ""
            if href.startswith("http"):
                self.links.append(href)
        if tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag not in self._VOID and self._stack:
            self._stack.pop()
        if tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)

    def result(self) -> str:
        text = "".join(self.parts)
        text = re.sub(r"[ \t ]+", " ", text)
        text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
        return text.strip()


def strip_html(cooked: str) -> tuple[str, list[str], list[str]]:
    p = _Text()
    try:
        p.feed(cooked or "")
        p.close()
    except Exception:  # noqa: BLE001 — 单帖畸形 HTML 不该拖垮整批
        return html.unescape(re.sub(r"<[^>]+>", " ", cooked or "")).strip(), [], []
    # 去重但保序
    seen: set[str] = set()
    imgs = [u for u in p.images if not (u in seen or seen.add(u))]
    seen = set()
    links = [u for u in p.links if not (u in seen or seen.add(u))]
    return p.result(), imgs, links


# ── 抓取 ─────────────────────────────────────────────────────
def fetch_topic(client: httpx.Client, topic_id: int, retries: int = 3) -> dict[str, Any]:
    url = f"{BASE}/t/topic/{topic_id}.json"
    last: Optional[Exception] = None
    for attempt in range(retries):
        try:
            resp = client.get(url)
            if resp.status_code == 404:
                raise LookupError(f"topic {topic_id} 不存在或不可见 (404)")
            if resp.status_code == 429:
                # 论坛限流：退避后重来，别把自己打黑
                time.sleep(5 * (attempt + 1))
                continue
            resp.raise_for_status()
            return resp.json()
        except LookupError:
            raise
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"topic {topic_id} 抓取失败: {last}")


def to_archive(data: dict[str, Any], category_names: dict[int, str]) -> dict[str, Any]:
    """Discourse 话题 JSON → 话题档记录。"""
    posts = (data.get("post_stream") or {}).get("posts") or []
    first = posts[0] if posts else {}
    body_text, images, links = strip_html(first.get("cooked") or "")

    replies = []
    for p in posts[1:]:
        rtext, _, _ = strip_html(p.get("cooked") or "")
        replies.append({
            "post_number": p.get("post_number"),
            "username": p.get("username"),
            "created_at": p.get("created_at"),
            "text": rtext[:4000],
            "like_count": _reaction_count(p),
        })

    topic_id = int(data.get("id"))
    cat_id = data.get("category_id")
    return {
        "id": f"trae:{topic_id}",
        "topic_id": topic_id,
        "url": f"{BASE}/t/topic/{topic_id}",
        "title": (data.get("title") or "").strip(),
        "category_id": cat_id,
        "category_name": category_names.get(cat_id or -1) or "",
        "tags": [t["name"] if isinstance(t, dict) else t for t in (data.get("tags") or [])],
        "author_username": first.get("username") or "",
        "author_name": first.get("name") or "",
        "created_at": data.get("created_at"),
        "last_posted_at": data.get("last_posted_at"),
        "posts_count": _int(data.get("posts_count")),
        "reply_count": _int(data.get("reply_count")),
        "views": _int(data.get("views")),
        "like_count": _int(data.get("like_count")),
        "participant_count": _int(data.get("participant_count")),
        "word_count": _int(data.get("word_count")),
        "has_accepted_answer": bool(data.get("has_accepted_answer")),
        "body_html": first.get("cooked") or "",
        "body_text": body_text,
        "images": images,
        "links": links,
        "replies": replies,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def _int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _reaction_count(post: dict[str, Any]) -> int:
    for a in post.get("actions_summary") or []:
        if a.get("id") == 2:  # 2 = like
            return _int(a.get("count"))
    return 0


def load_category_names(client: httpx.Client) -> dict[int, str]:
    """全部分类 id → 名称。

    用 /site.json 而不是 /categories.json：后者只给顶层分类，子分类要么缺失、
    要么只在 subcategory_list 里出现一部分。大赛的 300 个帖子全在子分类 40
    （【大赛初赛专区】，挂在 38 下面），走 categories.json 会全部查不到名字。
    site.json 一次性给全 38 个分类，含子分类。"""
    try:
        cats = client.get(f"{BASE}/site.json").json().get("categories") or []
    except Exception:  # noqa: BLE001 — 拿不到分类名不影响主数据
        return {}
    return {c["id"]: c.get("name") or "" for c in cats if c.get("id") is not None}


def make_client() -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(30.0, connect=15.0),
        headers={"User-Agent": UA, "Accept": "application/json"},
        follow_redirects=True,
    )


def run(ids: Iterable[int], out_path: Path, delay: float = 0.7) -> tuple[int, int]:
    """顺序抓取并逐条写 JSONL，支持断点续跑（已抓过的 id 跳过）。"""
    done: set[int] = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            try:
                done.add(int(json.loads(line)["topic_id"]))
            except Exception:  # noqa: BLE001
                continue

    ids = [i for i in ids if i not in done]
    ok = fail = 0
    with make_client() as client:
        cats = load_category_names(client)
        with out_path.open("a", encoding="utf-8") as fh:
            for n, tid in enumerate(ids, 1):
                try:
                    rec = to_archive(fetch_topic(client, tid), cats)
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    fh.flush()
                    ok += 1
                    print(f"[{n}/{len(ids)}] ✓ {tid} {rec['title'][:40]} "
                          f"({len(rec['body_text'])}字 {rec['views']}阅)", flush=True)
                except Exception as exc:  # noqa: BLE001 — 单条失败不中断整批
                    fail += 1
                    print(f"[{n}/{len(ids)}] ✗ {tid} {exc}", flush=True)
                time.sleep(delay)
    return ok, fail


if __name__ == "__main__":
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    raw_ids = [parse_topic_id(l) for l in src.read_text(encoding="utf-8").splitlines()]
    todo = [i for i in raw_ids if i]
    print(f"输入 {len(raw_ids)} 行 → 有效话题 {len(todo)} 个")
    ok, fail = run(todo, dst)
    print(f"完成：成功 {ok}，失败 {fail} → {dst}")
