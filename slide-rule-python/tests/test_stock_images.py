"""库存图直挂 URL，不下载。

正向：搜到的 https 图床地址进画页提示词。
反向：模型自己编的图床、页脚乱挂的域名仍拦；调用点真在 generate_pages 之前。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spec_page_html import (  # noqa: E402
    build_page_html_prompt,
    scan_foreign_references,
)
from services.stock_images import (  # noqa: E402
    STOCK_IMAGE_HOSTS,
    attach_stock_images,
    lookup_stock_images,
    render_stock_images,
)

团购 = {
    "appName": "邻里团长台",
    "pages": [
        {"id": "p1", "name": "今日看板", "purpose": "看团购苹果和蔬菜销量"},
    ],
}


def _openverse(title: str, url: str, license_: str = "cc0") -> dict:
    return {"title": title, "thumbnail": url, "url": url, "license": license_}


def _fetch_ok(_query: str) -> dict:
    return {
        "results": [
            _openverse(
                "Fuji apples",
                "https://images.unsplash.com/photo-real-apple?w=200",
            ),
            _openverse(
                "Leafy greens",
                "https://upload.wikimedia.org/wikipedia/commons/veg.jpg",
            ),
        ]
    }


class Test查表只收白名单图床:
    def test_注入搜到的真地址(self):
        hits = lookup_stock_images(团购, goal="社区团购门店工作台", fetch_fn=_fetch_ok)
        assert hits
        assert all(h["url"].startswith("https://") for h in hits)
        assert any("unsplash.com" in h["url"] for h in hits)

    def test_编出来的图床不进名单(self):
        def fake(_q: str) -> dict:
            return {
                "results": [
                    _openverse("x", "https://evil.example.com/a.jpg"),
                    _openverse("y", "https://images.unsplash.com/photo-ok"),
                ]
            }

        hits = lookup_stock_images(团购, goal="团购苹果", fetch_fn=fake)
        urls = [h["url"] for h in hits]
        assert "https://images.unsplash.com/photo-ok" in urls
        assert not any("evil.example.com" in u for u in urls)

    def test_搜挂了返回空不炸(self):
        def boom(_q: str) -> dict:
            raise RuntimeError("openverse down")

        assert lookup_stock_images(团购, goal="团购", fetch_fn=boom) == []

    def test_直挂原图不用_openverse_缩略图代理(self):
        """2026-08-19：thumbnail 是 api.openverse.org，优先拿它等于搜到 8 条注入 0 条。"""

        def fake(_q: str) -> dict:
            return {
                "results": [
                    {
                        "title": "Fuji",
                        "thumbnail": "https://api.openverse.org/v1/images/abc/thumb/",
                        "url": "https://live.staticflickr.com/65535/a.jpg",
                        "license": "cc0",
                    }
                ]
            }

        hits = lookup_stock_images(团购, goal="团购苹果", fetch_fn=fake)
        assert hits
        assert hits[0]["url"].startswith("https://live.staticflickr.com/")
        assert "openverse.org" not in hits[0]["url"]

    def test_flickr_与_rawpixel_子域过闸(self):
        from services.stock_images import _host_ok

        assert _host_ok("https://live.staticflickr.com/1/a.jpg")
        assert _host_ok("https://images.rawpixel.com/x.jpg")
        assert not _host_ok("https://api.openverse.org/v1/images/abc/thumb/")


class Test提示词和闸:
    def test_渲染段含完整_URL(self):
        hits = lookup_stock_images(团购, goal="团购苹果", fetch_fn=_fetch_ok)
        text = render_stock_images(hits)
        assert "https://images.unsplash.com/photo-real-apple?w=200" in text
        assert "不要另编图床地址" in text

    def test_贴到风格段后面(self):
        out = attach_stock_images("暖橙色后台", "## 库存图\n- x：https://images.unsplash.com/a")
        assert out.startswith("暖橙色后台")
        assert "https://images.unsplash.com/a" in out

    def test_unsplash_直链不再整页丢掉(self):
        """2026-08-15 / 08-19：闸把 images.unsplash.com 当未授权外链，整页重问丢掉。"""
        blocking, _ = scan_foreign_references(
            '<img src="https://images.unsplash.com/photo-real-apple">'
        )
        assert blocking == [], blocking
        blocking, _ = scan_foreign_references(
            '<img src="https://live.staticflickr.com/1/a.jpg">'
            '<img src="https://images.rawpixel.com/x.jpg">'
        )
        assert blocking == [], blocking

    def test_页脚乱挂域名仍拦(self):
        blocking, _ = scan_foreign_references(
            '<footer>唯一官方: https://www.rcouyi.com</footer>'
        )
        assert blocking

    def test_画页提示词要求用列出的地址(self):
        p = build_page_html_prompt(
            "x",
            design_system=attach_stock_images(
                "后台",
                render_stock_images(
                    [{"url": "https://images.unsplash.com/photo-real", "label": "苹果"}]
                ),
            ),
        )
        assert "Image generation is disabled for this request." in p
        assert "https://images.unsplash.com/photo-real" in p
        assert "Do not invent unsplash or pexels photo IDs" in p


class Test接在画页之前:
    def test_主链路先查再画(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        src = open(
            os.path.join(root, "services", "spec_first_pipeline.py"),
            encoding="utf-8",
        ).read()
        stripped = re.sub(r'""".*?"""', "", src, flags=re.S)
        stripped = re.sub(r"#.*", "", stripped)
        i = stripped.index("lookup_stock_images(")
        j = stripped.index("generate_pages_parallel(", i)
        assert i < j
        assert "attach_stock_images(" in stripped[i:j]

    def test_图床名单两边一致(self):
        from services import spec_page_html as sph

        for host in STOCK_IMAGE_HOSTS:
            assert host in sph._ALLOWED_HOSTS
