"""把控制面 messages 压回上下文窗口，好让同一回合继续采样。

## 两件事别混

`cheapTokens` 是**累计花费**（每一发 input+output 加起来）。上下文占用是
**这一发 messages 有多长**。本仓 `control_budget.py` 头注从 grok 就写着
spend ledger ≠ compaction threshold。2026-09-15 TicketStream 把前者当硬闸，
读了几份源码就 64000 停死；窗口其实远没满。

## 抄谁

成熟 agent 都是「窗口快满 → 压历史 → 同一条任务接着干」，不是加额度硬停：

- OpenHands `LLMSummarizingCondenser`
  https://github.com/OpenHands/software-agent-sdk
- Anthropic cookbook / Claude Agent SDK `compaction_control`
  https://platform.claude.com/cookbook/tool-use-automatic-context-compaction
- Cline Auto Compact（先规划/待办常驻，窗口边缘再整段摘要）
- Claude Code 分层：先 microcompact / snip 工具结果，再 session-memory，
  最后才整段 summary compact
- 本仓已经抄过 grok `intra_compaction/fit.rs` 第 2 级（单条工具结果封顶）

本模块先做 Claude / grok 那一层 **snip**：折叠较早的 tool 正文，保留系统
提示、用户目标、最近几条工具结果。不另发一轮 LLM 做摘要——压缩是增强，
摘要模型自己超时不该把主任务掐死（§7 fail-open）；压完仍超窗口才 token_budget
（证据类 fail-closed）。

口径跟 grok 一样：`max_bytes = max_tokens * 4`，占用 = 序列化字符数 / 4。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Sequence, Tuple

COMPACT_NOTICE_PREFIX = "【会话压缩】"
_TOOL_STUB = json.dumps(
    {"compacted": True, "note": "较早的工具输出已折叠，需要时请重新读取文件。"},
    ensure_ascii=False,
)
#: 最近几条工具结果先留着——下一发 patch 往往还要用。
_KEEP_TAIL_TOOLS = 2


@dataclass(frozen=True)
class CompactReport:
    did_compact: bool
    folded: int
    tokens_before: int
    tokens_after: int
    folded_tools: Tuple[str, ...] = ()


def estimate_message_tokens(messages: Sequence[Any]) -> int:
    raw = json.dumps(messages, ensure_ascii=False, default=str)
    return max(0, (len(raw) + 3) // 4)


def is_compact_notice(message: Any) -> bool:
    if not isinstance(message, dict):
        return False
    if message.get("role") != "system":
        return False
    return str(message.get("content") or "").startswith(COMPACT_NOTICE_PREFIX)


def _tool_name(messages: Sequence[Dict[str, Any]], index: int) -> str:
    call_id = str(messages[index].get("tool_call_id") or "")
    for row in messages[:index]:
        if not isinstance(row, dict) or row.get("role") != "assistant":
            continue
        for call in row.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            fn = call.get("function") if isinstance(call.get("function"), dict) else {}
            cid = str(call.get("id") or fn.get("id") or "")
            name = str(call.get("name") or fn.get("name") or "").strip()
            if cid == call_id and name:
                return name
    return "tool"


def _notice(folded: int, tokens_after: int, max_tokens: int, tools: Sequence[str]) -> Dict[str, Any]:
    names = "、".join(tools[:8]) if tools else "工具输出"
    extra = "…" if len(tools) > 8 else ""
    text = (
        f"{COMPACT_NOTICE_PREFIX}窗口占用已压到 {tokens_after}/{max_tokens} token"
        f"（折叠 {folded} 条：{names}{extra}）。"
        "源码以工程里的为准，需要哪份就再读；按未完成待办继续，不要重做已完成的步骤。"
    )
    return {"role": "system", "content": text}


def compact_messages(
    messages: Sequence[Any],
    *,
    max_tokens: int,
    compact_at_tokens: int,
) -> Tuple[List[Dict[str, Any]], CompactReport]:
    """占用 ≥ compact_at 就把较早的 tool 正文换成短桩，目标压到窗口一半附近。

    不删消息、不拆 tool_call / tool 配对——只改 content。变异：如果变成
    no-op，占用仍超阈值，活路径那条会停成 token_budget 而不是继续采样。
    """
    source = [dict(row) if isinstance(row, dict) else {"role": "user", "content": str(row)}
              for row in messages]
    before = estimate_message_tokens(source)
    empty = CompactReport(False, 0, before, before)
    if compact_at_tokens <= 0 or before < compact_at_tokens or max_tokens <= 0:
        return source, empty

    out = [row for row in source if not is_compact_notice(row)]
    tool_indices = [i for i, row in enumerate(out) if row.get("role") == "tool"]
    protected = set(tool_indices[-_KEEP_TAIL_TOOLS:])
    target = max(1, min(compact_at_tokens - 1, max_tokens // 2))
    folded_names: List[str] = []

    def stub(index: int) -> None:
        row = out[index]
        content = str(row.get("content") or "")
        if len(content) <= len(_TOOL_STUB) + 8:
            return
        folded_names.append(_tool_name(out, index))
        row["content"] = _TOOL_STUB

    for index in tool_indices:
        if estimate_message_tokens(out) <= target:
            break
        if index in protected:
            continue
        stub(index)

    if estimate_message_tokens(out) > target:
        for index in tool_indices:
            if estimate_message_tokens(out) <= target:
                break
            stub(index)

    after = estimate_message_tokens(out)
    if not folded_names:
        return source, CompactReport(False, 0, before, before)

    insert_at = 1 if out and out[0].get("role") == "system" else 0
    noticed = list(out)
    noticed.insert(insert_at, _notice(len(folded_names), after, max_tokens, folded_names))
    after = estimate_message_tokens(noticed)
    return noticed, CompactReport(True, len(folded_names), before, after, tuple(folded_names))
