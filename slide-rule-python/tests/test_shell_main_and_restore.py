"""外壳漂移的两个来源，两处修法（2026-08-15）。

真机八趟八次都有外壳漂移。摊开看**来源是两个**，位置也不同：

    第 3 步生成    → <main> 容器每页一套（3.5 步的 unify_shell 不管这一层）
    第 6.5 步 bind → LLM 重写整页时把 aside/header 改了

## ⚠ 一：判据此前有盲区，报出来的是假绿

`check_shell_consistency` 只给 `<aside>`/`<header>` 打指纹，**不看承载它们的
那一层**。真机形状：

    header 指纹   p1/p2/p3/p4 完全相同（len=904）
    <main> class  p1/p2: flex-1 flex flex-col min-w-0 overflow-hidden
                  p3:    flex-1 flex flex-col min-w-0 bg-slate-50 relative
                  p4:    **ml-64** flex-1 flex flex-col

p4 已经靠 flex 排在 256px 侧栏右边，又叠 `ml-64` 的 256px，整个内容区右移
一屏——而 shellProblems=0。全仓 39 份产出量过：**8/8 批全中，三个模型全漏**
（luna 是 `ml-[236px]`/`ml-[244px]`/`ml-[248px]`，差几像素肉眼无感而已）。

## ⚠ 二：还原不能无脑全换

bind 也会往壳里打**合法**的绑定孔——34 份产出里 12 份有：

    <span data-value="booking" data-aggregate="count">今日已有 N 节排课</span>
    <button data-action="createRecord" data-entity="vaccine_plan">

无脑还原会把这些洗掉，页面退回死的静态壳。所以判定标准是**结构**：
抠掉 data-* 再比指纹，一致就说明 bind 只是加了孔，该保留。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_shell import (  # noqa: E402
    check_shell_consistency,
    main_signature,
    restore_shell_after_bind,
    unify_shell,
)

_ASIDE = (
    '<aside class="w-64"><div>炼动连锁云</div>'
    '<nav><a href="#p1">首页</a><a href="#p2">排期</a></nav></aside>'
)
_HEADER = '<header class="h-16"><span>顶栏</span></header>'


def _page(main_cls: str, *, aside: str = _ASIDE, header: str = _HEADER) -> str:
    return (
        f"<!doctype html><html><body>{aside}"
        f'<main class="{main_cls}"><div>正文</div></main>{header}</body></html>'
    )


class Test判据补上了main容器:
    def test_ml64_那种双倍偏移被报出来(self):
        """★ 真机形状：壳一模一样，就 main 多了个 ml-64。"""
        pages = {
            "p1": _page("flex-1 flex flex-col"),
            "p2": _page("ml-64 flex-1 flex flex-col"),
        }
        spec = {"pages": [{"id": "p1", "name": "首页"}, {"id": "p2", "name": "排期"}]}
        paths = {p["path"] for p in check_shell_consistency(pages, spec)}
        assert "main" in paths, "main 容器漂移又没被看见"

    def test_class_顺序不同不算漂移(self):
        """⚠ 反向：同一套壳换个书写顺序不该报——那会变成对正确行为报警，
        而一道对正确行为报警的闸比没有闸更糟（它会训练人忽略它）。"""
        pages = {"p1": _page("flex-1 flex flex-col"), "p2": _page("flex-col flex flex-1")}
        spec = {"pages": [{"id": "p1", "name": "首页"}, {"id": "p2", "name": "排期"}]}
        assert "main" not in {p["path"] for p in check_shell_consistency(pages, spec)}

    def test_没有main的页不参与比对(self):
        """全屏向导页可以没有 main，拿「有 vs 没有」当漂移是误报。"""
        pages = {
            "p1": _page("flex-1"),
            "p2": "<!doctype html><html><body><div>全屏向导</div></body></html>",
        }
        spec = {"pages": [{"id": "p1", "name": "首页"}, {"id": "p2", "name": "向导"}]}
        assert "main" not in {p["path"] for p in check_shell_consistency(pages, spec)}


class Test统一时把main也收了:
    def test_unify_把各页main收成一种(self):
        """★ 此前 aside 收成 1 种、main 还是 N 种——这条钉住那个缺口。"""
        pages = {
            "p1": _page("ml-64 flex-1"),
            "p2": _page("flex-1 overflow-hidden"),
            "p3": _page("custom-scroll p-8"),
        }
        spec = {"pages": [{"id": k, "name": k} for k in pages]}
        out = unify_shell(pages, spec)["pages"]
        sigs = {main_signature(h) for h in out.values() if main_signature(h)}
        assert len(sigs) == 1, f"main 没被统一：{sigs}"

    def test_main_里面的内容不许被动(self):
        """⚠ 只换开标签的 class。正文里可能有 bind 打的孔，碰不得。"""
        pages = {"p1": _page("ml-64 flex-1"), "p2": _page("flex-1")}
        pages["p1"] = pages["p1"].replace(
            "<div>正文</div>", '<div data-rows="case"><span data-field="name">x</span></div>'
        )
        spec = {"pages": [{"id": k, "name": k} for k in pages]}
        out = unify_shell(pages, spec)["pages"]
        assert 'data-rows="case"' in out["p1"] and 'data-field="name"' in out["p1"]


class Test还原bind改坏的壳:
    def test_结构被改的换回去(self):
        """★ 真机 p2.header / p5.aside 就是这个形状。"""
        before = {"p1": _page("flex-1")}
        after = {"p1": _page("flex-1", header='<header class="h-16"><span>换了个顶栏</span></header>')}
        fixed, restored = restore_shell_after_bind(after, before)
        assert restored == ["p1.header"]
        assert "换了个顶栏" not in fixed["p1"] and "顶栏" in fixed["p1"]

    def test_只加了绑定孔的要保留(self):
        """⚠ **本文件最要紧的一条**。真机 34 份里 12 份壳里有 data-*，
        无脑还原会把它们洗掉，页面退回死的静态壳。"""
        before = {"p1": _page("flex-1")}
        bound_header = (
            '<header class="h-16"><span data-value="booking" '
            'data-aggregate="count">顶栏</span></header>'
        )
        after = {"p1": _page("flex-1", header=bound_header)}
        fixed, restored = restore_shell_after_bind(after, before)
        assert restored == [], "只加了孔却被还原了——绑定被洗掉"
        assert 'data-value="booking"' in fixed["p1"]

    def test_原样没动的不碰(self):
        before = {"p1": _page("flex-1")}
        fixed, restored = restore_shell_after_bind(dict(before), before)
        assert restored == [] and fixed["p1"] == before["p1"]

    def test_同时改结构又加孔_按结构判(self):
        """边界：既动了结构又加了孔——结构优先，还原。
        代价是那个孔没了，但**错的版式比少一个孔严重**：
        版式错是用户一眼看见的，孔没了下一轮 bind 还能补。"""
        before = {"p1": _page("flex-1")}
        after = {
            "p1": _page(
                "flex-1",
                header='<header class="h-16"><b data-value="x">全新顶栏</b></header>',
            )
        }
        fixed, restored = restore_shell_after_bind(after, before)
        assert restored == ["p1.header"]
        assert "全新顶栏" not in fixed["p1"]

    def test_打孔前没有的页跳过(self):
        """bind 产出里多出一页时不该炸。"""
        fixed, restored = restore_shell_after_bind({"p9": _page("flex-1")}, {})
        assert restored == [] and "p9" in fixed
