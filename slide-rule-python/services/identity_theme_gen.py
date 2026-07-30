"""
identity_theme_gen — 身份主题种子色生成（2026-07-30 起改为路线丙）。

## 从"LLM 直接吐 11 个字段"改成"LLM 只吐 1 个种子色"

此前这里让 LLM 一次性把 primary/primaryHover/gradTo/.../sidebarText 共 11 个
字段全部配好，本质是让 LLM 做一遍色彩科学（怎么从主色推出协调的悬停态、
渐变端、强调底、深色侧栏……），配出来的东西全靠它自己判断"协调不协调"，
质量不稳定，而且这活儿本来就有更可靠的做法：Material Design 3 的
material-color-utilities（HCT/CAM16 空间）早就把"从一个种子色出发派生整套
色阶"这件事解决了，我们已经把它 vendor 进 `client/src/lib/mcu/`
（`client/src/lib/identity-palette.ts` 的 `deriveIdentityPalette`）。

LLM 真正擅长、算法replace不了的只有一件事：**替这个应用选一个合适的品牌
色**（懂产品调性、行业气质、目标用户）。所以现在只问它要这一件事——
一个种子色 + 一个气质标签，剩下 10 个字段全部交给前端的 HCT 派生算法算，
不再靠 LLM 自己配、也不再靠人工写死 8 套预设。

跟 device 判定用的是同一个方法论（这个仓库里已经验证过的模式）：把"选择"
这件事收窄到 LLM 真正擅长的那一小块判断，把"从判断结果推出一整套结构化
产物"的部分交给确定性算法。

生成失败/未配置图片能力时静默降级——appbundle.appIdentity.theme 那个
8 选 1 的字符串字段完全不受影响，generatedTheme 缺失时前端落回
FALLBACK_SEED 派生的中性色板。
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

# 格式正则从 data/identity_theme_presets.json 的 generatedThemeContract 派生
# ——前端 isValidGeneratedTheme 与 freeform_block.is_valid_generated_theme
# 同读同一份，格式定义只此一处。
_THEME_PRESETS_PATH = Path(__file__).resolve().parent / "data" / "identity_theme_presets.json"
_THEME_CONTRACT: dict = json.loads(_THEME_PRESETS_PATH.read_text(encoding="utf-8")).get(
    "generatedThemeContract"
) or {}
_HEX_RE = re.compile(str(_THEME_CONTRACT.get("hexPattern") or r"^#[0-9a-fA-F]{6}$"))


class IdentityThemeGenerationError(RuntimeError):
    """身份主题生成/校验失败（调用方应静默降级到 FALLBACK_SEED 派生的中性色板，不能拖垮主链路）。"""


class IdentityThemeSeedSpec(BaseModel):
    """跟前端 GeneratedIdentityTheme（{label?, seed}）逐字段对应。只校验客观
    可查的格式（十六进制），配色好不好看完全交给 LLM 判断——机械层不替它
    做审美决定，只挡格式不对的输出。"""

    label: str = ""
    seed: str

    @field_validator("seed")
    @classmethod
    def check_hex(cls, v: str) -> str:
        if not _HEX_RE.fullmatch(v):
            raise ValueError(f"'{v}' is not a valid 6-digit hex color (e.g. #1677ff)")
        return v


# 启动漂移哨兵（schema_legal 同款纪律）：Spec 的字段必须覆盖契约的
# requiredKeys——否则生成出来的主题必然被前端 isValidGeneratedTheme 弃用，
# 与其运行时静默失效，不如 import 期直接炸出来。
_SPEC_FIELDS = set(IdentityThemeSeedSpec.model_fields.keys())
_MISSING_CONTRACT_KEYS = set(_THEME_CONTRACT.get("requiredKeys") or ()) - _SPEC_FIELDS
if _MISSING_CONTRACT_KEYS:
    raise RuntimeError(
        "identity_theme_gen.IdentityThemeSeedSpec 缺契约必填字段（生成的主题会被前端整套弃用）: "
        f"{sorted(_MISSING_CONTRACT_KEYS)}"
    )


def experience_skill_guidance_block() -> str:
    """已安装的 experience 通道技能拼成的设计指导块（2026-07-27）。见旧版
    同名函数的说明；这里逻辑不变，只是现在只影响"选哪个种子色"这一步。"""
    try:
        from .v5_llm_generate import installed_skills_for_channel

        skills = installed_skills_for_channel("experience")
    except Exception:
        return ""  # 增强项，任何异常都不拦主题生成
    if not skills:
        return ""
    lines = ["", "用户装了这些设计技能，选种子色时把它们的主张纳入考虑（有冲突时以下面的选色指导为准）："]
    for s in skills:
        desc = f" — {s['description']}" if s.get("description") else ""
        lines.append(f"- {s['name']}{desc}")
    return "\n".join(lines)


def build_identity_theme_prompt(app_name: str, goal_text: str, datamodel_summary: str) -> str:
    return f"""你是一名产品视觉设计师。给这个应用选一个品牌种子色：
