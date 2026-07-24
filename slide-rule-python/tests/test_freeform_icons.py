"""放开 FreeformInsight 图标白名单（2026-07-24）后的校验覆盖。

之前 iconRef 只能在一个手维护的 12 图标集合里，真机撞到"订单销售额配了
trending-up、补货任务配了 alert-triangle"这种语义错配——图标词汇太少，
LLM 只能拿最接近的凑合。放开后：任何合法的 Ant Design 图标组件名
（PascalCase + Outlined/Filled/TwoTone 结尾）都放行，老 kebab 别名兼容，
编造/拼错/原型链名字被形状正则挡掉。
"""

import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.freeform_block import build_freeform_models  # noqa: E402


def _model():
    return build_freeform_models(
        {"entities": [{"id": "t", "name": "T", "fields": [{"id": "a", "name": "A", "type": "number"}]}]}
    )


def _validate_icon(icon: str):
    _model().model_validate({"root": {"tag": "div", "iconRef": icon}})


@pytest.mark.parametrize(
    "icon",
    [
        "WalletOutlined", "ShoppingCartOutlined", "PieChartOutlined", "DollarOutlined",
        "InboxOutlined", "BarChartFilled", "SmileTwoTone",  # 任意 Ant Design 图标名
        "check-circle", "trending-up", "alert-triangle",     # 老 kebab 别名兼容
    ],
)
def test_valid_icon_names_accepted(icon):
    _validate_icon(icon)  # 不抛即通过


@pytest.mark.parametrize(
    "icon",
    [
        "NotARealIcon",        # 不以 Outlined/Filled/TwoTone 结尾
        "wallet",              # 小写开头
        "Wallet",              # PascalCase 但缺后缀
        "__proto__",           # 原型链名
        "constructor",
        "getTwoToneColor",     # @ant-design/icons 的非图标工具导出
        "",                    # 空串
    ],
)
def test_invalid_icon_names_rejected(icon):
    with pytest.raises(ValidationError):
        _validate_icon(icon)


def test_icon_ref_optional():
    # 不写 iconRef 仍然合法（纯装饰节点不强制配图标）
    _model().model_validate({"root": {"tag": "div", "text": "x"}})
