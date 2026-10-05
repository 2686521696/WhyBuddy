"""无上下文读者：一份文档交给**没看过这次对话**的读者，只凭文档回答问题。

⚠ 2026-10-05 真机 @doc-coauthoring 远程办公制度（sr-20261005085702-FCHJKG751E、r23 同题重跑）：计划把
  「Stage 3: Reader Testing：以全体员工首次阅读场景检查关键问题是否可回答」落了位，开工时宿主也把这句原话
  摆了回去——两轮执行都没做。技能原文要的是「用一个没有上下文的新 Claude（sub-agent）试读」，退路是让用户
  自己去另一个对话里试；平台没有这件工具，模型每次都把它当成做不了、跳过去。
  作者自己读，总会不自觉地用对话里的背景把空白补上；新读者卡住的地方，真读者多半也卡住。

这个模块只管两件纯事：把交付文件变成读者看的正文、拼出读者那一发的消息。真正问模型在
rehearsal_control（控制面的 LLM 通道、超时与重试都在那里）。
"""

from __future__ import annotations

from typing import Any, List, Optional

from services.deliverable_kind import (
    TEXT_DELIVERABLE_EXTENSIONS,
    deliverable_suffix,
    is_text_deliverable_bytes,
    office_preview_payload,
)

#: 交给读者的正文上限。再长的文档也只是「一个读者第一次读」，不是检索。
MAX_DOCUMENT_CHARS = 60_000
MAX_QUESTIONS = 10


def reader_document_text(path: str, data: Optional[bytes] = None, text: Optional[str] = None) -> Optional[str]:
    """读者看到的正文。文本文件原样；Word 取段落；PPT 取每页的字。读不出来返回 None（不编一份）。"""
    if text is not None:
        return str(text)[:MAX_DOCUMENT_CHARS] or None
    if not isinstance(data, (bytes, bytearray)):
        return None
    suffix = deliverable_suffix(path)
    if suffix in TEXT_DELIVERABLE_EXTENSIONS:
        return bytes(data).decode("utf-8-sig")[:MAX_DOCUMENT_CHARS] if is_text_deliverable_bytes(data) else None
    payload = office_preview_payload(bytes(data), path)
    if not isinstance(payload, dict):
        return None
    if payload.get("kind") == "document":
        body = "\n".join(str(p) for p in payload.get("paragraphs") or []) or str(payload.get("text") or "")
    elif payload.get("kind") == "slides":
        pages = []
        for index, slide in enumerate(payload.get("slides") or [], start=1):
            words = str(slide.get("text") or "") if isinstance(slide, dict) else ""
            pages.append(f"【第 {index} 页】\n{words}")
        body = "\n\n".join(pages)
    else:
        return None
    return body[:MAX_DOCUMENT_CHARS] or None


def clean_questions(raw: Any) -> List[str]:
    """问题清单：去空、去重、截长，最多 10 条。"""
    out: List[str] = []
    for item in raw if isinstance(raw, list) else []:
        text = str(item or "").strip()[:300]
        if text and text not in out:
            out.append(text)
    return out[:MAX_QUESTIONS]


def reader_messages(document: str, questions: List[str], reader: str = "") -> List[dict]:
    """读者那一发：只有文档和问题，没有这次对话的任何一句。"""
    who = str(reader or "").strip()[:80] or "这份文档的目标读者"
    system = (
        f"你是第一次拿到这份文档的读者（{who}）。你没参与它的写作，也不认识作者。"
        "只根据文档本身回答；文档里没写的就直说没写，不要用常识替它补，也不要替作者圆。"
    )
    asked = "\n".join(f"{index}. {question}" for index, question in enumerate(questions, start=1))
    user = (
        f"<document>\n{document}\n</document>\n\n"
        f"请逐条回答：\n{asked}\n\n"
        "每条给三样：答（只凭文档）／哪里含糊或找不到／文档默认我已经知道什么。\n"
        "最后另起一段「整体」：整份文档里含糊、自相矛盾、需要背景知识才看得懂的地方。"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
