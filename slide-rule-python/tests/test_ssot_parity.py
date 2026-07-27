"""SSOT 收编哨兵（2026-07-26）：图标/槽位/主题不再两边手抄。

历史问题：图标形状正则+legacy 别名表在 freeform_block.py 与前端
block-registry.tsx 各写一份；gate 的 LAYOUT_SLOTS 手抄目录 allowedSlots；
8 套主题色板 Python 侧手抄前端 THEMES；生成主题合格标准后端 8 键弱检查、
前端 11 项严校验——四处平行拷贝全都没有对账哨兵，谁改一边另一边不会红。

现在真相源收进共享 JSON（experience_block_catalog.json /
identity_theme_presets.json，前端经 vite alias 直读同一份文件），本文件锁
Python 侧的派生关系与契约行为。前端侧对应哨兵：
client/src/pages/sliderule/__tests__/ssot-parity.test.ts
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import freeform_block, schema_legal
from services.freeform_block import _theme_palette, is_valid_generated_theme
from services.identity_theme_gen import IdentityThemeSpec
from services.v5_model_gate import validate_five_system_model  # noqa: F401 — import 即哨兵

_DATA = Path(__file__).resolve().parent.parent / "services" / "data"
CATALOG = json.loads((_DATA / "experience_block_catalog.json").read_text(encoding="utf-8"))
PRESETS = json.loads((_DATA / "identity_theme_presets.json").read_text(encoding="utf-8"))
LEGAL = json.loads((_DATA / "five_system_legal.json").read_text(encoding="utf-8"))


# ── 图标合法域从目录派生 ───────────────────────────────────

def test_icon_pattern_derived_from_catalog():
    assert freeform_block._ANTD_ICON_NAME_RE.pattern == CATALOG["freeformIconNamePattern"]
    assert schema_legal.FREEFORM_ICON_NAME_PATTERN == CATALOG["freeformIconNamePattern"]


def test_legacy_icon_aliases_derived_from_catalog():
    assert freeform_block._LEGACY_ICON_ALIASES == set(CATALOG["freeformLegacyIconAliases"].keys())
    # 映射值必须都是合法组件名形状（前端要拿它去 AntdIcons 查表）
    for alias, component in CATALOG["freeformLegacyIconAliases"].items():
        assert freeform_block._ANTD_ICON_NAME_RE.match(component), (alias, component)
        assert not freeform_block._ANTD_ICON_NAME_RE.match(alias), alias


# ── 槽位从目录派生（gate 不再手抄）─────────────────────────

def test_gate_layout_slots_derived_from_catalog():
    assert set(schema_legal.EXPERIENCE_BLOCK_ALLOWED_SLOTS) == set(CATALOG["allowedSlots"])
    # gate 源码不允许再出现手抄槽位集合
    gate_src = (Path(__file__).resolve().parent.parent / "services" / "v5_model_gate.py").read_text(
        encoding="utf-8"
    )
    assert 'LAYOUT_SLOTS = {"summary"' not in gate_src
    assert "LAYOUT_SLOTS = set(EXPERIENCE_BLOCK_ALLOWED_SLOTS)" in gate_src


# ── 主题预设单一真相源 ─────────────────────────────────────

def test_theme_hints_derived_from_presets():
    themes = PRESETS["themes"]
    assert set(freeform_block._THEME_COLOR_HINTS.keys()) == set(themes.keys())
    for theme_id, hints in freeform_block._THEME_COLOR_HINTS.items():
        for key, value in hints.items():
            assert value == themes[theme_id][key], (theme_id, key)
    assert freeform_block._DEFAULT_THEME_ID == PRESETS["defaultThemeId"]


def test_preset_ids_match_legal_ledger():
    assert sorted(PRESETS["themes"].keys()) == sorted(LEGAL["identityThemes"])


def test_presets_pass_generation_spec():
    """预设本身必须过生成侧同一套校验（hex 格式 + WCAG 对比度）——预设是
    生成主题的兜底，兜底自己不合格就说不过去。"""
    for theme_id, theme in PRESETS["themes"].items():
        payload = {k: v for k, v in theme.items() if k != "id"}
        IdentityThemeSpec.model_validate(payload)


# ── 生成主题契约：与前端同一判定 ───────────────────────────

VALID_THEME = {
    "primary": "#123456", "primaryHover": "#123456", "gradTo": "#123456",
    "primaryFg": "#ffffff", "contentBg": "#f0f0f0", "accentBg": "#eeeeee",
    "accentFg": "#333333", "sidebarText": "#cccccc", "sidebarBg": "#101820",
    "charts": ["#111111", "#222222", "#333333"],
}


def test_generated_theme_contract_accepts_valid():
    assert is_valid_generated_theme(VALID_THEME)
    palette = _theme_palette("forest", VALID_THEME)
    assert palette["primary"] == VALID_THEME["primary"]
    # label 不在契约必填集里，但 prompt 消费方要读——出口必须兜底，
    # 缺 label 的合格主题不能把增强层炸成 KeyError（终检实测事故）。
    assert palette["label"]


def test_generated_theme_contract_rejects_partial():
    """此前的 8 键弱检查会放行缺 sidebarBg/primaryFg 的主题（前端却弃用）——
    错配窗口下卡片配色与侧栏对不上。现在必须整套拒绝、回落预设。"""
    missing_sidebar = {k: v for k, v in VALID_THEME.items() if k != "sidebarBg"}
    assert not is_valid_generated_theme(missing_sidebar)
    assert _theme_palette("forest", missing_sidebar) == freeform_block._THEME_COLOR_HINTS["forest"]


def test_generated_theme_contract_rejects_trailing_newline():
    """Python 的 $ 豁免尾随换行、JS 不豁免——必须用 fullmatch 堵住这道
    "后端判合格、前端整套弃用"的换行错配窗口。"""
    sneaky = dict(VALID_THEME, primary="#123456\n")
    assert not is_valid_generated_theme(sneaky)


def test_generated_theme_contract_rejects_bad_shapes():
    bad_hex = dict(VALID_THEME, primary="red")
    assert not is_valid_generated_theme(bad_hex)
    bad_charts = dict(VALID_THEME, charts=["#111111", "#222222"])
    assert not is_valid_generated_theme(bad_charts)
    gradient_ok = dict(
        VALID_THEME, sidebarBg="linear-gradient(180deg, #101820, #203040)"
    )
    assert is_valid_generated_theme(gradient_ok)
    gradient_bad = dict(VALID_THEME, sidebarBg="linear-gradient(red, blue)")
    assert not is_valid_generated_theme(gradient_bad)


def test_spec_fields_cover_contract():
    contract = PRESETS["generatedThemeContract"]
    assert set(contract["requiredKeys"]) <= set(IdentityThemeSpec.model_fields.keys())
