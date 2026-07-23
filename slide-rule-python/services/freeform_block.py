"""
FreeformInsight 区块的结构化生成与校验（2026-07-23，实验三 Pydantic + reask
机制生产化，记录见 docs/freeform-llm-generation-experiment-2026-07-23.md）。

不引入 instructor 包——本仓网关已经真机验证过会撞 WAF UA 拦截 + Cloudflare
524（docs/OSS_GAP_ANALYSIS.md），instructor SDK 栈默认用 openai SDK 的非流式
HTTP 客户端，两条都会撞。改成在 sliderule_llm.structured 的流式 reask 骨架
（call_llm_with_retry + on_delta 强制流式）上，加一层 Pydantic 深校验——原来
structured_llm_json 只做 shape 级校验（JSON 能解析 + 必需字段非空），这里补
到"标签/样式/图标在白名单内 + 数字类内容必须挂 dataRef 指向真实数据"。

安全边界：LLM 只产出数据（标签/样式/文字/图标引用/dataRef），永远不会被当
代码执行；渲染端只用安全 API 拼装（React createElement），不用 dangerouslySet
InnerHTML/eval。压力测试实测：模型第一次交上来的东西几乎从不完全合规，这层
校验不是极端情况下的兜底，是正常路径。

分层：本模块只管"一个 FreeformInsight 区块的内容"生成与校验，跟
v5_model_gate 校验整个五系统模型是两回事——调用方在重试耗尽时应该把这个
区块降级/拿掉，不能让一个装饰性区块的生成失败拖垮整个应用发布。
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .schema_legal import (
    FREEFORM_ALLOWED_ICON_REFS,
    FREEFORM_ALLOWED_STYLE_PROPS,
    FREEFORM_ALLOWED_TAGS,
)

_DANGEROUS_VALUE_RE = re.compile(r"url\(|javascript:|expression\(|import\b|@import", re.I)


class FreeformGenerationError(RuntimeError):
    """FreeformInsight 内容生成/校验失败（调用方应把这个区块降级/拿掉）。"""


def _entity_index(datamodel: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    entities = {e.get("id"): e for e in datamodel.get("entities", []) if e.get("id")}
    field_types: dict[str, str] = {}
    for e in datamodel.get("entities", []):
        eid = e.get("id")
        if not eid:
            continue
        for f in e.get("fields", []):
            fid = f.get("id")
            if fid:
                field_types[f"{eid}.{fid}"] = f.get("type")
    return entities, field_types


def build_freeform_models(datamodel: dict[str, Any]) -> type[BaseModel]:
    """按当轮真实数据模型闭包构建 Pydantic 模型——DataRef.entityRef/aggregate
    的校验需要知道"真实存在哪些实体/字段"，每轮数据模型不同，模型也要重建。
    """
    entities, field_types = _entity_index(datamodel)

    class DataRef(BaseModel):
        entityRef: str
        aggregate: Optional[str] = None

        @field_validator("entityRef")
        @classmethod
        def check_entity(cls, v: str) -> str:
            if v not in entities:
                raise ValueError(
                    f"entityRef '{v}' does not exist. Real entities are: {list(entities.keys())}"
                )
            return v

        @model_validator(mode="after")
        def check_aggregate(self) -> "DataRef":
            if self.aggregate and self.aggregate != "count":
                prefix, sep, field_id = self.aggregate.partition(":")
                if not sep or prefix not in ("sum", "avg"):
                    raise ValueError(
                        "aggregate must be 'count', 'sum:<fieldId>', or 'avg:<fieldId>'"
                    )
                qualified = f"{self.entityRef}.{field_id}"
                if qualified not in field_types:
                    raise ValueError(
                        f"field '{field_id}' does not exist on entity '{self.entityRef}'"
                    )
                if field_types[qualified] != "number":
                    raise ValueError(
                        f"field '{field_id}' on '{self.entityRef}' is type "
                        f"'{field_types[qualified]}', aggregate requires a number field"
                    )
            return self

    class FreeformNode(BaseModel):
        tag: str
        style: dict[str, str] = Field(default_factory=dict)
        text: Optional[str] = None
        iconRef: Optional[str] = None
        dataRef: Optional[DataRef] = None
        children: list["FreeformNode"] = Field(default_factory=list)

        @field_validator("tag")
        @classmethod
        def check_tag(cls, v: str) -> str:
            if v not in FREEFORM_ALLOWED_TAGS:
                raise ValueError(
                    f"tag '{v}' is not allowed. Allowed tags: {list(FREEFORM_ALLOWED_TAGS)}"
                )
            return v

        @field_validator("style")
        @classmethod
        def check_style(cls, v: dict[str, str]) -> dict[str, str]:
            for k, val in v.items():
                if k not in FREEFORM_ALLOWED_STYLE_PROPS:
                    raise ValueError(f"style property '{k}' is not in the allowed list")
                if _DANGEROUS_VALUE_RE.search(str(val)):
                    raise ValueError(f"style value for '{k}' contains a disallowed pattern: {val}")
            return v

        @field_validator("iconRef")
        @classmethod
        def check_icon(cls, v: Optional[str]) -> Optional[str]:
            if v is not None and v not in FREEFORM_ALLOWED_ICON_REFS:
                raise ValueError(f"iconRef '{v}' is not in the allowed list")
            return v

    FreeformNode.model_rebuild()

    class FreeformDesign(BaseModel):
        root: FreeformNode

    return FreeformDesign


def build_freeform_prompt(design_brief: str, datamodel: dict[str, Any]) -> str:
    return f"""你是一名前端视觉设计师。设计一个可视化组件：{design_brief}
