"""lineHeight 裸数字倍数校验（2026-07-30）。

真机逮到过：LLM 给一张 KPI 卡的大数字配 `"lineHeight": "32"`（字号是
28px），意图显然是"行高 32px"，但 lineHeight 不带单位时 CSS/React 都读成
"字号的倍数"——32 倍字号 = 896px 的行高，把一整行 KPI 卡撑到 1000+px，
下面的图表/活动列表全被挤到一屏之外。生成侧 Pydantic 校验器要拦住这个
模式，逼它重问；前端 sanitizeFreeformStyle 是第二道防线（历史产物/快照
恢复不走生成期校验）。
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
            "id": "member",
            "name": "会员",
            "fields": [{"id": "join_date", "name": "入会日期", "type": "date"}],
        }
    ]
}


def _design():
    return build_freeform_models(DATAMODEL)


def test_implausible_line_height_ratio_rejected():
    """真机事故复现：28px 字号配 lineHeight 32（意图是 32px，写漏了单位）。"""
    with pytest.raises(ValidationError, match="不带单位时表示字号的倍数"):
        _design().model_validate(
            {
                "root": {
                    "tag": "strong",
                    "style": {"fontSize": "28px", "lineHeight": "32"},
                    "text": "128",
                    "dataRef": {"entityRef": "member", "aggregate": "count"},
                }
            }
        )


def test_plausible_line_height_ratio_passes():
    """正常倍数（1~2 之间）必须放行，不能连带误杀。"""
    _design().model_validate(
        {
            "root": {
                "tag": "strong",
                "style": {"fontSize": "28px", "lineHeight": "1.4"},
                "text": "128",
                "dataRef": {"entityRef": "member", "aggregate": "count"},
            }
        }
    )


def test_line_height_with_px_unit_passes():
    """带单位的写法（'32px'）不是这条规则要拦的情况——float() 转不了就放行，
    交给上面的危险值正则和白名单去管，不在这里重复判定。"""
    _design().model_validate(
        {"root": {"tag": "strong", "style": {"lineHeight": "32px"}, "text": "订单概览"}}
    )


def test_boundary_ratio_passes():
    """阈值本身（4.0）不算超标——边界值放行，只拦真正超出的。"""
    _design().model_validate(
        {"root": {"tag": "strong", "style": {"lineHeight": "4"}, "text": "订单概览"}}
    )


def test_nested_bad_line_height_rejected():
    """深层子节点同样受校验（校验器挂在每个节点上）。"""
    with pytest.raises(ValidationError, match="不带单位时表示字号的倍数"):
        _design().model_validate(
            {
                "root": {
                    "tag": "div",
                    "children": [
                        {"tag": "div", "style": {"lineHeight": "10"}, "text": "订单概览"}
                    ],
                }
            }
        )
