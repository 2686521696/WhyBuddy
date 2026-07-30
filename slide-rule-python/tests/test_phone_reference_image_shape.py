"""手机档参照图的画布形状（2026-07-30）。

起因：`_DEVICE_IMAGE_SIZE["phone"]` 填的是 "1024x1792"，注释写着"手机该是
竖屏"——那句是错的，而且错得很安静。活体探针（四个竖版尺寸逐个真发一轮）
测出这个生图端点**根本不返回竖图**：

    1024x1792 → 1254x1254    1024x1536 → 1254x1254
    1536x2048 → 1254x1254    2160x3840 → 1254x1254

四个不同长宽比、不同像素量的竖版请求收敛到同一张方图，说明服务端按档位重排，
不是"传什么给什么"。于是过去每次手机档生图：代码以为拿到 9:16 竖图、prompt
也照着竖屏写（"比例偏竖长"/"整体竖屏比例"），实际拿到的是 1:1 方图，而 prompt
里还跟着一句"充分利用整个画布/边缘到边缘"——两句合起来把模型引向"把手机界面
横向摊开填满方画布"，画出来的正是手机上不可能有的比例。参照图形状错了不会报
错，只会让设计 LLM 静默学到错的比例。

这组测试钉住修复后的三件事：请求的尺寸与拿到的形状一致（如实要方图）、手机档
prompt 不再自称竖屏、以及"铺满画布"那句不对手机档说。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.freeform_block import (
    _DEVICE_IMAGE_SIZE,
    _build_reference_image_prompt,
    _image_size_for_device,
)
from services.identity_theme_gen import (
    _build_reference_image_prompt as _build_identity_reference_image_prompt,
)

_EMPTY_DATAMODEL: dict = {"entities": []}


def test_phone_requests_a_square_canvas_not_a_portrait_one():
    """如实请求方图。传竖版尺寸也只会收到 1254x1254，那就别传竖版——
    请求与产出一致，下一个读代码的人才不会再被"手机该是竖屏"骗一次。"""
    size = _image_size_for_device("phone")
    w, h = (int(x) for x in size.split("x"))
    assert w == h, f"手机档应请求方形画布（端点给不了竖图），实际请求 {size}"
    # 桌面档仍是宽屏——这条修复不该把宽屏档也一起改方了。
    dw, dh = (int(x) for x in _image_size_for_device("desktop").split("x"))
    assert dw > dh, "桌面档必须仍是宽屏"


def test_phone_canvas_matches_the_desktop_pixel_tier():
    """两档参照图清晰度要同一水平，否则一档字清楚一档字糊。

    1792x1024 实收 1672x941 ≈ 1.57MP；1024x1024 实收 1254x1254 ≈ 1.57MP。
    （"2048x2048" 会跳到 4.2MP 的更贵档位，没必要。）
    """
    assert _DEVICE_IMAGE_SIZE["phone"] == "1024x1024"


def test_phone_block_prompt_does_not_claim_portrait_and_does_not_say_fill_the_canvas():
    """手机档 prompt 不能再自称竖屏，也不能说"边缘到边缘铺满画布"。"""
    prompt = _build_reference_image_prompt(
        "测试区块", _EMPTY_DATAMODEL, theme_id="tangerine", device="phone"
    )
    assert "比例偏竖长" not in prompt, "画布是方的，不能再说内容比例偏竖长"
    assert "边缘到边缘" not in prompt, "方画布上说铺满会把手机内容横向摊开"
    assert "正方形" in prompt, "该明说画布是方的，模型才知道要留左右背景"
    assert "居中的竖向窄栏" in prompt, "手机内容区是窄的，要画成居中窄栏"


def test_desktop_block_prompt_still_fills_the_canvas():
    """宽幅档不受影响——这条修复只针对手机档那个形状错配。"""
    prompt = _build_reference_image_prompt(
        "测试区块", _EMPTY_DATAMODEL, theme_id="tangerine", device="desktop"
    )
    assert "边缘到边缘" in prompt
    assert "居中的竖向窄栏" not in prompt


def test_identity_phone_prompt_does_not_claim_portrait_either():
    """身份主题参照图走的是同一个 _image_size_for_device，同一个坑要一起堵。"""
    prompt = _build_identity_reference_image_prompt("测试应用", "产品目标", "数据领域", "phone")
    assert "整体竖屏比例" not in prompt, "画布是方的，不能再说整体竖屏比例"
    assert "边缘到边缘" not in prompt
    assert "居中的一条竖栏" in prompt


def test_identity_desktop_prompt_still_fills_the_canvas():
    prompt = _build_identity_reference_image_prompt("测试应用", "产品目标", "数据领域", "desktop")
    assert "边缘到边缘" in prompt
    assert "居中的一条竖栏" not in prompt
