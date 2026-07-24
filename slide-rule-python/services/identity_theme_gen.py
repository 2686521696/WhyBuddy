"""
identity_theme_gen — 身份主题（侧边栏/顶栏/主色）token 生成（2026-07-24）。

跟 freeform_block.py 同一套骨架、同一套哲学：不是让 LLM 写 CSS 去改 Ant
Design 组件（那条路风险高得多——侧边栏/顶栏是全局共享的，改坏一处波及
全部页面），而是让 LLM 去填 Ant Design 本来就有的、闭合安全的 token 表
（colorPrimary/侧边栏底色这些命名好的键，跟 AppRuntimeScreen.tsx 的
ConfigProvider theme.token/theme.components 一一对应）。8 套写死的预设
主题（identity-themes.ts 的 THEMES）retained 作降级兜底，不再是唯一选项。

生成失败/未配置图片能力时静默降级——appbundle.appIdentity.theme 那个
8 选 1 的字符串字段完全不受影响，前端 resolveIdentityTheme 照旧能用。
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class IdentityThemeGenerationError(RuntimeError):
    """身份主题生成/校验失败（调用方应静默降级到 8 预设主题，不能拖垮主链路）。"""


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _relative_luminance(hex_color: str) -> float:
    """WCAG 相对亮度公式。"""
    r, g, b = (c / 255.0 for c in _hex_to_rgb(hex_color))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = lin(r), lin(g), lin(b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast_ratio(hex_a: str, hex_b: str) -> float:
    """WCAG 对比度公式，越大越清楚，>=3 是可读性的最低线。"""
    la, lb = _relative_luminance(hex_a), _relative_luminance(hex_b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


_MIN_CONTRAST = 3.0


class IdentityThemeSpec(BaseModel):
    """跟前端 identity-themes.ts 的 IdentityTheme 接口逐字段对应。字段本身
    只做客观可查的校验（十六进制格式、可读性对比度），不对"好不好看"这种
    主观判断做任何限制——配色选择完全交给 LLM。"""

    label: str
    primary: str
    primaryHover: str
    gradTo: str
    primaryFg: str
    contentBg: str
    accentBg: str
    accentFg: str
    charts: list[str] = Field(min_length=3, max_length=3)
    sidebarBg: str
    sidebarText: str

    @field_validator(
        "primary", "primaryHover", "gradTo", "primaryFg", "contentBg",
        "accentBg", "accentFg", "sidebarBg", "sidebarText",
    )
    @classmethod
    def check_hex(cls, v: str) -> str:
        if not _HEX_RE.match(v):
            raise ValueError(f"'{v}' is not a valid 6-digit hex color (e.g. #1677ff)")
        return v

    @field_validator("charts")
    @classmethod
    def check_chart_hexes(cls, v: list[str]) -> list[str]:
        for c in v:
            if not _HEX_RE.match(c):
                raise ValueError(f"chart color '{c}' is not a valid 6-digit hex color")
        return v

    @model_validator(mode="after")
    def check_contrast(self) -> "IdentityThemeSpec":
        pairs = [
            ("primaryFg on primary", self.primaryFg, self.primary),
            ("sidebarText on sidebarBg", self.sidebarText, self.sidebarBg),
            ("accentFg on accentBg", self.accentFg, self.accentBg),
        ]
        for label, fg, bg in pairs:
            ratio = _contrast_ratio(fg, bg)
            if ratio < _MIN_CONTRAST:
                raise ValueError(
                    f"{label} contrast ratio {ratio:.2f} is too low (need >= {_MIN_CONTRAST}); "
                    "pick a lighter/darker foreground so text stays readable"
                )
        return self


def build_identity_theme_prompt(app_name: str, goal_text: str, datamodel_summary: str) -> str:
    return f"""你是一名产品视觉设计师。给这个应用设计一套完整的品牌配色方案：
应用名称：{app_name}
产品目标：{goal_text}
这个应用背后的真实数据领域（配色气质可以呼应这个领域的行业调性，比如财务
审计类偏严谨、创意协作类偏活泼——不是必须，只是可以参考）：
{datamodel_summary}

