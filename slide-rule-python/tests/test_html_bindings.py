"""第 6.5 步：给第 3 步的 HTML 打 data-* 绑定孔（2026-08-13）。

判据分三层，每层守一件不同的事：

  · check_bindings   每个孔都指到真东西，且 data-field 在所在列表的作用域内
  · check_coverage   整页至少有一个数据源 —— 守"一个孔都没打也能全绿"那个洞
  · 版式不许被毁     只加属性、不动 class 和文案
"""

from __future__ import annotations

from services.html_bindings import (
    ACTION_KINDS,
    build_prompt,
    check_bindings,
    check_coverage,
    scan_bindings,
)

MODEL = {
    "datamodel": {"entities": [
        {"id": "vehicle", "name": "车辆", "fields": [
            {"id": "plate", "name": "车牌", "type": "string"},
            {"id": "price", "name": "评估价", "type": "number"},
            {"id": "status", "name": "状态", "type": "enum"}]},
        {"id": "customer", "name": "客户", "fields": [
            {"id": "cust_name", "name": "姓名", "type": "string"}]},
    ]}
}

GOOD = """<!DOCTYPE html><html lang="zh-CN"><head>
<script src="https://cdn.tailwindcss.com"></script></head><body>
<main>
  <span data-value="vehicle" data-aggregate="count">1,234</span>
  <div data-chart="donut" data-entity="vehicle" data-dimension="status" data-metric="count"></div>
  <table><tbody data-rows="vehicle" data-sort="price" data-order="desc" data-limit="8">
    <tr>
      <td data-field="plate">京A·XXXXX</td>
      <td data-field="price">¥ ××,×××</td>
      <td><button data-action="openRecord" data-entity="vehicle">查看</button></td>
    </tr>
  </tbody></table>
  <button data-action="createRecord" data-entity="vehicle">新建收车</button>
</main></body></html>"""


def 失败原因(html: str) -> str:
    probs = check_bindings(html, MODEL) + check_coverage(html, MODEL)
    assert probs, "这份该被拦下来，却过了"
    return "｜".join(p["message"] for p in probs)


class Test合法件:
    def test_零问题(self):
        assert check_bindings(GOOD, MODEL) == []
        assert check_coverage(GOOD, MODEL) == []

    def test_扫得出全部绑定(self):
        kinds = {k for n in scan_bindings(GOOD) for k in n["attrs"]
                 if k in ("rows", "field", "value", "chart", "action")}
        assert kinds == {"rows", "field", "value", "chart", "action"}


class Test作用域_不只是存在性:
    """data-field 光"是个真字段"不够，必须是所在 data-rows 那个实体的字段。"""

    def test_拦_取了别的实体的字段(self):
        # cust_name 是真字段，但它属于 customer，而这一行是 vehicle
        bad = GOOD.replace('data-field="plate"', 'data-field="cust_name"')
        assert "不是 'vehicle' 的字段" in 失败原因(bad)

    def test_拦_data_field_写在列表外面(self):
        bad = GOOD.replace("<main>", '<main><span data-field="plate">X</span>')
        assert "没有「当前行」" in 失败原因(bad)

    def test_嵌套标签内也能算出作用域(self):
        nested = GOOD.replace(
            '<td data-field="plate">京A·XXXXX</td>',
            '<td><div><span data-field="plate">京A·XXXXX</span></div></td>')
        assert check_bindings(nested, MODEL) == []

    def test_闭合之后作用域要弹掉(self):
        after = GOOD.replace("</main>", '<span data-field="plate">跑到外面了</span></main>')
        assert "没有「当前行」" in 失败原因(after)


