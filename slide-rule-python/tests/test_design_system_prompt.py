"""设计系统进提示词：接在**通电的那条链**上，且两条都接。

本仓最贵的一条纪律是「动手之前先确认哪条链真的在跑」。这里的风险形状很具体：

    主路径   generate_style_brief（2026-08-16 用户裁决改 LLM 现写）
    回落分支 design_language + render_design_language

只接回落分支 = 改在不通电的插座上（真机永远走主路径，改动毫无效果）；
只接主路径 = 风格段生成挂掉那次静默失效（用户选的皮不见了，且不报错）。
所以两条都钉，各配反向条。

另一条要守的是 2026-08-19 的裁决（spec_first_pipeline 第 1420 行上方）：
接过 ui-ux-pro-max 的 CSV 查表，色板当整页墙纸跟桌面契约打架，用户卸掉并留下
「别再把上游 CSV 倒进画页提示词」。DESIGN.md 有 60+ 行 token，整份倒进去是同一个
错误的另一种形状——所以判据钉住"注入的是精简约束，不是整份文档"。
"""

from pathlib import Path

from services.design_language import (
    active_design_system,
    build_style_brief_prompt,
    design_system_constraint,
    design_system_override,
)
from services.identity_palette_hint import set_design_system_override

_SPEC = {
    "appName": "门店管理",
    "pages": [{"id": "p1", "name": "工作台", "purpose": "总览"}],
}


def _system_msg(system_id):
    set_design_system_override(system_id)
    try:
        return build_style_brief_prompt(_SPEC)[0]["content"]
    finally:
        set_design_system_override(None)


def test_主路径_风格段提示词_真的带上了设计系统():
    """正向：选了就必须出现在**主路径**的提示词里。"""
    msg = _system_msg("ink")
    assert "#3D4A5C" in msg
    assert "墨线" in msg
    # 具体参照必须在（官方 PHILOSOPHY：具体参照 > 形容词堆）
    assert "政府审批窗口" in msg


def test_没选设计系统时_提示词与改动前逐字相同():
    """反向：不选就不许多出任何字节。

    这条防的是"顺手改了所有人的默认行为"——没选设计系统的用户不该因为这次
    改动看到不一样的应用。
    """
    plain = _system_msg(None)
    assert design_system_constraint(None) == ""
    assert plain.endswith("只返回 JSON。")


def test_措辞是既定事实_不是建议():
    """原提示词让模型自己写「主色 hex、强调色 hex、圆角」。

    不把这三样明确改成既定事实，模型会照旧发明一套——选择器就又变成装饰。
    """
    msg = _system_msg("ember")
    assert "既定事实" in msg
    assert "不要再自己发明" in msg


def test_负向约束进了提示词():
    """官方 PHILOSOPHY：What you leave out defines the character。"""
    msg = _system_msg("violet")
    assert "不要浅色底" in msg


def test_注入的是精简约束_不是整份_designmd():
    """⚠ 2026-08-19 裁决：别把上游资料整份倒进提示词。

    整份 DESIGN.md 有 60+ 行（YAML token + 8 个小节）。这里只取模型猜不出来的
    那几行。变异：把整份文件读进来拼上去，这条必红。
    """
    msg = _system_msg("forest")
    injected = msg[len(_system_msg(None)) :]
    md = (
        Path(__file__).resolve().parents[1]
        / "services"
        / "data"
        / "design-md"
        / "forest.DESIGN.md"
    ).read_text(encoding="utf-8")
    assert len(injected) < 600, len(injected)
    assert len(injected) < len(md) / 2
    # YAML front matter 的痕迹一个都不许进提示词
    for token in ("---", "typography:", "fontFamily", "spacing:", "## Colors"):
        assert token not in injected, token


def test_回落分支也接了_否则风格段一挂就静默失效():
    """两条链都要接。只接主路径的话，generate_style_brief 返回 None 那次
    会退到 design_language，用户选的皮当场消失且不报错。"""
    set_design_system_override("ember")
    try:
        override = design_system_override(active_design_system())
    finally:
        set_design_system_override(None)
    assert override["primary"] == "#dd6b20"
    assert override["radius"] == "16px"

    # 反向：流水线里真的合进去了，不是只定义了函数没调用
    src = (
        Path(__file__).resolve().parents[1] / "services" / "spec_first_pipeline.py"
    ).read_text(encoding="utf-8")
    assert "design_system_override(_ds)" in src
    # 人显式给的仍然赢（「人写的永远赢」）
    assert "**(design_override or {})}" in src


def test_未选时回落分支也不改变行为():
    set_design_system_override(None)
    assert design_system_override(active_design_system()) == {}