应用名称：{app_name}
产品目标：{goal_text}
这个应用背后的真实数据领域（配色气质可以呼应这个领域的行业调性，比如财务
审计类偏严谨、创意协作类偏活泼——不是必须，只是可以参考）：
{datamodel_summary}

只需要选**一个种子色**——应用的按钮/选中态/品牌区会用它，其余所有配色
（悬停态、渐变、内容区底色、强调色、图表色、侧边栏……）都会由算法从这
一个颜色自动派生，你不用、也不该管那些字段怎么配。

选色的几条实际约束（不遵守会导致派生结果难看，不是审美偏好）：
- 色相自由发挥，不受任何预设色板限制，只要贴合这个应用的产品调性即可，
  避免离题的色相组合（比如财务审计类应用突然给一个荧光粉）。
- 配色气质整体偏**克制、淡雅**，饱和度选中低档，不要选过曝的高饱和荧光色
  （比如纯 #ff0000/#00ff00 这类）——那类颜色派生出的按钮/强调色会显得
  刺眼，跟企业应用的专业气质不搭。
- 但也不要选到几乎无彩色的灰/米白（比如 #f0f0f0 这种）——那不是"克制"，
  是没有色相可言，派生算法会按这个种子色的色相去配中性色/强调色，种子
  本身没有色相，整套派生出来的配色会显得"发灰发脏"，缺乏品牌辨识度。
  中低饱和度不等于无彩度，选一个"看得出是什么颜色，但不刺眼"的量级。
- 挑一个你在真实产品里会认得出"这是这家应用的颜色"的中低饱和度色相即可，
  可以直接类比市面上有代表性的产品主色（比如某某银行的深蓝、某某生鲜
  平台的绿）帮自己校准饱和度量级，但不要照抄，选一个贴合这个具体应用的。
{experience_skill_guidance_block()}

输出这些字段：
- label: 给这个种子色起一个简短的气质名（如"湛蓝·通用企业"这种格式，4-8字）
- seed: 标准 6 位十六进制颜色值（如 #1677ff）