class Test每个孔都要指到真东西:
    def test_拦_实体是编的(self):
        assert "不存在" in 失败原因(GOOD.replace('data-rows="vehicle"', 'data-rows="ghost"'))

    def test_拦_字段是编的(self):
        assert "不是" in 失败原因(GOOD.replace('data-field="price"', 'data-field="幻觉"'))

    def test_拦_聚合词不在表里(self):
        assert "聚合只能是" in 失败原因(GOOD.replace('data-aggregate="count"', 'data-aggregate="median"'))

    def test_拦_图表维度不是该实体的字段(self):
        assert "维度" in 失败原因(GOOD.replace('data-dimension="status"', 'data-dimension="cust_name"'))

    def test_拦_动作不在三种里(self):
        assert "动作只能是" in 失败原因(GOOD.replace('data-action="openRecord"', 'data-action="delete"'))

    def test_拦_动作没写实体(self):
        bad = GOOD.replace('<button data-action="createRecord" data-entity="vehicle">',
                           '<button data-action="createRecord">')
        assert "不知道操作哪张表" in 失败原因(bad)

    def test_拦_openRecord_写在列表外(self):
        bad = GOOD.replace('<button data-action="createRecord" data-entity="vehicle">新建收车</button>',
                           '<button data-action="openRecord" data-entity="vehicle">查看</button>')
        assert "当前这一行" in 失败原因(bad)

    def test_createRecord_可以在列表外(self):
        # 它不需要当前行，页头那个"新建"就用它
        assert check_bindings(GOOD, MODEL) == []

    def test_动作词表跟自由树一字不差(self):
        """两处表达同一件事，词表分叉就是下一个对不齐的地方。

        ⚠ 走 AST 取，不 import：freeform_block 的 ActionRef 定义在函数内部
        （它的校验器要闭包 entities），import 不到。而拿字符串搜 "openRecord"
        又会命中注释和提示词正文——判据必须钉在**真实语句**上。
        """
        import ast
        import pathlib

        src = (pathlib.Path(__file__).resolve().parent.parent
               / "services" / "freeform_block.py").read_text(encoding="utf-8")
        found = None
        for node in ast.walk(ast.parse(src)):
            if not (isinstance(node, ast.ClassDef) and node.name == "ActionRef"):
                continue
            for stmt in node.body:
                if (isinstance(stmt, ast.AnnAssign)
                        and getattr(stmt.target, "id", None) == "kind"):
                    found = {
                        s.value for s in ast.walk(stmt.annotation)
                        if isinstance(s, ast.Constant) and isinstance(s.value, str)
                    }
        assert found is not None, "freeform_block 里找不到 ActionRef.kind 了"
        assert found == set(ACTION_KINDS), f"两处词表分叉了：自由树 {found} vs HTML {set(ACTION_KINDS)}"


class Test一个孔都没打也要被拦:
    """⚠ 守今天反复出现的那个形状：闸全绿、东西没做。

    一份没打孔的 HTML，check_bindings 返回**空列表**——没有绑定就没有错误的
    绑定，看起来完美通过。所以另立一条 check_coverage。
    """

    def test_没打孔时_check_bindings_是空的(self):
        plain = "<html><body><main><table><tr><td>写死的</td></tr></table></main></body></html>"
        assert check_bindings(plain, MODEL) == [], "这正是问题所在，不是笔误"

    def test_但_check_coverage_拦得住(self):
        plain = "<html><body><main><table><tr><td>写死的</td></tr></table></main></body></html>"
        assert "还是死的静态页" in 失败原因(plain)

    def test_只有_field_和_action_没有数据源也拦(self):
        没数据源 = ('<html><body><main><table><tr>'
                    '<td data-field="plate">X</td></tr></table></main></body></html>')
        assert "取不到数" in 失败原因(没数据源)


class Test提示词:
    def test_把实体字段全摊开_并禁止新造(self):
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "vehicle" in user and "plate" in user and "评估价" in user
        assert "一个都不许新造" in user

    def test_明说版式不许动(self):
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "不增删元素" in user and "不动 class" in user

    def test_把作用域那条写进去(self):
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "只能是所在 data-rows 那个实体的字段" in user

    def test_挑不到就不绑_不要造(self):
        user = build_prompt(GOOD, MODEL, "p1")[-1]["content"]
        assert "不要造一个看着像的 id" in user

    def test_校验器原话回喂(self):
        user = build_prompt(GOOD, MODEL, "p1", "某某字段不是 vehicle 的字段")[-1]["content"]
        assert "某某字段不是 vehicle 的字段" in user and "只改这些地方" in user
