"""配色合规的机械防线。

夹具是真跑那两份样本的核心色值：tangerine 主题下，一次跑偏（主色 0 次、
蓝色 24 次、还发明了一套色板外的绿），一次合规。规则要能把这两者判开。
"""

import pytest

from services.palette_guard import (
    HUE_TOLERANCE,
    NEUTRAL_CHROMA,
    extract_hex_colors,
    palette_report,
    repair_colors,
    snap_hex_to_palette,
)

# tangerine 主题真实色板
PALETTE = ["#e05d38", "#f59e0b", "#3b82f6"]
PRIMARY = "#e05d38"


def _report(colors):
    return palette_report(colors, PALETTE, PRIMARY)


# ── R1 色相合规 ───────────────────────────────────────────────────────

def test_lightness_variants_of_the_palette_pass():
    """只比色相不比 ΔE 的理由：深浅变体全都合法。

    #fff0eb（极浅橘底）跟主色的整体色差很大，但它就是主色的浅端，
    prompt 也明确允许"含深浅/透明度变体"。用 ΔE 判会把它误杀。
    """
    r = _report(["#e05d38", "#c2410c", "#fdba74", "#fff0eb", "#b23c17"])
    assert r.hue_ok, r.off_palette


def test_invented_hue_family_is_caught():
    """跑偏那次自己发明的绿——离最近的色板色相 85° 开外。"""
    r = _report(["#e05d38", "#249C80", "#54BFA0", "#218C76"])
    assert not r.hue_ok
    assert {c.lower() for c, _ in r.off_palette} == {"#249c80", "#54bfa0", "#218c76"}
    assert all(gap > 80 for _, gap in r.off_palette)


def test_palette_declared_blue_is_legal():
    """蓝色**在色板里**（类别色），色相检查不该拦它——它是配比问题不是合法性问题。
    这条把 R1 和 R2 的职责分清楚。"""
    r = _report(["#e05d38", "#3b82f6", "#4F73E8", "#172B4D"])
    assert r.hue_ok


def test_neutrals_are_exempt():
    """纯白/浅灰、以及**带色调的灰**（#7A869A 石板灰蓝）都算中性。

    后者是标阈值时修正过的一处：0.03 会把它划进蓝色系、让 R2 的配比统计
    虚高。带色调的灰在设计系统里一律算中性（Tailwind 的 slate 就是这类）。
    """
    r = _report(["#FFFFFF", "#000000", "#7A869A", "#FFF9F0", "#F5F5F5"])
    assert r.hue_ok
    assert r.non_neutral == 0
    assert r.primary_ok  # 全中性设计不苛求主色出场


# ── R2 主色在场 ───────────────────────────────────────────────────────

def test_primary_absent_is_caught():
    """跑偏那次的核心事故：主色一次没用，另一个色系压倒性占多数。"""
    r = _report(["#3b82f6"] * 24 + ["#f59e0b"] * 2)
    assert r.hue_ok           # 色相都合法
    assert not r.primary_ok   # 但主色缺席
    assert r.primary_uses == 0


def test_primary_dominant_passes():
    r = _report(["#e05d38"] * 18 + ["#3b82f6"] * 10 + ["#f59e0b"] * 4)
    assert r.ok


def test_primary_tied_with_dominant_passes():
    """并列第一算过——不苛求主色必须严格多于其他所有色系。"""
    r = _report(["#e05d38"] * 8 + ["#3b82f6"] * 8)
    assert r.primary_ok


# ── 纠偏 ─────────────────────────────────────────────────────────────

def test_snap_keeps_lightness_and_chroma():
    """纠偏只改色系，不改明暗——浅底卡片不能被刷成深色砖。"""
    from coloraide import Color

    before = Color("#249C80").convert("oklch")
    after = Color(snap_hex_to_palette("#249C80", PALETTE)).convert("oklch")
    assert abs(after["lightness"] - before["lightness"]) < 0.02
    assert abs(after["chroma"] - before["chroma"]) < 0.02
    assert after["hue"] != pytest.approx(before["hue"], abs=1)


def test_snap_leaves_neutrals_and_legal_colors_alone():
    for c in ("#FFFFFF", "#7A869A", "#e05d38", "#3b82f6"):
        assert snap_hex_to_palette(c, PALETTE).lower() == c.lower()


def test_repair_fixes_hue_but_not_proportion():
    """机械纠偏只治 R1。R2 是配比，机械改配比等于替模型重做设计。"""
    payload = '{"a":"#249C80","b":"#54BFA0","c":"#3b82f6","d":"#3b82f6"}'
    fixed, changed = repair_colors(payload, PALETTE, PRIMARY)
    assert changed == 2
    after = palette_report(extract_hex_colors(fixed), PALETTE, PRIMARY)
    assert after.hue_ok            # 色相治好了
    assert not after.primary_ok    # 配比没动，仍然报主色缺席


def test_repair_is_a_noop_when_already_compliant():
    payload = '{"a":"#e05d38","b":"#3b82f6"}'
    fixed, changed = repair_colors(payload, PALETTE, PRIMARY)
    assert changed == 0 and fixed == payload


# ── 健壮性 ───────────────────────────────────────────────────────────

def test_bad_values_do_not_raise():
    r = _report(["#GGGGGG", "", "not-a-color", "#e05d38"])
    assert isinstance(r.ok, bool)
    assert snap_hex_to_palette("#ZZZZZZ", PALETTE) == "#ZZZZZZ"


def test_extract_finds_colors_inside_gradients_and_nested_objects():
    payload = {"style": {"background": "linear-gradient(90deg, #e05d38 0%, #fff0eb 100%)"}}
    assert set(extract_hex_colors(payload)) == {"#e05d38", "#fff0eb"}


def test_thresholds_are_calibrated_not_arbitrary():
    """阈值是照真实样本标的，改动必须是明确决定。"""
    assert HUE_TOLERANCE == 25.0
    assert NEUTRAL_CHROMA == 0.04


def test_reask_message_names_the_offenders():
    r = _report(["#249C80", "#3b82f6", "#3b82f6"])
    msg = r.reask_message(PALETTE, PRIMARY)
    assert "#249C80" in msg
    assert PRIMARY in msg  # 主色缺席那条也要说清
