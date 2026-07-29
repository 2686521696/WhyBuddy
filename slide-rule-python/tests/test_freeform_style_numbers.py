"""数字样式值补单位——别比 React 还严。

2026-07-28 真跑逮到的：模型写 `{"gap": 24, "padding": 16}`（数字），而
style 的类型标注是 dict[str, str]，Pydantic 在白名单校验之前就整批拒了，
一次 89 条错误、三次重试全耗在同一类问题上，最后整个 freeformOverview
生成失败、首页回落固定骨架。

React 本身接受数字：`style={{gap: 24}}` 渲染成 `gap: 24px`，只有一批
无单位属性原样输出（shared/CSSProperty.js 的 isUnitlessNumber）。渲染层
最终就是交给 React，判定标准跟它一致才不会出现"Pydantic 拒了但 React
其实画得出来"的错杀。
"""

import pytest

from services.freeform_block import build_freeform_models

DATAMODEL = {"entities": [{"id": "e", "name": "E", "fields": []}]}


def _validate(style):
    model = build_freeform_models(DATAMODEL)
    design = model.model_validate(
        {"root": {"tag": "div", "style": style, "children": []}}
    )
    return design.root.style


def test_length_numbers_get_px():
    """长度类数字补 px——跟 React 的默认行为一致。"""
    out = _validate({"gap": 24, "padding": 16, "borderRadius": 8, "width": 44})
    assert out == {"gap": "24px", "padding": "16px", "borderRadius": "8px", "width": "44px"}


def test_unitless_props_stay_bare():
    """无单位属性原样输出——补了 px 反而是坏值（flexGrow: 1px 无意义）。"""
    out = _validate({"flexGrow": 1, "fontWeight": 600, "opacity": 0.5, "zIndex": 3, "lineHeight": 1.5})
    assert out == {
        "flexGrow": "1",
        "fontWeight": "600",
        "opacity": "0.5",
        "zIndex": "3",
        "lineHeight": "1.5",
    }


def test_strings_pass_through_untouched():
    """已经是字符串的一律不碰——不能把 '13px' 变成 '13pxpx'。"""
    style = {"fontSize": "13px", "color": "#333", "margin": "0 auto", "display": "flex"}
    assert _validate(style) == style


def test_integral_floats_do_not_grow_a_tail():
    """24.0 要出 '24px' 而不是 '24.0px'——模型偶尔把整数写成浮点。"""
    assert _validate({"gap": 24.0}) == {"gap": "24px"}


def test_booleans_are_not_numbers():
    """bool 在 Python 里是 int 的子类，不能被当数字补 px（True → '1px' 是胡来）。
    这里让它照旧走类型校验被拒，而不是被静默"修"成一个合法值。"""
    with pytest.raises(Exception):
        _validate({"gap": True})


def test_safety_boundary_unchanged():
    """补单位只做数字→字符串这一步，白名单和危险值拦截原样生效。"""
    with pytest.raises(Exception):
        _validate({"animation": 3})  # 不在允许的 style 属性名单里
    with pytest.raises(Exception):
        _validate({"background": "url(http://evil/x.png)"})