输出严格 JSON，只输出这一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：
{{"label": "...", "seed": "#......"}}"""


_SHELL_SHAPE_NOTE: dict[str, str] = {
    "phone": "画手机端形态——上方一条窄标题栏、下方一条底部 Tab 导航栏，中间是内容区，整体竖屏比例。",
    "desktop": "画桌面端形态——左侧一条侧边栏、上方一条顶部导航条、右侧是内容区，整体宽屏比例。",
    "tablet": "画平板端形态——左侧一条比桌面窄一些的侧边栏、上方顶部导航条、右侧内容区。",
}


def _build_reference_image_prompt(app_name: str, goal_text: str, datamodel_summary: str, device: str) -> str:
    """2026-07-30 改版：把"一小块内容区示意即可，不用画满"换成"画出真实完整的
    页面布局"。实测对比过（同一模型、同一份内容清单，只改这一句）：旧措辞会让
    生图模型画一堆孤立色块，新措辞会让它画出带侧栏/顶栏/真实卡片层级的完整
    界面，图标徽标、辅助信息这些细节密度也跟着上来了——参照的是一份真实第三方
    技能包的验证过的提示词写法（"画出真实的页面布局（顶部导航 + 主操作区 +
    列表/卡片/侧栏等）"），不是凭空猜的。
    """
    shape_note = _SHELL_SHAPE_NOTE.get(device) or _SHELL_SHAPE_NOTE["desktop"]
    return (
        f"为一个企业应用生成一张品牌配色参考图（干净原型图）。应用名称：{app_name}。"
        f"产品目标：{goal_text}。"
        f"背后的真实数据领域：{datamodel_summary}。"
        f"要求：{shape_note}画出真实完整的页面布局，充分利用整个画布——不是几块"
        "孤立的抽象色块，而是有导航/侧栏/内容区这些真实层级结构的一整页界面；"
        "整体配色方案（导航区底色、主色、内容区底色如何协调）要在这个真实版式里"
        "清楚体现出来。"
        "配色气质整体偏克制、淡雅——大面积的内容区/导航区底色都用低饱和度的浅色，"
        "全饱和的鲜艳色只留给按钮/选中态这类小面积强调，不要大面积铺高饱和度色块；"
        "色相本身可以自由发挥、大胆有个性，只要整体协调专业、不刺眼。不要写任何"
        "具体数字/真实数据，占位文案用"
        "「示例XX」这类通用字样；不要出现任何多余的装饰性水印或品牌字样；"
        "画面本身要撑满整个画布，边缘到边缘，不要在四周留一圈空白画布底色、"
        "不要画装饰性的外框/圆角卡片壳/浏览器窗口 mockup 把整个界面包在里面——"
        "这张图本身就是应用界面，不是「一张图里嵌一张界面截图」的效果。"
    )


def _generate_reference_image_b64(app_name: str, goal_text: str, datamodel_summary: str, device: str) -> Optional[str]:
    try:
        from sliderule_llm.image_client import ImageGenError, generate_image_png
        from .freeform_block import _image_size_for_device
    except Exception:
        return None
    try:
        prompt = _build_reference_image_prompt(app_name, goal_text, datamodel_summary, device)
        png_bytes = generate_image_png(prompt, size=_image_size_for_device(device))
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
    device: str = "",
    max_retries: int = 2,
    temperature: float = 0.9,
    max_tokens: int = 400,
    use_reference_image: bool = True,
) -> dict[str, Any]:
    """生成 + 校验一个身份主题种子色。跟 freeform_block.generate_freeform_block
    同一套 reask 语义。重试耗尽抛 IdentityThemeGenerationError，调用方应静默
    降级到 FALLBACK_SEED 派生的中性色板，不能让这个增强项拖垮主生成路径。

    temperature 给到 0.9：这是纯选色发挥，没有真实数据/结构约束要守，更高
    的温度换更大胆多样的选色，不必担心跑偏出编造数据那类真实性问题。

    max_tokens 从 2000 降到 400：旧版要吐 11 个字段的完整 JSON，现在只有
    label+seed 两个字段，输出短得多，没必要留那么大的余量。
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
        reference_image_b64 = _generate_reference_image_b64(app_name, goal_text, datamodel_summary, device)

    if reference_image_b64:
        first_content: Any = [
            {
                "type": "text",
                "text": prompt_text
                + "\n\n下面这张图是一张配色参考图，从它的主色调里提炼出上面要求的种子色"
                "（不需要版式跟这张图一模一样，只需要抓住它的主色调）。",
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
                {"role": "assistant", "content": raw[:1000]},
                {"role": "user", "content": f"你上次的输出不是合法 JSON：{last_error}。请重新输出，只要一个 JSON 对象。"},
            ]
            continue

        try:
            spec = IdentityThemeSeedSpec.model_validate(payload)
            return spec.model_dump()
        except Exception as exc:  # noqa: BLE001 — pydantic ValidationError 及其子类
            last_error = str(exc)[:500]
            convo = convo + [
                {"role": "assistant", "content": raw[:1000]},
                {
                    "role": "user",
                    "content": (
                        f"你上次的输出没有通过校验，具体错误：\n{last_error}\n"
                        "请检查：seed 必须是标准 6 位十六进制格式（#rrggbb）。"
                        "重新输出完整的 JSON。"
                    ),
                },
            ]

    raise IdentityThemeGenerationError(f"exhausted {max_retries + 1} attempts, last error: {last_error}")


def enrich_identity_theme(model: dict[str, Any], goal: str = "") -> dict[str, Any]:
    """主模型过 Gate 之后跑的增强步骤：生成一个种子色，写回
    appbundle.appIdentity.generatedTheme。生成失败（重试耗尽/生图不可用）
    时原地跳过，不写这个字段——appIdentity.theme 那个 8 选 1 的字符串字段
    完全不受影响，前端 resolveIdentityTheme 在 generatedTheme 缺失时落回
    FALLBACK_SEED 派生的中性色板，不会出现"没有主题"的空态。
    原地修改并返回同一个 model，方便调用方链式使用。

    goal：调用方（v5_capability_executor）手里本来就有的原始用户目标文本，
    直接传进来——model 字典本身不携带这个字段，不要指望从 model.get 读到。
    """
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity")
    if not isinstance(identity, dict):
        return model
    # 幂等（2026-07-27 迭代体验审查 D1）：已有合格生成主题就不重生。此前
    # 精修/版本回退每次都无条件重掷一套 temperature=0.9 的新配色——用户加
    # 一个字段,整个应用视觉全变;回退到 v1,配色却不是 v1 的。品牌身份一旦
    # 确立应当稳定,想换主题应是显式动作,不是任何一次迭代的副作用。
    from services.freeform_block import is_valid_generated_theme

    if is_valid_generated_theme(identity.get("generatedTheme")):
        return model
    app_name = str(identity.get("productName") or model.get("appName") or "").strip()
    goal_text = str(goal or app_name).strip()
    datamodel = model.get("datamodel") or {}
    device = str(appbundle.get("preferredDevice") or "").strip()
    try:
        theme = generate_identity_theme(app_name, goal_text, datamodel, device=device)
        identity["generatedTheme"] = theme
    except IdentityThemeGenerationError as exc:
        print(f"[identity_theme_gen] generation failed, falling back to preset theme: {str(exc)[:200]}")
    return model
