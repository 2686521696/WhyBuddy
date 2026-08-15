"""单条记录作用域：`data-record`（2026-08-15）。

## 真机形状

烘焙那趟（gemini-3.5-flash）bind 挂了一页，重问 2 次都没改对：

    <h4 data-field=product_ref>：写在 data-rows 容器外面——没有「当前行」
    <strong data-field=stock_qty>：写在 data-rows 容器外面

那是 p1 右侧的「多因子自修正算法分析」面板——**主从视图的详情侧**，
展示当前选中商品的名称、库存、推荐值。

## ⚠ 病根是契约缺了原语，不是模型不会写

原来的词汇只有：

    data-rows   列表（**迭代 + 作用域**焊在一起）
    data-value  聚合数字

**「显示单条记录的某个字段」压根没有对应的词。** 详情卡是后台最常见的版式
之一，而模型能用的字段级动词只有 data-field 一个，它只能那么写。
重问两次不改，是因为它没有别的可选。

## 照 petite-vue 的 v-scope 做，不自创

拉到本地读过（scratchpad/oss/petite-vue）：它的 `v-scope` 和 `v-for`
走的是**同一个** `createScopedContext(ctx, data)`——

    walk.ts:44   ctx = createScopedContext(ctx, scope)        // v-scope
    for.ts:105   const childCtx = createScopedContext(ctx, data)  // v-for

而读字段的指令（v-text / :bind）**根本不关心作用域是循环建的还是 scope 建的**。
Alpine 的 `x-data` / `x-for` 同构。

所以我们也保持 `data-field` **一个词**，不另造 `data-record-field`——
词表分叉就是下一个对不齐的地方（本仓在动作词表上踩过）。
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.html_bindings import check_bindings, scan_bindings  # noqa: E402

MODEL = {
    "datamodel": {
        "entities": [
            {"id": "product", "name": "商品",
             "fields": [{"id": "name"}, {"id": "stock_qty"}, {"id": "price"}]},
            {"id": "store", "name": "门店", "fields": [{"id": "title"}]},
        ]
    }
}


def _paths(problems):
    return [p["path"] for p in problems]


class Test单条记录开作用域:
    def test_data_record_里的字段合法(self):
        """★ 真机挂的那个形状，现在应该过。"""
        html = (
            '<div data-record="product">'
            '<h4 data-field="name">示例</h4>'
            '<strong data-field="stock_qty">0</strong>'
            "</div>"
        )
        assert check_bindings(html, MODEL) == []

    def test_两个作用域都不在_照旧报错(self):
        """⚠ 反向：放开 data-record 不等于放开"哪儿都能写 data-field"。
        没有作用域就是没有"当前这条"，取不到东西。"""
        html = '<div><h4 data-field="name">示例</h4></div>'
        probs = check_bindings(html, MODEL)
        assert probs and "作用域外面" in probs[0]["message"]

    def test_报错话术要指路(self):
        """判据报了错还得告诉人怎么改——不然模型重问两次还是原样。
        真机那次的报错只说「写在 data-rows 外面」，而它要的根本不是 rows。"""
        probs = check_bindings('<h4 data-field="name">x</h4>', MODEL)
        msg = probs[0]["message"]
        assert "data-rows" in msg and "data-record" in msg

    def test_字段必须属于开作用域的实体(self):
        """⚠ 跟行内同一条纪律：拿商品的作用域去取门店的字段，
        字段是真的，取出来是别人的数据。"""
        html = '<div data-record="product"><h4 data-field="title">x</h4></div>'
        probs = check_bindings(html, MODEL)
        assert probs and "不是 'product' 的字段" in probs[0]["message"]

    def test_实体不存在要报(self):
        html = '<div data-record="nope"><h4 data-field="name">x</h4></div>'
        assert check_bindings(html, MODEL)


class Test作用域嵌套:
    def test_行内套记录_内层赢(self):
        """petite-vue 用原型链让内层作用域覆盖外层。这里验同样的方向：
        data-record 在 data-rows 里面时，字段按 data-record 的实体判。"""
        html = (
            '<tbody data-rows="store">'
            '<tr><td data-field="title">x</td>'
            '<div data-record="product"><span data-field="stock_qty">0</span></div>'
            "</tr></tbody>"
        )
        assert check_bindings(html, MODEL) == []

    def test_记录套行内_也认(self):
        html = (
            '<div data-record="store"><h4 data-field="title">x</h4>'
            '<tbody data-rows="product"><tr><td data-field="price">0</td></tr></tbody>'
            "</div>"
        )
        assert check_bindings(html, MODEL) == []

    def test_scan_把_record_当作用域(self):
        nodes = scan_bindings('<div data-record="product"><h4 data-field="name">x</h4></div>')
        field_node = next(n for n in nodes if "field" in n["attrs"])
        assert field_node["scope"] == "product"


class Test词表跨语言同步_绑定属性:
    """⚠ **本文件最要紧的一条**。

    前端 `BINDING_ATTRS` 是消毒白名单的唯一来源，而消毒用的是
    `ALLOW_DATA_ATTR: false`——**没列进去的 data-* 会被静默删掉**。
    删掉之后页面照常渲染、消毒器照常报成功、解释器 problems 也是空的
    （没有孔就没有错误的孔），**那个能力整条无声消失**。

    所以 Python 侧认得的每个属性，前端白名单里必须都有。
    """

    def _frontend_attrs(self) -> set:
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[2] / "client"
        src = (root / "src/pages/sliderule/live-runtime/html-binding-runtime.ts").read_text(
            encoding="utf-8"
        )
        m = re.search(r"export const BINDING_ATTRS = \[(.*?)\] as const", src, re.S)
        assert m, "前端找不到 BINDING_ATTRS 数组了"
        return set(re.findall(r'"(data-[a-z-]+)"', m.group(1)))

    @pytest.mark.parametrize("attr", ["data-record", "data-record-id"])
    def test_新词必须进前端白名单(self, attr):
        assert attr in self._frontend_attrs(), (
            f"{attr} 不在前端 BINDING_ATTRS 里——消毒器会把它静默删掉，"
            f"详情卡的绑定整条无声消失"
        )

    def test_python_认得的属性前端都放行(self):
        """钉在**真实源码**上：从 scan_bindings 那行 any(...) 里抠出它认的键，
        逐个查前端白名单。加词只改两处，漏一处这里就红。"""
        import pathlib

        py = pathlib.Path(__file__).resolve().parents[1] / "services/html_bindings.py"
        src = py.read_text(encoding="utf-8")
        m = re.search(r'if any\(k in attrs for k in \(([^)]*)\)\)', src)
        assert m, "scan_bindings 里那行 any(...) 找不到了"
        keys = re.findall(r'"([a-z]+)"', m.group(1))
        assert "record" in keys, "scan_bindings 还没认 data-record"
        front = self._frontend_attrs()
        missing = [k for k in keys if f"data-{k}" not in front]
        assert not missing, f"这些属性 Python 认、前端会删：{missing}"