自由发挥配色，不受任何预设色板限制——可以是任何色相、任何明暗基调，只要
整体协调、专业。

输出这些字段，全部是标准 6 位十六进制颜色值（如 #1677ff）：
- label: 给这套配色起一个简短的气质名（如"湛蓝·通用企业"这种格式，4-8字）
- primary: 主色（按钮/选中态/品牌区用）
- primaryHover: 主色的悬停加深态
- gradTo: 主色渐变的浅端
- primaryFg: 主色上的文字颜色（通常是白或近白，必须跟 primary 对比度足够）
- contentBg: 页面内容区底色（通常浅色）
- accentBg: 强调浅底（选中菜单浅底/高亮块）
- accentFg: accentBg 上的文字颜色（必须跟 accentBg 对比度足够）
- charts: 3 个颜色组成的数组，用于图表多类别区分，要跟主色协调但彼此能区分开
- sidebarBg: 侧边栏/顶栏底色（可以是深色也可以是浅色，你自己判断跟主色最搭的方案）
- sidebarText: sidebarBg 上的文字颜色（必须跟 sidebarBg 对比度足够，能看清）

文字类颜色（primaryFg/accentFg/sidebarText）必须选得让文字在对应底色上
清晰可读，不要为了好看牺牲可读性。

输出严格 JSON，只输出这一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：
{{"label": "...", "primary": "#......", "primaryHover": "#......", "gradTo": "#......",
"primaryFg": "#......", "contentBg": "#......", "accentBg": "#......", "accentFg": "#......",
"charts": ["#......", "#......", "#......"], "sidebarBg": "#......", "sidebarText": "#......"}}"""


def _build_reference_image_prompt(app_name: str, goal_text: str, datamodel_summary: str) -> str:
    return (
        f"为一个企业应用生成一张品牌配色参考图（干净原型图）。应用名称：{app_name}。"
        f"产品目标：{goal_text}。"
        f"背后的真实数据领域：{datamodel_summary}。"
        "要求：画一个简洁的应用主界面草样——左侧侧边栏 + 顶部导航条 + 一小块内容"
        "区示意，重点展示整体配色方案（侧边栏底色、主色、内容区底色如何协调）。"
        "配色完全自由发挥，不要套用任何标准配色模板，可以大胆、有个性，只要整体"
        "协调专业。只示意版式与配色，不要写任何具体数字/真实数据，占位文案用"
        "「示例XX」这类通用字样；不要出现任何多余的装饰性水印或品牌字样。"
    )


def _generate_reference_image_b64(app_name: str, goal_text: str, datamodel_summary: str) -> Optional[str]:
    try:
        from sliderule_llm.image_client import ImageGenError, generate_image_png
    except Exception:
        return None
    try:
        prompt = _build_reference_image_prompt(app_name, goal_text, datamodel_summary)
        png_bytes = generate_image_png(prompt, size="1024x1024")
    except ImageGenError as exc:
        print(f"[identity_theme_gen] reference image skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 生图失败绝不能拖垮主链路
        print(f"[identity_theme_gen] reference image skipped (unexpected): {str(exc)[:160]}")
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def generate_identity_theme(
    app_name: str,
    goal_text: str,
    datamodel: dict[str, Any],
    *,
    max_retries: int = 2,
    temperature: float = 0.9,
    max_tokens: int = 2000,
    use_reference_image: bool = True,
) -> dict[str, Any]:
    """生成 + 校验一套身份主题 token。跟 freeform_block.generate_freeform_block
    同一套 reask 语义。重试耗尽抛 IdentityThemeGenerationError，调用方应静默
    降级到 8 预设主题，不能让这个增强项拖垮主生成路径。

    temperature 给到 0.9（比 FreeformInsight 的 0.7 更高）：这是纯配色发挥，
    没有真实数据/结构约束要守，更高的温度换更大胆多样的配色，不必担心跑偏
    出编造数据那类真实性问题。
    """
    app_name = (app_name or "").strip() or "未命名应用"
    goal_text = (goal_text or "").strip() or app_name

    from sliderule_llm.client import LlmError, call_llm_with_retry
    from sliderule_llm.config import get_llm_config
    from .freeform_block import _datamodel_summary_lines

    datamodel_summary = _datamodel_summary_lines(datamodel) or "（暂无数据模型摘要）"
    prompt_text = build_identity_theme_prompt(app_name, goal_text, datamodel_summary)

    reference_image_b64: Optional[str] = None
    if use_reference_image and get_llm_config().supports_image_content_parts:
        reference_image_b64 = _generate_reference_image_b64(app_name, goal_text, datamodel_summary)

    if reference_image_b64:
        first_content: Any = [
            {
                "type": "text",
                "text": prompt_text
                + "\n\n下面这张图是一张配色参考图，照着它的配色方案提炼出上面要求的"
                "各个 token 值（不需要版式跟这张图一模一样，只需要配色协调统一）。",
            },
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{reference_image_b64}"}},
        ]
    else:
        first_content = prompt_text

    convo: list[dict[str, Any]] = [{"role": "user", "content": first_content}]
    last_error = "unknown"
    for _attempt in range(max_retries + 1):
        try:
            result = call_llm_with_retry(
                convo,
                max_attempts=2,
                backoff_ms=2000,
                temperature=temperature,
                max_tokens=max_tokens,
                on_delta=lambda _chunk: None,
            )
        except LlmError as exc:
            last_error = f"llm error: {str(exc)[:200]}"
            continue

        raw = result.content or ""
        try:
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
            if not text.startswith("{"):
                m = re.search(r"\{.*\}", text, re.DOTALL)
                if not m:
                    raise ValueError("no JSON object found in response")
                text = m.group(0)
            payload = json.loads(text)
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = f"invalid JSON: {str(exc)[:200]}"
            convo = convo + [
                {"role": "assistant", "content": raw[:3000]},
                {"role": "user", "content": f"你上次的输出不是合法 JSON：{last_error}。请重新输出，只要一个 JSON 对象。"},
            ]
            continue

        try:
            spec = IdentityThemeSpec.model_validate(payload)
            return spec.model_dump()
        except ValidationError as exc:
            last_error = str(exc)[:1000]
            convo = convo + [
                {"role": "assistant", "content": raw[:3000]},
                {
                    "role": "user",
                    "content": (
                        f"你上次的输出没有通过校验，具体错误：\n{last_error}\n"
                        "请检查：所有颜色必须是标准 6 位十六进制格式（#rrggbb）；"
                        "文字色（primaryFg/accentFg/sidebarText）跟对应底色的对比度"
                        "必须足够高，文字才能看清——如果报了对比度不够，把文字色换成"
                        "更接近纯白或纯黑的极端值。重新输出完整的 JSON。"
                    ),
                },
            ]

    raise IdentityThemeGenerationError(f"exhausted {max_retries + 1} attempts, last error: {last_error}")


def enrich_identity_theme(model: dict[str, Any], goal: str = "") -> dict[str, Any]:
    """主模型过 Gate 之后跑的增强步骤：生成一套身份主题 token，写回
    appbundle.appIdentity.generatedTheme。生成失败（重试耗尽/生图不可用）
    时原地跳过，不写这个字段——appIdentity.theme 那个 8 选 1 的字符串字段
    完全不受影响，前端照旧能用预设主题渲染，不会出现"没有主题"的空态。
    原地修改并返回同一个 model，方便调用方链式使用。

    goal：调用方（v5_capability_executor）手里本来就有的原始用户目标文本，
    直接传进来——model 字典本身不携带这个字段，不要指望从 model.get 读到。
    """
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity")
    if not isinstance(identity, dict):
        return model
    app_name = str(identity.get("productName") or model.get("appName") or "").strip()
    goal_text = str(goal or app_name).strip()
    datamodel = model.get("datamodel") or {}
    try:
        theme = generate_identity_theme(app_name, goal_text, datamodel)
        identity["generatedTheme"] = theme
    except IdentityThemeGenerationError as exc:
        print(f"[identity_theme_gen] generation failed, falling back to preset theme: {str(exc)[:200]}")
    return model
