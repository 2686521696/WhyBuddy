"""第 3.5 步：多页 HTML 的外壳统一（2026-08-13）。

## 病灶（实测，不是设想）

第 3 步逐页独立生成，每页各自发明导航/侧栏/Header。同一份 spec 的三页：

    p1  智维工单       李师傅 · 维修一组 · 维修工   6 项菜单
    p2  维保云         李主管 · 维修主管            6 项菜单
    p3  智维运维平台    李晓雯 · 行政部 · 普通员工   11 项菜单

三个产品名、三个登录人、三套菜单，而且 p3 的菜单列了 8 个页面入口，
spec 里只有 3 页——它凭空发明了 5 个不存在的页面。

## 这份用例守两头

  · 统一之后各页必须是同一套壳、导航恰好等于 spec 的页面清单
  · **判据自己不许误判**——第一版拿原文逐字节比 aside，对着真实产物报
    「3 种不同」，查下来唯一差别是哪一项带 aria-current（那正是每页应该
    不同的地方）。对正确行为报警的闸比没有闸更糟，它会训练人忽略它。
"""

from __future__ import annotations

import pytest

from services.page_shell import (
    PageShellError,
    build_nav_items,
    check_shell_consistency,
    extract_shell,
    nav_templates,
    shell_fingerprint,
    unify_shell,
)


def page(brand: str, user: str, items: list[str], body: str = "<p>正文</p>") -> str:
    links = "\n".join(
        f'<a class="nav-item flex gap-3{" nav-active" if i == 0 else ""}" href="#">'
        f'<svg class="icon{i}"><path d="M{i}"/></svg><span>{t}</span></a>'
        for i, t in enumerate(items)
    )
    return f"""<!DOCTYPE html><html lang="zh-CN"><body>
<aside class="w-56"><div class="brand">{brand}</div><nav>{links}</nav>
  <div class="user">{user}</div></aside>
<header class="h-14"><span>{brand} · 顶栏</span></header>
<main class="p-6">{body}</main></body></html>"""


PAGES = {
    "p1": page("智维工单", "李师傅 · 维修工", ["工作台首页", "我的工单", "全部报修"], "<p>列表</p>"),
    "p2": page("维保云", "李主管 · 维修主管", ["工作台", "工单中心", "维修人员", "数据报表"], "<p>详情</p>"),
    "p3": page("智维运维平台", "李晓雯 · 普通员工",
               ["首页", "新建报修", "我的工单", "全部工单", "设备台账"], "<p>表单</p>"),
}

SPEC = {
    "pages": [
        {"id": "p1", "name": "工单工作台首页"},
        {"id": "p2", "name": "工单详情页"},
        {"id": "p3", "name": "新建报修页"},
    ]
}


class Test病灶还在的时候判据要报出来:
    def test_统一前报出三类问题(self):
        probs = check_shell_consistency(PAGES, SPEC)
        paths = {p["path"] for p in probs}
        assert "aside" in paths and "header" in paths
        assert {"p1.nav", "p2.nav", "p3.nav"} <= paths

    def test_报得出导航项跟_spec_对不上(self):
        msgs = " ".join(p["message"] for p in check_shell_consistency(PAGES, SPEC))
        assert "工单工作台首页" in msgs, "报错要说清 spec 期望的是什么，不然没法改"


class Test统一之后干净:
    def test_零问题(self):
        out = unify_shell(PAGES, SPEC)
        assert check_shell_consistency(out["pages"], SPEC) == []

    def test_产品名与登录人收成一套(self):
        out = unify_shell(PAGES, SPEC)
        brands = {extract_shell(h)["aside"].split('brand">')[1].split("<")[0]
                  for h in out["pages"].values()}
        assert len(brands) == 1, f"还剩 {brands} 这些产品名"

    def test_导航项恰好是_spec_的页面清单(self):
        """不是照抄源页的菜单——源页 p3 有 5 项，其中 2 项 spec 里根本没有。

        照抄等于把「发明了不存在的页面」这个错误扩散到所有页上。
        """
        out = unify_shell(PAGES, SPEC)
        for html in out["pages"].values():
            for want in ("工单工作台首页", "工单详情页", "新建报修页"):
                assert want in html
            for invented in ("设备台账", "数据报表", "全部工单"):
                assert invented not in extract_shell(html)["aside"]

    def test_每页高亮自己那一项(self):
        out = unify_shell(PAGES, SPEC)
        for pid, html in out["pages"].items():
            aside = extract_shell(html)["aside"]
            assert aside.count('aria-current="page"') == 1
            # 当前页那一项的文案要对得上
            idx = [p["id"] for p in SPEC["pages"]].index(pid)
            name = SPEC["pages"][idx]["name"]
            seg = aside.split('aria-current="page"')[1].split("</a>")[0]
            assert name in seg

    def test_正文一个字没动(self):
        out = unify_shell(PAGES, SPEC)
        assert "<p>列表</p>" in out["pages"]["p1"]
        assert "<p>详情</p>" in out["pages"]["p2"]
        assert "<p>表单</p>" in out["pages"]["p3"]

    def test_选导航链接最多的那页当壳源(self):
        # 不是因为它更对（p3 恰恰发明了不存在的入口），是因为图标模板最多
        assert unify_shell(PAGES, SPEC)["sourcePageId"] == "p3"

    def test_图标按位置复用_不是全都同一个(self):
        out = unify_shell(PAGES, SPEC)
        aside = extract_shell(out["pages"]["p1"])["aside"]
        assert 'class="icon0"' in aside and 'class="icon1"' in aside


