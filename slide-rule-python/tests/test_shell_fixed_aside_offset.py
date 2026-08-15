"""固定侧栏不占位：内容区必须自己让位（2026-08-15 晚）。

## 真机形状：截图上侧栏整个压在表格上

社区药店那趟 p4（处方登记审计日志），交付页长这样——

    <body  class="flex h-screen overflow-hidden">     ← 横向 flex
    <aside class="w-64 … fixed h-full">               ← 却是 fixed，**不占位**
    <main  class="flex-1 flex flex-col min-w-0 …">    ← 没有左偏移

浏览器里量：`main.left = 0`，而 `aside.right = 256`。侧栏压在内容上，
「登记时间」「流水单号」两列被整个盖住。加回 `ml-64` 之后 `main.left = 256`，
跟侧栏右边界严丝合缝。

## ⚠ 判据当时全绿，因为它只查了一半

旧规则问的是「`<body>` 是不是横向 flex」，是就认定 flex 已经把内容区排在
侧栏右边了，于是**去掉**偏移。可 `fixed` 的侧栏根本不参与 flex 排布，
flex 不会给它留 256px——这一半旧判据里是空的：坏成那样，shellProblems
里一个字都没有。

真正该问的是**侧栏占不占位**（aside_out_of_flow），不是 body 长什么样。

## ⚠ 而这个 fixed 是 unify_shell 自己贴上去的

源页侧栏是 fixed，统一时整段复制给各页；各页的 `<main>` 却还写着它原来
那套侧栏形态下的偏移：

    p2/p3  main class="ml-64 …"    ← 本来就配 fixed 侧栏，正好
    p4     main class="flex-1 …"   ← 本来配的是流内侧栏，现在没人占位了

**壳统一了，承载它的那一层没跟着对齐**——只修一半的经典形状。
所以 reconcile_main_offset 两个方向都做：该带的补上，多余的去掉。

⚠ 这是同一处第四次返工（抄整段 class → 只删偏移 → 只删不补 → 两个方向）。
  前三次都是「拿一批数据推的规则套到另一批上」，这次是**规则本身只覆盖
  了一半的输入空间**，而没覆盖的那一半在判据里是静默的。
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.page_shell import (  # noqa: E402
    aside_offset_token,
    aside_out_of_flow,
    check_shell_consistency,
    main_offset_tokens,
    reconcile_main_offset,
    strip_main_offset,
    unify_shell,
)

SPEC = {"pages": [{"id": "p1", "name": "甲页"}, {"id": "p2", "name": "乙页"}]}


def _page(*, body: str, aside: str, main: str) -> str:
    return (
        f'<!doctype html><html><head></head><body class="{body}">'
        f'<aside class="{aside}"><nav>'
        '<a data-page-id="p1" aria-current="page"><span>甲页</span></a>'
        '<a data-page-id="p2"><span>乙页</span></a>'
        "</nav></aside>"
        '<header class="h-16"><nav aria-label="Breadcrumb"><ol>'
        '<li><a href="/">库存管理</a></li>'
        '<li><a aria-current="page">甲页</a></li></ol></nav></header>'
        f'<main class="{main}"><div>正文</div></main></body></html>'
    )


#: 真机 p4 的形状：横向 flex + fixed 侧栏 + 无偏移内容区 → 压穿
P4 = _page(body="flex h-screen overflow-hidden",
           aside="w-64 bg-white border-r fixed h-full",
           main="flex-1 flex flex-col min-w-0 overflow-hidden")

#: 真机 p2 的形状：普通 body + fixed 侧栏 + ml-64 → 正确
P2 = _page(body="bg-gray-50 text-gray-800",
           aside="w-64 bg-white border-r fixed h-full",
           main="ml-64 min-h-screen")

#: 流内侧栏 + 横向 flex + 还带偏移 → 偏移两次（旧判据抓的那种）
DOUBLE = _page(body="flex h-screen",
               aside="w-64 bg-white border-r flex flex-col",
               main="ml-64 flex-1")


def _mains(pp):
    return [p for p in pp if p["path"].endswith(".main")]


class Test判据两个方向都要有:
    def test_fixed侧栏没让位_要报(self):
        """★ 真机 p4。旧判据这一半是空的。"""
        probs = _mains(check_shell_consistency({"p1": P4, "p2": P4}, SPEC))
        assert probs, "fixed 侧栏压穿内容区，判据一个字都没说"
        assert "压在侧栏底下" in probs[0]["message"]

    def test_fixed侧栏让了位_不报(self):
        assert not _mains(check_shell_consistency({"p1": P2, "p2": P2}, SPEC))

    def test_流内侧栏叠偏移_照旧报(self):
        """⚠ 老那条不能被这次改动吃掉：真机上出过「整屏右移 256px」。"""
        probs = _mains(check_shell_consistency({"p1": DOUBLE, "p2": DOUBLE}, SPEC))
        assert probs and "偏移了两次" in probs[0]["message"]

    def test_流内侧栏没偏移_不报(self):
        ok = _page(body="flex h-screen", aside="w-64 border-r flex flex-col", main="flex-1")
        assert not _mains(check_shell_consistency({"p1": ok, "p2": ok}, SPEC))

    def test_没有侧栏就不管(self):
        """⚠ 没 aside 的版式（移动端、单栏页）不该被这条碰。"""
        h = ('<!doctype html><html><head></head><body class="flex">'
             '<main class="flex-1"><div>正文</div></main></body></html>')
        assert not _mains(check_shell_consistency({"p1": h, "p2": h}, SPEC))


class Test判定侧栏占不占位:
    @pytest.mark.parametrize("cls,out", [
        ("w-64 fixed h-full", True),
        ("w-64 absolute inset-y-0", True),
        ("w-64 flex flex-col", False),
        ("w-64 border-r", False),
    ])
    def test_fixed和absolute都算脱离文档流(self, cls, out):
        assert aside_out_of_flow(_page(body="flex", aside=cls, main="flex-1")) is out

    @pytest.mark.parametrize("cls,want", [
        ("w-64 fixed", "ml-64"),
        ("w-72 fixed", "ml-72"),
        ("w-[248px] fixed", "ml-[248px]"),
    ])
    def test_偏移跟着侧栏宽度走(self, cls, want):
        assert aside_offset_token(_page(body="flex", aside=cls, main="flex-1")) == want

    def test_宽度认不出来就不猜(self):
        """⚠ 猜错的偏移跟没有偏移一样是坏版式，而且更难查。"""
        assert aside_offset_token(_page(body="flex", aside="fixed h-full", main="flex-1")) is None


class Test两个方向都补:
    def test_补上缺的偏移(self):
        """★ 修真机 p4 的那一下。浏览器里验过：加回 ml-64 后
        main.left = 256 = aside.right，严丝合缝。"""
        out = reconcile_main_offset(P4)
        assert main_offset_tokens(out) == ["ml-64"]
        assert "flex-1 flex flex-col min-w-0 overflow-hidden" in out, "把人家自己的版式动了"

    def test_已经有偏移就不动(self):
        assert reconcile_main_offset(P2) == P2

    def test_去掉多余的偏移(self):
        assert main_offset_tokens(reconcile_main_offset(DOUBLE)) == []

    def test_宽度认不出来时不塞(self):
        h = _page(body="flex", aside="fixed h-full", main="flex-1")
        assert reconcile_main_offset(h) == h

    def test_strip不许再动fixed那种(self):
        """⚠ **回归闸**：strip_main_offset 是上一版的修法，
        它看到 body 有 flex 就删偏移。fixed 侧栏那种一删就穿。"""
        assert strip_main_offset(P2) == P2
        p4_with = reconcile_main_offset(P4)
        assert strip_main_offset(p4_with) == p4_with


class Test统一外壳时成对处理:
    def test_源页fixed侧栏灌给流内布局的页_内容区跟着让位(self):
        """★ **这条最贴近真机病根**。

        unify_shell 把源页的 aside 整段复制过去，**连定位方式一起**。
        目标页原本配的是流内侧栏（body flex + main flex-1，不带偏移），
        换成 fixed 之后就没人占位了——承载层必须跟着对齐。
        """
        src = _page(body="bg-gray-50", aside="w-64 border-r fixed h-full", main="ml-64 min-h-screen")
        tgt = _page(body="flex h-screen", aside="w-64 border-r flex flex-col",
                    main="flex-1 flex flex-col min-w-0")
        out = unify_shell({"p1": src, "p2": tgt}, SPEC)["pages"]
        assert aside_out_of_flow(out["p2"]), "侧栏没被统一成 fixed，这条用例的前提没了"
        assert main_offset_tokens(out["p2"]) == ["ml-64"], (
            "统一后侧栏变成 fixed，内容区却没让位——会被压在底下"
        )

    def test_统一之后判据干净(self):
        src = _page(body="bg-gray-50", aside="w-64 border-r fixed h-full", main="ml-64 min-h-screen")
        tgt = _page(body="flex h-screen", aside="w-64 border-r flex flex-col", main="flex-1")
        out = unify_shell({"p1": src, "p2": tgt}, SPEC)["pages"]
        assert not _mains(check_shell_consistency(out, SPEC))

    def test_源页流内侧栏时_多余偏移照旧被去掉(self):
        """反方向也要经过 unify_shell 验一遍——两个方向共用一个函数，
        只验一边的话另一边坏了也不会红。"""
        src = _page(body="flex h-screen", aside="w-64 border-r flex flex-col", main="flex-1")
        tgt = _page(body="flex h-screen", aside="w-64 border-r flex flex-col", main="ml-64 flex-1")
        out = unify_shell({"p1": src, "p2": tgt}, SPEC)["pages"]
        assert main_offset_tokens(out["p2"]) == []


class Test打孔之后还要再对齐一次:
    """★ 律所那趟量出来的（2026-08-15 晚，4 页里 2 页坏）。

    第 3.5 步 unify_shell 已经对齐过偏移，但 bind 是**让 LLM 重写整页**，
    它会把 <main> 上的 ml-64 一起改掉；而 restore_shell_after_bind 只管
    <aside>/<header>，**不碰 main**——于是没有任何一处把偏移补回来。

        p2/p3  main class="ml-64 …"   ← bind 留着了
        p1/p4  main class="…"         ← bind 吃掉了

    判据当场报了 p1.main / p4.main，**报得对，但没人修**——一半页面会以
    侧栏压穿正文的样子交付，而那正是当天早些时候刚修过的形状。

    ⚠ 判据报了却没有对应的修复动作，等于把问题从"看不见"挪到"看得见但还在"。
    """

    def test_bind吃掉偏移后补回来(self):
        from services.page_shell import repair_pages_after_bind

        before = {"p1": P2}                      # 打孔前：fixed 侧栏 + ml-64
        after = {"p1": P4}                       # bind 后：同样的壳，但偏移没了
        fixed, _restored, reconciled = repair_pages_after_bind(after, before)
        assert reconciled == ["p1.main"]
        assert main_offset_tokens(fixed["p1"]) == ["ml-64"]

    def test_没被吃的不动(self):
        from services.page_shell import repair_pages_after_bind

        fixed, _r, reconciled = repair_pages_after_bind({"p1": P2}, {"p1": P2})
        assert reconciled == [] and fixed["p1"] == P2

    def test_还原壳的老行为没丢(self):
        """⚠ 新函数包着老函数，老那条纪律不能在包装里掉了：
        bind 改了结构就换回打孔前那份。"""
        from services.page_shell import repair_pages_after_bind

        broken = P2.replace('<a data-page-id="p2"><span>乙页</span></a>', "")
        _fixed, restored, _rec = repair_pages_after_bind({"p1": broken}, {"p1": P2})
        assert "p1.aside" in restored

    def test_先还原壳再算偏移(self):
        """⚠ 顺序要紧：偏移该不该有取决于**侧栏是不是 fixed**，而侧栏可能刚被
        换回打孔前那份。先算偏移就是拿旧侧栏做的判断。

        ⚠ 这条第一版构造错了，值得记：我只把侧栏的 class 从 fixed 改成流内，
          以为那算"壳被改了"。**不算**——shell_fingerprint 会把 class 整个
          抹成 `class=""`（它要抹掉的是激活态差异），于是**类名改动对还原
          判定是不可见的**。所以要触发还原，得有真正的结构差异。

          顺带记住这条本身：bind 把侧栏从 fixed 改成流内、只动类名的话，
          restore_shell_after_bind **不会**还原它——那时靠的是
          reconcile_main_offset 按 bind 后的侧栏重新算，结果依然是对的。
        """
        from services.page_shell import repair_pages_after_bind

        # 结构真的不一样（少了一个菜单项）+ 定位也变了
        after = _page(body="flex h-screen", aside="w-64 border-r flex flex-col",
                      main="flex-1 flex flex-col").replace(
            '<a data-page-id="p2"><span>乙页</span></a>', "")
        fixed, restored, reconciled = repair_pages_after_bind({"p1": after}, {"p1": P2})
        assert "p1.aside" in restored, "侧栏没被换回来，这条用例的前提没了"
        assert aside_out_of_flow(fixed["p1"]), "换回来的应该是 fixed 侧栏"
        assert reconciled == ["p1.main"], "换回 fixed 侧栏后没有补偏移"

    def test_链路里接的是新函数(self):
        import pathlib

        src = (pathlib.Path(__file__).resolve().parents[1]
               / "services/spec_first_pipeline.py").read_text(encoding="utf-8")
        assert "repair_pages_after_bind" in src
        assert "mainReconciled" in src, "没埋点，跑起来看不见它修了几处"
