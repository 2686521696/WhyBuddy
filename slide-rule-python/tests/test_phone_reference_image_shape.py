"""手机档参照图的画布形状（2026-07-30 起，2026-07-31 换端点后补记）。

⚠️ 先说当前事实：**当前端点（api.xiaoleai.team）逐像素认 size 参数**，手机档
传 720x1280 就实收 720x1280。下面这段是**上一个端点**的行为记录，留着是因为
它解释了 prompt 里那些竖屏措辞为什么存在、为什么不能删。

── 上一个端点（hello.vangularcode.asia）────────────────────────────

起因：`_DEVICE_IMAGE_SIZE["phone"]` 填 "1024x1792"、注释写着"手机该是竖屏"，
但真出图从来不是竖的。查下去发现那个端点有个不直觉的行为：

    **尺寸参数只决定像素预算档位，长宽比由提示词内容决定。**

探针过程本身值得记，因为中间得出过一个错结论：第一轮用一句没有形状线索的
中性提示词（"纯浅灰背景，正中一个大号数字 1"）测了四个竖版尺寸，全部回落成
1254x1254 方图，连 skill 包那套 {"image_size":"2K","aspect_ratio":"9:16"}
也一样（能通，但 aspect_ratio 被忽略）——据此一度判定"这个端点给不了竖图"。
**那是错的**：换成明说"生成一张手机 App 界面草样、手机竖屏比例"的提示词、
尺寸照样传 "1024x1024"，出图就是 864x1821 真竖图。错的是探针的提示词，
不是端点。

所以这组测试钉的是**提示词里那句竖屏措辞不能丢**——它是功能性的，不是描述
性的：删了就变回方图，而且不会报错，只会让设计 LLM 静默学到错的比例。
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


def test_phone_block_prompt_explicitly_asks_for_a_portrait_canvas():
    """手机档提示词必须**明说**竖屏——这是拿到竖图的唯一开关。

    此前只写"比例偏竖长"这种含糊说法，配上"充分利用整个画布"，模型就把内容
    横着摊开画成方图。要点名 9:16。
    """
    prompt = _build_reference_image_prompt(
        "测试区块", _EMPTY_DATAMODEL, theme_id="tangerine", device="phone"
    )
    assert "9:16" in prompt, "手机档必须点名 9:16，含糊说法拿不到竖图"
    assert "竖屏" in prompt
    assert "单列纵向" in prompt


def test_identity_phone_prompt_also_asks_for_a_portrait_canvas():
    """身份主题参照图走同一个端点、同一条规律，同一个开关不能漏。"""
    prompt = _build_identity_reference_image_prompt("测试应用", "产品目标", "数据领域", "phone")
    assert "9:16" in prompt
    assert "竖屏" in prompt


def test_desktop_prompts_do_not_ask_for_portrait():
    """宽幅档不能被带偏成竖图。"""
    block = _build_reference_image_prompt(
        "测试区块", _EMPTY_DATAMODEL, theme_id="tangerine", device="desktop"
    )
    identity = _build_identity_reference_image_prompt("测试应用", "产品目标", "数据领域", "desktop")
    for prompt in (block, identity):
        assert "9:16" not in prompt
        assert "竖屏" not in prompt
    assert "宽屏比例" in identity


def test_phone_size_param_now_carries_the_shape_too():
    """尺寸参数**在当前端点上是形状的第一来源**——手机档必须传竖版尺寸。

    2026-07-31 换到 api.xiaoleai.team 之后行为翻转了（实测记录见
    _DEVICE_IMAGE_SIZE 上方）：

      旧端点 hello.vangularcode.asia —— size 完全不起作用，十个尺寸/形态组合
        全部回 1672x941，形状**只能**靠 prompt 里那句竖屏措辞掰回来
      当前端点 api.xiaoleai.team —— 逐像素认 size：720x1280 → 实收 720x1280

    所以这条从"别指望改 size"改成了"size 必须是对的形状"。上面那几个钉
    prompt 措辞的用例**一条都没删**：措辞在这家是冗余的双保险，一旦换回不认
    size 的端点它又变回唯一开关，两边都不吃亏。
    """
    pw, ph = (int(x) for x in _image_size_for_device("phone").split("x"))
    assert pw < ph, "手机档要传竖版尺寸，形状不该再只靠 prompt 措辞"
    assert _DEVICE_IMAGE_SIZE["phone"] == _image_size_for_device("phone")
    # 桌面档仍是宽屏尺寸。
    dw, dh = (int(x) for x in _image_size_for_device("desktop").split("x"))
    assert dw > dh
    # 两档像素预算同一水平，参照图清晰度才不会一档糊一档锐。
    assert abs(pw * ph - dw * dh) / (dw * dh) < 0.15


def test_phone_only_overview_sheet_also_asks_for_one_portrait_screen():
    """手机专属档的总览参照板同样直接要一整屏竖版。

    此前这一档是"横版画布上并排画两屏手机"——那是基于"端点给不了竖图"这个
    后来被推翻的结论做的将就办法。形状既然由提示词决定，就该直接要竖屏。
    """
    from services.freeform_block import _build_overview_sheet_prompt

    phone_sheet = _build_overview_sheet_prompt(
        "测试", _EMPTY_DATAMODEL, theme_id="tangerine", device="phone"
    )
    assert "9:16" in phone_sheet
    assert "并排画两块" not in phone_sheet, "不该再退回并排两屏手机的将就办法"

    # 桌面档与两档并排档都不能被带成竖图。
    for device in ("desktop", ""):
        sheet = _build_overview_sheet_prompt(
            "测试", _EMPTY_DATAMODEL, theme_id="tangerine", device=device
        )
        assert "整张图要画成手机竖屏比例" not in sheet


def test_block_reference_prompt_forbids_drawing_technical_identifiers():
    """单区块参照图也必须禁画 blockRef / 字段 id 这类技术标识。

    这条明令原本只写在总览参照板那支里，单区块这支漏了——而两边**会吃到同一
    份 brief**：总览页正常走参照板，但 _generate_overview_sheet_b64 任何一步
    失败都静默返回 None，generate_freeform_block 随即退回来自己生一张
    （见其 reference_image_b64 is None 分支），把带 blockRef JSON 的总览 brief
    原样喂进这里。真机复现过两次：轻则画面里印出「blockRef / ActivityFeed」
    徽标，重则整块 JSON 被当成代码块画进图里。
    """
    prompt = _build_reference_image_prompt(
        "测试区块", _EMPTY_DATAMODEL, theme_id="tangerine", device="desktop"
    )
    assert "技术标识" in prompt
    assert "blockRef" in prompt, "要点名 blockRef，模型才知道那串东西不是文案"


def test_both_devices_still_fill_the_canvas():
    """"铺满画布"对两档都成立——画布本身会是对的形状，不需要靠留白去凑比例。"""
    for device in ("phone", "desktop"):
        prompt = _build_reference_image_prompt(
            "测试区块", _EMPTY_DATAMODEL, theme_id="tangerine", device=device
        )
        assert "边缘到边缘" in prompt, f"{device} 档不该在四周留空白凑比例"