要有视觉创意和现代感，大胆用间距、层次、颜色对比、图标去表达内容。

只能用安全原子积木拼：{", ".join(FREEFORM_ALLOWED_TAGS)} 标签；
图标引用只能用这些：{json.dumps(list(FREEFORM_ALLOWED_ICON_REFS), ensure_ascii=False)}；
颜色用具体十六进制值，背景可用 linear-gradient(...)，不能出现 url(...)。

下面是这个应用真实的数据模型，唯一可以引用的数据来源：
{json.dumps(datamodel, ensure_ascii=False, indent=2)}

凡是设计里出现的具体数字/统计类文字，必须挂 dataRef 指向真实存在的
entity+field。数据模型里没有合适字段支撑的数字就不要画，不能编。
纯装饰性文案不需要 dataRef。

注意：children 数组里每一项都必须是完整的节点对象（有 tag 字段），
不能直接放字符串当子节点——文字内容一律放在节点的 text 字段里。

输出严格 JSON：{{"root": {{"tag": "div", "style": {{}}, "children": [...]}}}}
只输出这一个 JSON 对象，不要解释文字，不要 markdown 代码围栏。"""


def _build_reference_image_prompt(design_brief: str) -> str:
    return (
        f"为一个应用界面区块生成一张 UI 参考效果图（干净原型图）。设计需求：{design_brief}。"
        "要求：只示意版式与配色，不要写任何具体数字/真实数据，占位文案用「示例XX」这类通用字样；"
        "浅色专业仪表盘风格——白色/浅灰背景，单一强调色克制使用，卡片白底细边框，图标简洁线性，"
        "留白节奏舒展；不要出现任何多余的装饰性水印或品牌字样。"
    )


def _generate_reference_image_b64(design_brief: str) -> Optional[str]:
    """生图当参照——加分项，不是必需项。未配置 IMAGE_API_KEY 或生图失败都
    静默降级为 None，绝不能让这一步拖垮 FreeformInsight 主生成路径。图片
    只在本次调用内临时使用（喂给下面的视觉 LLM 看一眼），不落盘、不进产物、
    不展示给终端用户——它上面的"数字"都是占位假象，不能当真实数据源。
    """
    try:
        from sliderule_llm.image_client import ImageGenError, generate_image_png
    except Exception:
        return None
    try:
        png_bytes = generate_image_png(_build_reference_image_prompt(design_brief), size="1024x1024")
    except ImageGenError as exc:
        print(f"[freeform_block] reference image skipped: {str(exc)[:160]}")
        return None
    except Exception as exc:  # noqa: BLE001 — 生图失败绝不能拖垮主链路
        print(f"[freeform_block] reference image skipped (unexpected): {str(exc)[:160]}")
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def generate_freeform_block(
    design_brief: str,
    datamodel: dict[str, Any],
    *,
    max_retries: int = 2,
    temperature: float = 0.7,
    max_tokens: int = 7000,
    use_reference_image: bool = True,
) -> dict[str, Any]:
    """生成 + 深校验一个 FreeformInsight 区块的内容树。校验失败时把「上次
    输出 + 具体报错」拼回消息重问（跟 structured_llm_json 同一套 reask 语义，
    这里额外插入 Pydantic 深校验，不只是 shape 校验）。重试耗尽抛
    FreeformGenerationError，调用方应把这个区块降级/拿掉，不能让它拖垮
    整个应用发布。

    use_reference_image=True（默认）时先生一张干净原型图当视觉参照，喂给
    视觉 LLM 一起看（需要网关声明 LLM_SUPPORTS_IMAGE_CONTENT_PARTS=1，未声明
    或生图不可用时自动降级为纯文字生成，行为与加这段之前完全一致）。
    """
    design_brief = (design_brief or "").strip()
    if not design_brief:
        raise FreeformGenerationError("designBrief is empty")

    from sliderule_llm.client import LlmError, call_llm_with_retry
    from sliderule_llm.config import get_llm_config

    FreeformDesign = build_freeform_models(datamodel)
    prompt_text = build_freeform_prompt(design_brief, datamodel)

    reference_image_b64: Optional[str] = None
    if use_reference_image and get_llm_config().supports_image_content_parts:
        reference_image_b64 = _generate_reference_image_b64(design_brief)

    if reference_image_b64:
        first_content: Any = [
            {
                "type": "text",
                "text": prompt_text
                + "\n\n下面这张图是这个设计需求的参考效果图：版式布局、配色克制程度、"
                "留白节奏照着这张图的风格来。但图上任何看起来像数字/统计的内容都只是"
                "占位假象，绝不能照抄或参考它的具体数值——真实数字仍然只能来自上面给出的"
                "数据模型，并挂 dataRef。",
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
                on_delta=lambda _chunk: None,  # 强制流式，免疫 CF 524（跟 structured_llm_json 同招）
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
                {"role": "assistant", "content": raw[:6000]},
                {"role": "user", "content": f"你上次的输出不是合法 JSON：{last_error}。请重新输出，只要一个 JSON 对象。"},
            ]
            continue

        try:
            design = FreeformDesign.model_validate(payload)
            return design.model_dump()
        except ValidationError as exc:
            last_error = str(exc)[:1200]
            convo = convo + [
                {"role": "assistant", "content": raw[:6000]},
                {
                    "role": "user",
                    "content": (
                        f"你上次的输出没有通过校验，具体错误：\n{last_error}\n"
                        "请仔细检查：children 数组每一项必须是完整节点对象（不能是裸字符串）、"
                        "tag/style 属性/iconRef 必须在允许的白名单内、dataRef 引用的实体和字段"
                        "必须真实存在且类型对得上。重新输出完整的 JSON，只要一个 JSON 对象。"
                    ),
                },
            ]

    raise FreeformGenerationError(f"exhausted {max_retries + 1} attempts, last error: {last_error}")


def enrich_freeform_blocks(model: dict[str, Any]) -> dict[str, Any]:
    """主模型过 Gate 之后，同一次「生成」体验里紧接着跑的第二段——扫描
    page.blocks 里的 FreeformInsight，逐个生成+校验内容树，写回
    block["freeformContent"]。生成失败（重试耗尽）的区块直接从
    page.blocks 和 page.layout 的槽位引用里一并摘掉，如实降级，不让一个
    装饰性区块的生成失败拖垮整个应用发布（fail-closed 的口径延伸到区块
    级）。原地修改并返回同一个 model，方便调用方链式使用。
    """
    datamodel = model.get("datamodel") or {}
    for page in (model.get("page") or {}).get("pages") or []:
        blocks = page.get("blocks")
        if not isinstance(blocks, list):
            continue
        dropped_ids: set[str] = set()
        for block in blocks:
            if not isinstance(block, dict) or block.get("type") != "FreeformInsight":
                continue
            brief = str((block.get("props") or {}).get("designBrief") or "").strip()
            bid = str(block.get("id") or "").strip()
            try:
                content = generate_freeform_block(brief, datamodel)
                block["freeformContent"] = content
            except FreeformGenerationError as exc:
                print(f"[freeform_block] {page.get('id')}.{bid} generation failed, dropping block: {str(exc)[:200]}")
                if bid:
                    dropped_ids.add(bid)
        if dropped_ids:
            page["blocks"] = [b for b in blocks if str(b.get("id") or "") not in dropped_ids]
            layout = page.get("layout")
            if isinstance(layout, dict):
                for slot_key, refs in list(layout.items()):
                    if isinstance(refs, list):
                        layout[slot_key] = [r for r in refs if r not in dropped_ids]
    return model
