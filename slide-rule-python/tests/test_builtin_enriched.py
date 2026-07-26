"""演示域夹具的体验层增强哨兵（golden-file，2026-07-26）。

历史问题：四份冻结夹具全部诞生于 V5.4 体验层之前——没有生成式主题，
"需求越标准拿到的应用越旧"。修法：scripts/enrich_builtin_domain_models.py
离线跑增强、重新过门后冻结回 JSON（运行时仍零 LLM）。

本文件锁住冻结产物的增强状态：谁重新生成夹具但丢了主题、或主题不合
生成契约（前端会整套弃用回落预设），CI 立刻红。

注：夹具首页是 dashboard kind（有自己的真实渲染路径），freeformOverview
只服务 monitor kind——夹具没有 monitor 页是信息架构事实，不在此断言。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.freeform_block import is_valid_generated_theme

FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"
MODELS = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _theme(model: dict) -> dict:
    return ((model.get("appbundle") or {}).get("appIdentity") or {}).get("generatedTheme") or {}


def test_all_domains_carry_generated_theme():
    assert MODELS, "夹具文件为空"
    for domain, model in MODELS.items():
        theme = _theme(model)
        assert theme, f"{domain} 缺 generatedTheme——夹具重新生成后忘了跑增强脚本？"
        assert is_valid_generated_theme(theme), (
            f"{domain} 的 generatedTheme 不合生成契约（前端会整套弃用回落预设）"
        )


def test_generated_themes_visually_distinct():
    """四域主色两两不同——演示矩阵的视觉差异是这次增强的目的本身，
    全收敛到同一色值等于白做（纯文字取色实测会发生，靠色相锚点保住）。"""
    primaries = [_theme(m).get("primary") for m in MODELS.values()]
    assert len(set(primaries)) == len(primaries), f"主色出现重复: {primaries}"


def test_preset_theme_id_untouched():
    """增强只追加 generatedTheme，不动 8 选 1 的预设 theme 字段（那是
    生成失败时的兜底身份，动了就没有稳定回退）。"""
    for domain, model in MODELS.items():
        identity = (model.get("appbundle") or {}).get("appIdentity") or {}
        assert identity.get("theme"), f"{domain} 预设 theme 字段丢失"