class Test判据自己不许误判:
    """第一版拿原文逐字节比 aside，对着真实产物报「3 种不同」——唯一差别是
    aria-current 落在哪一项，而那正是每页应该不同的地方。"""

    def test_只差当前页标记不算不一致(self):
        a = '<aside><nav><a aria-current="page" class="on">甲</a><a class="off">乙</a></nav></aside>'
        b = '<aside><nav><a class="off">甲</a><a aria-current="page" class="on">乙</a></nav></aside>'
        assert shell_fingerprint(a) == shell_fingerprint(b)

    def test_真不一样还是要认出来(self):
        a = '<aside><div>维保云</div></aside>'
        b = '<aside><div>智维工单</div></aside>'
        assert shell_fingerprint(a) != shell_fingerprint(b)

    def test_归一化抹平激活态之后_漏掉的那条要补上(self):
        """抹平了 aria-current，"一个都没标"和"标了三个"就会静静通过。

        所以另开一条判据查「恰好一个」——这条是第一版漏掉的，写在这里
        免得哪天有人觉得它多余。
        """
        none_marked = {
            "p1": '<html><body><aside><nav><a class="x"><span>工单工作台首页</span></a>'
                  '<a class="x"><span>工单详情页</span></a>'
                  '<a class="x"><span>新建报修页</span></a></nav></aside></body></html>'
        }
        probs = check_shell_consistency(none_marked, SPEC)
        assert any(p["path"].endswith("nav.current") for p in probs)
        assert "0 个" in " ".join(p["message"] for p in probs)


class Test激活态识别不写死类名:
    def test_按类名词集的差集认激活项(self):
        nav = ('<nav><a class="item base">甲</a>'
               '<a class="item base is-selected accent">乙</a>'
               '<a class="item base">丙</a></nav>')
        t = nav_templates(nav)
        assert t is not None
        # 三个都有的是基座，只有乙有的是激活标记——换任何命名都不用改代码
        assert "base" in t["base_class"] and "item" in t["base_class"]
        assert "is-selected" in t["active_class"] and "accent" in t["active_class"]
        assert "is-selected" not in t["base_class"]

    def test_基座取的是非激活那一个(self):
        nav = '<nav><a class="a on">甲</a><a class="a">乙</a></nav>'
        assert "on" not in nav_templates(nav)["link"]

    def test_链接不足两个时返回_None(self):
        # 一个链接判不出激活态，回落成"这一页不重排导航"，不硬猜
        assert nav_templates('<nav><a class="x">只有一个</a></nav>') is None
        assert nav_templates("<nav></nav>") is None

    def test_全都没有激活态时也不炸(self):
        t = nav_templates('<nav><a class="a">甲</a><a class="a">乙</a></nav>')
        assert t is not None and t["active_class"] == t["base_class"]


class Test失败路径:
    def test_没有页面直接抛(self):
        with pytest.raises(PageShellError):
            unify_shell({}, SPEC)

    def test_spec_没有页面清单直接抛(self):
        # 导航无从锚定时宁可不做，也不要退回"照抄某一页的菜单"
        with pytest.raises(PageShellError) as exc:
            unify_shell(PAGES, {"pages": []})
        assert "锚定" in str(exc.value)

    def test_源页没有壳直接抛(self):
        with pytest.raises(PageShellError) as exc:
            unify_shell({"p1": "<html><body><main>光板</main></body></html>"}, SPEC)
        assert "抠不出壳" in str(exc.value)

    def test_某一页没有壳时不会被塞坏(self):
        """有壳的页统一，没壳的页原样放过——不硬塞一个进去。

        向导页故意不放侧栏是合法设计，硬塞会把它变成另一种不一致。
        """
        mixed = dict(PAGES)
        mixed["p9"] = "<html><body><main>向导页没有侧栏</main></body></html>"
        out = unify_shell(mixed, SPEC)
        assert "向导页没有侧栏" in out["pages"]["p9"]
        assert "<aside" not in out["pages"]["p9"]


