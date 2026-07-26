""""数字不能编"生成侧强制哨兵（2026-07-26 修复）。

历史缺口：模块 docstring 自称"数字类内容必须挂 dataRef 指向真实数据"，但
代码从没执行过这条——LLM 把编造数字写进普通 text（不挂 dataRef）就一路
直达渲染原样显示。渲染侧的现算替换只覆盖挂了 aggregate 的节点，防"守规矩
的造假"不防"不守规矩的造假"。

修法（guardrails 声明式 validator 思路）：FreeformNode 校验器强制
"text 含数字 → 本节点必须挂 dataRef 聚合"，违规即校验错误回喂 reask。
"""

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.freeform_block import build_freeform_models

DATAMODEL = {
    "entities": [
        {
            "id": "order",
            "name": "订单",
            "fields": [
                {"id": "amount", "name": "金额", "type": "number"},
                {"id": "status", "name": "状态", "type": "enum", "options": ["new", "done"]},
            ],
        }
    ]
}


def _design():
    return build_freeform_models(DATAMODEL)


def test_bare_number_in_text_rejected():
    with pytest.raises(ValidationError, match="含数字"):
        _design().model_validate({"root": {"tag": "div", "text": "本月共处理 328 单"}})


def test_decimal_and_percent_rejected():
    with pytest.raises(ValidationError, match="含数字"):
        _design().model_validate({"root": {"tag": "span", "text": "增长 3.5%"}})


def test_nested_bare_number_rejected():
    """数字藏在深层子节点里同样拦截（校验器挂在每个节点上）。"""
    with pytest.raises(ValidationError, match="含数字"):
        _design().model_validate(
            {"root": {"tag": "div", "children": [
                {"tag": "p", "children": [{"tag": "strong", "text": "¥128,000"}]}
            ]}}
        )


def test_number_with_dataref_aggregate_passes():
    _design().model_validate(
        {"root": {"tag": "div", "text": "128",
                  "dataRef": {"entityRef": "order", "aggregate": "count"}}}
    )


def test_number_with_sum_aggregate_passes():
    _design().model_validate(
        {"root": {"tag": "div", "text": "0",
                  "dataRef": {"entityRef": "order", "aggregate": "sum:amount"}}}
    )


def test_dataref_without_aggregate_does_not_ground_numbers():
    """只挂 entityRef 不挂 aggregate 不算数字承诺（渲染端不会现算替换），
    text 里的数字仍然是编的——照拦。"""
    with pytest.raises(ValidationError, match="含数字"):
        _design().model_validate(
            {"root": {"tag": "div", "text": "共 42 条",
                      "dataRef": {"entityRef": "order"}}}
        )


def test_text_without_digits_passes():
    _design().model_validate({"root": {"tag": "div", "text": "订单总量概览"}})
    _design().model_validate({"root": {"tag": "div"}})
