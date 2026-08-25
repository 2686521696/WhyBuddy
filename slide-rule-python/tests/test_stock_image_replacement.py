"""画布手动换图：查询阶梯 + 只回白名单图床。

⚠ 这条链路跟自动画页的 fill_stock_placeholders **取舍相反**：
  自动那条 fail-open（搜不到留占位图，不能拖垮推演），
  这条是用户点了按钮在等，搜不到必须如实回空，不许伪造绿灯。

正向：整句搜不到时会逐级退让到搜得到的短词。
反向：退让不许无限放宽（说明性尾词不单独成词）；候选不许出白名单。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spec_page_html import _ALLOWED_HOSTS  # noqa: E402
from services.stock_images import (  # noqa: E402
    STOCK_IMAGE_HOSTS,
    build_query_ladder,
    search_replacement_images,
)


def _fetch(rows):
    """假 Openverse。返回一个 fetch_fn，记录被搜过的词。"""
    seen = []

    def fetch(query):
        seen.append(query)
        return {"results": rows.get(query, [])}

    fetch.seen = seen  # type: ignore[attr-defined]
    return fetch


def _row(url, license_="cc0", title="t"):
    return {"url": url, "license": license_, "title": title, "tags": []}


class Test查询阶梯:
    def test_整句在最前_先尽量保住原意(self):
        ladder = build_query_ladder("ancient book page manuscript", "tall")
        assert ladder[0] == ("ancient book page manuscript", "tall")
        # ⚠ aspect 不能一路带到底：真机实测 aspect=square 会把 4 条结果砍成 0。
        assert ladder[1] == ("ancient book page manuscript", None)

    def test_逐级变短_最后退到两个词(self):
        ladder = build_query_ladder("Dog standard boarding cage facility", None)
        queries = [q for q, _ in ladder]
        assert queries[0] == "Dog standard boarding cage facility"
        assert queries[-1] == "Dog standard"
        # 单调不变长
        assert all(
            len(queries[i + 1]) <= len(queries[i]) for i in range(len(queries) - 1)
        )

    def test_退到最短时仍然带着主体词_而不是退成一堆说明词(self):
        """⚠ 这条第一版写成「ladder 里不许出现 'badge' 这个词」——**变异咬不住**：
        把去尾词那步删掉，最短一级恰好还是同样的两个词，判据照样绿。
        真正要钉的语义是"退让不许把主体退没了"，所以取真机那条说明词在**前面**
        的 alt（1674f484 / 810f460c 都是这个形状：portrait of Zhang ...）——
        不去尾词的话最短一级会退成 "portrait Zhang"，搜出来是肖像画不是园艺师。
        """
        ladder = build_query_ladder("portrait of Zhang master landscaper", None)
        shortest = ladder[-1][0].lower().split()
        # 主体词还在
        assert "zhang" in shortest or "landscaper" in shortest
        # 说明词没有反客为主
        assert "portrait" not in shortest

    def test_虚词不进检索词(self):
        ladder = build_query_ladder("Cat climbing frame and rest zone", None)
        assert all(" and " not in q for q, _ in ladder)

    def test_全是标点或中文时回空_调用方据此提示粘地址(self):
        assert build_query_ladder("——", None) == []
        assert build_query_ladder("", None) == []

    def test_不去重会重复请求_同一对只出现一次(self):
        ladder = build_query_ladder("Business license", None)
        assert len(ladder) == len(set(ladder))


class Test搜替换图:
    def test_整句落空就退到短词(self):
        fetch = _fetch(
            {
                "ancient book page manuscript": [],
                "ancient book page": [],
                "ancient book": [_row("https://live.staticflickr.com/1/a.jpg")],
            }
        )
        out = search_replacement_images(
            "ancient book page manuscript", "https://placehold.co/80x100", fetch_fn=fetch
        )
        assert out["query"] == "ancient book"
        assert out["candidates"]
        # 反向：确实**逐级**试过，不是一上来就搜短词
        assert "ancient book page manuscript" in fetch.seen[0]

    def test_搜不到如实回空_不回落占位图(self):
        out = search_replacement_images(
            "zzz", "https://placehold.co/40x40", fetch_fn=_fetch({})
        )
        assert out["candidates"] == []
        assert out["query"] == ""
        # ⚠ 反向：绝不许拿 placehold.co 冒充"换成功了"
        assert not any(
            "placehold" in str(c.get("url", "")) for c in out["candidates"]
        )
        # 试过的词要带回去，前端才能说清"搜了这些都没有"
        assert out["tried"]

    def test_候选只出白名单图床(self):
        fetch = _fetch(
            {
                "cat": [
                    _row("https://evil.example.com/a.jpg"),
                    _row("https://live.staticflickr.com/1/ok.jpg"),
                ]
            }
        )
        out = search_replacement_images("cat", "", fetch_fn=fetch)
        urls = [c["url"] for c in out["candidates"]]
        assert urls == ["https://live.staticflickr.com/1/ok.jpg"]

    def test_白名单已在画页闸里_换完再精修不会被判未授权外链(self):
        # ⚠ 这条不是风格问题：真机踩过 Unsplash 写进 HTML 整页校验失败。
        #    换进去的图如果不在 _ALLOWED_HOSTS 里，下一轮精修会整页红。
        for host in STOCK_IMAGE_HOSTS:
            assert host in _ALLOWED_HOSTS

    def test_某一级挂了继续退下一级_不整个失败(self):
        def fetch(query):
            if query == "orange tabby rescue cat":
                raise TimeoutError("boom")
            return {"results": [_row("https://live.staticflickr.com/1/c.jpg")]}

        out = search_replacement_images("orange tabby rescue cat", "", fetch_fn=fetch)
        assert out["candidates"]