class Test产出形状:
    def test_带上溯源信息(self):
        out = unify_shell(PAGES, SPEC)
        assert out["version"] == "page-shell-v1"
        assert out["sourcePageId"] in PAGES
        assert out["navAnchored"] is True
        assert out["navItems"] == ["工单工作台首页", "工单详情页", "新建报修页"]

    def test_零_LLM_调用(self):
        """整条路径是确定性的。这条用例存在的意义是：哪天有人想"让模型
        帮忙挑一个最好的壳"，先看到这里——那会把一个确定性步骤变成有方差的。
        """
        import inspect

        import services.page_shell as mod

        src = inspect.getsource(mod)
        for banned in ("call_llm", "llm_json", "generate_"):
            assert banned not in src, f"page_shell 里出现了 {banned}，它该是零 LLM 的"


SPEC_WITH_IDENTITY = {
    **SPEC,
    "appName": "维保云",
    "personas": [{"id": "u1", "name": "维修主管", "goals": ["盯住未处理工单"]}],
}


class Test身份也按_spec_锚定:
    """产品名和登录角色原本是**从被选中那页继承**的——统一了，但仍然是模型编的。

    spec 契约补上 appName / personas 之后，这里要真的灌进去；不灌的话
    加字段等于没加。
    """

    def test_产品名换成_spec_的(self):
        out = unify_shell(PAGES, SPEC_WITH_IDENTITY)
        for html in out["pages"].values():
            aside = extract_shell(html)["aside"]
            assert "维保云" in aside
            # 源页是 p3（导航链接最多），它编的名字必须一处不剩
            assert "智维运维平台" not in aside

    def test_角色换成_spec_第一个_persona(self):
        out = unify_shell(PAGES, SPEC_WITH_IDENTITY)
        for html in out["pages"].values():
            assert "维修主管" in extract_shell(html)["aside"]
            assert "李晓雯 · 普通员工" not in extract_shell(html)["aside"]

    def test_Header_上的产品名也换(self):
        # 只换侧栏不换顶栏，会出现"侧栏新名字、顶栏旧名字"这种没人看得懂的中间态
        out = unify_shell(PAGES, SPEC_WITH_IDENTITY)
        for html in out["pages"].values():
            header = extract_shell(html)["header"]
            assert "维保云" in header and "智维运维平台" not in header

    def test_spec_没给身份时保持模型编的那套(self):
        """统一是本模块的职责，起名不是。spec 没给就不该由这里发明一个。"""
        out = unify_shell(PAGES, SPEC)
        brands = {extract_shell(h)["aside"].split('brand">')[1].split("<")[0]
                  for h in out["pages"].values()}
        assert brands == {"智维运维平台"}  # 仍然统一，只是名字来自源页

    def test_产出带上最终用的身份(self):
        out = unify_shell(PAGES, SPEC_WITH_IDENTITY)
        assert out["appName"] == "维保云"
        assert out["personaRole"] == "维修主管"

    def test_判据能抓到替换没落实(self):
        """detect_brand_and_role 是启发式（9/9 验过，但终究是启发式）。

        认错了不会自己喊，所以配一道硬校验：spec 的名字必须出现在每一页。
        这条用例就是拿"没换过的页"去撞它。
        """
        probs = check_shell_consistency(PAGES, SPEC_WITH_IDENTITY)
        assert any(p["path"].endswith(".appName") for p in probs)

    def test_统一后这道硬校验也过(self):
        out = unify_shell(PAGES, SPEC_WITH_IDENTITY)
        assert check_shell_consistency(out["pages"], SPEC_WITH_IDENTITY) == []


class Test身份替换与导航重排的先后顺序:
    def test_角色名正好是菜单项时_导航仍然重排(self):
        """⚠ 顺序坑：nav 必须在**身份替换之后**重新定位。

        先定位再替换的话，一旦角色名那几个字正好落在 nav 里，替换会改掉 nav
        的原文，后面拿旧 nav_match 去 replace 就匹配不上——**导航重排静默不
        发生**，而各页壳仍然一致、前两条判据照样绿。这种"闸全绿但功能没生效"
        的形状本仓踩过不止一次，所以单独钉一条。
        """
        # 让源页的菜单里就有「维修主管」这一项，替换必然会动到 nav 原文
        pages = dict(PAGES)
        pages["p3"] = page("智维运维平台", "李晓雯 · 普通员工",
                           ["首页", "维修主管", "我的工单", "全部工单", "设备台账"])
        spec = {
            **SPEC,
            "appName": "维保云",
            "personas": [{"id": "u1", "name": "维修主管", "goals": []}],
        }
        out = unify_shell(pages, spec)
        for pid, html in out["pages"].items():
            aside = extract_shell(html)["aside"]
            for want in ("工单工作台首页", "工单详情页", "新建报修页"):
                assert want in aside, f"{pid} 的导航没被重排——多半是踩了顺序坑"
            assert "设备台账" not in aside
