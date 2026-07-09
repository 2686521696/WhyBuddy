"""可解释 AI 输出（加厚 schema 三期）。

运行应用里的 AI 能力从"直接写回"升级为"建议式"：试跑通道请求
LLM 返回结构化 {output, confidence, rationale}，前端渲染成建议卡
（建议值 + 置信度色条 + 理由），用户确认才写回行字段。

诚实边界：LLM 没按 JSON 返回时不造数字——parse_explained_output
返回 None，路由降级为纯文本输出（无 confidence/rationale 字段）；
confidence 超出 [0,1] 钳制，非数值剔除。灵感范本：GitHub Issue
自动分诊的"建议结果必须附带解释与置信度"。
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

# 追加在试跑 system prompt 后的结构化输出指令。
EXPLAIN_INSTRUCTION = (
    "输出必须是一个 JSON 对象（不要 markdown 围栏、不要多余文字）："
    '{"output": "<该能力应产出的内容本身>", '
    '"confidence": <0 到 1 的小数，你对这次输出质量的把握>, '
    '"rationale": "<一句话说明生成依据（用了哪些输入、做了什么判断）>"}'
)


def _json_candidates(raw: str):
    """整段 → 围栏块 → 花括号子串，三路尝试（与客户端解析同策略）。"""
    candidates = [raw.strip()]
    for m in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE):
        candidates.append(m.group(1).strip())
    first, last = raw.find("{"), raw.rfind("}")
    if 0 <= first < last:
        candidates.append(raw[first : last + 1])
    for text in candidates:
        try:
            parsed = json.loads(text)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            yield parsed


def parse_explained_output(content: Any) -> Optional[Dict[str, Any]]:
    """LLM 原文 → {output, confidence?, rationale?}；解析不出返回 None。

    output 必须是非空字符串（这是能力的真身，缺了整个解析作废）；
    confidence 钳制 [0,1]、非数值剔除；rationale 空串剔除。
    """
    for parsed in _json_candidates(str(content or "")):
        output = parsed.get("output")
        if not isinstance(output, str) or not output.strip():
            continue
        result: Dict[str, Any] = {"output": output.strip()}
        raw_conf = parsed.get("confidence")
        if isinstance(raw_conf, (int, float)) and not isinstance(raw_conf, bool):
            result["confidence"] = min(1.0, max(0.0, float(raw_conf)))
        rationale = str(parsed.get("rationale") or "").strip()
        if rationale:
            result["rationale"] = rationale
        return result
    return None
