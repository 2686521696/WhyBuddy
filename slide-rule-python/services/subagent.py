"""子代理：派一个**全新上下文**的代理独立干一件事，干完交回一段结论。对标 Claude Code 的 Task / Agent 工具。

⚠ 2026-10-05 真机 @doc-coauthoring 远程办公制度（sr-20261005085702-FCHJKG751E 与同题重跑）：技能 Stage 3 写的是
  「有子代理（如 Claude Code）就派一个没有上下文的新读者试读」。平台少的是「子代理」这件**通用原语**，
  上一版（reader_test）做成了只会试读的专用工具——那等于给一个技能的一个步骤造一件工具，下一个写「用子代理
  独立复核 / 并行调研」的技能照样没法跑。技能是流程、Agent 用通用原语执行；平台该补的是原语，不是流程。

子代理只拿到派它的那段任务说明，看不到当前对话；能用三件**只读**工具在工作区里自己查（读文件——Word / PPT 读
出正文——、列文件、搜内容），最多 MAX_ROUNDS 轮，交回最后一段文字。不能写文件、不能跑命令：派它出去的是
「看」和「想」，动手留给主代理（结果要回到主代理手里才有人负责）。

问模型那一发由调用方注入（ask），这个模块不碰 LLM 通道——超时、重试、熔断都在控制面那一份里。

⚠ 别跟 services/subagent_tasks 混：那是五系统工厂（v5 driver）里只读子任务的账本，只封装 evidence.search /
  page_quality 几种固定能力，不在控制面 Agent 循环里。这里是控制面的通用子代理。
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol

from services import model_images
from services.deliverable_kind import (
    TEXT_DELIVERABLE_EXTENSIONS,
    deliverable_suffix,
    is_text_deliverable_bytes,
    office_preview_payload,
)

MAX_ROUNDS = 8
MAX_READ_CHARS = 20_000
MAX_DOCUMENT_CHARS = 60_000
MAX_LISTED = 200
MAX_PROMPT_CHARS = 8_000


class Workspace(Protocol):
    """子代理看得见的工作区：源码树加交付文件。只读。"""

    def paths(self) -> List[str]: ...

    def read_text(self, path: str) -> Optional[str]: ...


def document_text(path: str, data: Optional[bytes] = None, text: Optional[str] = None) -> Optional[str]:
    """文件 → 读得懂的正文。文本原样；Word 取段落；PPT 取每页的字。读不出来返回 None（不编一份）。"""
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
        body = "\n\n".join(f"【第 {index} 页】\n{str(slide.get('text') or '') if isinstance(slide, dict) else ''}"
                           for index, slide in enumerate(payload.get("slides") or [], start=1))
    else:
        return None
    return body[:MAX_DOCUMENT_CHARS] or None


SUBAGENT_TOOLS: List[Dict[str, Any]] = [
    {"type": "function", "function": {
        "name": "read_file",
        "description": "读工作区里一份文件的正文（.docx / .pptx 读出文字）。长文件用 offset 往后翻。",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}, "offset": {"type": "integer", "minimum": 0}},
            "required": ["path"], "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "list_files",
        "description": "列出工作区里的文件路径。可给 contains 只看路径里含这段字的。",
        "parameters": {"type": "object", "properties": {"contains": {"type": "string"}},
                       "additionalProperties": False}}},
    {"type": "function", "function": {
        "name": "search_files",
        "description": "在工作区文件正文里找一段字，返回命中的文件和那一行。",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}},
                       "required": ["query"], "additionalProperties": False}}},
]


#: 看图（工作区能读图字节时才摆）：跟主循环同一条通道（services/model_images）。
#: ⚠ 2026-10-07 真机 r85 sr-20261007155747-HMKAPNJ7WK（@data-visualization-discipline 遮字测试）：主代理派子代理
#:   「独立遮字读图」，子代理只有读文本的工具——filesRead 是 README.md、draw_chart.py，filesMissing 是那张遮字 PNG，
#:   交回的却是「几何上可以确定：从左侧较低位置起步……斜率最陡」，主代理对用户说「已做独立读图复核」。没看图的读图结论
#:   是编的；技能要的「独立读者看遮字图」平台给不了。子代理也要能看图。
VIEW_IMAGE_TOOL: Dict[str, Any] = {"type": "function", "function": {
    "name": "view_image",
    "description": "看工作区里的一张图片（PNG / JPEG / GIF / WEBP）。图只在你下一次思考时附上；没看到图就别描述图里有什么。",
    "parameters": {"type": "object", "properties": {"path": {"type": "string"}},
                   "required": ["path"], "additionalProperties": False}}}


def subagent_tools(workspace: Any) -> List[Dict[str, Any]]:
    """这个工作区能读图字节（read_image）才多给一件 view_image。"""
    return SUBAGENT_TOOLS + ([VIEW_IMAGE_TOOL] if callable(getattr(workspace, "read_image", None)) else [])


def subagent_messages(prompt: str, attached: Dict[str, str]) -> List[Dict[str, Any]]:
    """子代理的开场：没有派它那段对话的任何一句，只有任务说明（和主代理点名附上的文件）。"""
    system = (
        "你是被派出去独立完成一件事的子代理。你看不到派你来的那段对话，也不认识用户；"
        "只凭下面的任务说明、附上的文件和你自己在工作区里读到的东西做判断。"
        "文件里没有的就直说没有，不要用常识替它补，也不要替作者圆。"
        "你只能看（read_file / list_files / search_files，能看图时还有 view_image），不能改。"
        "要你看图就用 view_image 真的看——没看到的图不要描述，照实说没看到。"
        "做完用一段话交回结论，结论要能直接被派你的人拿去用。"
    )
    body = str(prompt or "").strip()[:MAX_PROMPT_CHARS]
    for path, text in attached.items():
        body += f"\n\n<file path=\"{path}\">\n{text}\n</file>"
    return [{"role": "system", "content": system}, {"role": "user", "content": body}]


def run_subagent_tool(workspace: Workspace, name: str, args: Dict[str, Any]) -> str:
    """执行子代理的一件只读工具，结果是一段给它看的文字。读不到照实说。"""
    if name == "read_file":
        path = str(args.get("path") or "").strip()
        text = workspace.read_text(path)
        if text is None:
            return f"读不到 {path}：工作区里没有这份文件，或它不是能读出正文的格式。可以先 list_files 看看有哪些。"
        offset = max(0, int(args.get("offset") or 0))
        part = text[offset:offset + MAX_READ_CHARS]
        more = f"\n（还有 {len(text) - offset - len(part)} 字，用 offset={offset + len(part)} 接着读）" \
            if offset + len(part) < len(text) else ""
        return part + more
    if name == "list_files":
        needle = str(args.get("contains") or "")
        hits = [p for p in workspace.paths() if needle in p]
        return "\n".join(hits[:MAX_LISTED]) or "（没有匹配的文件）"
    if name == "search_files":
        query = str(args.get("query") or "").strip()
        if not query:
            return "query 不能为空。"
        rows: List[str] = []
        for path in workspace.paths():
            text = workspace.read_text(path) or ""
            for line in text.splitlines():
                if query in line:
                    rows.append(f"{path}: {line.strip()[:200]}")
                    if len(rows) >= 40:
                        return "\n".join(rows)
        return "\n".join(rows) or f"（没有找到「{query}」）"
    return f"没有 {name} 这件工具。能用的是 read_file / list_files / search_files。"


Ask = Callable[[List[Dict[str, Any]], List[Dict[str, Any]]], Awaitable[Any]]


async def run_subagent(ask: Ask, workspace: Workspace, prompt: str, files: Optional[List[str]] = None) -> Dict[str, Any]:
    """跑一个子代理到它交回结论（或用完轮数）。ask(messages, tools) 是控制面问模型的那一发。"""
    attached: Dict[str, str] = {}
    missing: List[str] = []
    for path in (files or [])[:5]:
        text = workspace.read_text(str(path))
        if text is None:
            missing.append(str(path))
        else:
            attached[str(path)] = text
    messages = subagent_messages(prompt, attached)
    read: List[str] = list(attached)
    tools = subagent_tools(workspace)
    images: List[Dict[str, str]] = []          # 这一轮要附给它看的图：只拼进下一次请求，不进 messages（model_images 头注）
    for round_index in range(1, MAX_ROUNDS + 1):
        request = messages + [model_images.image_message(images)] if images else messages
        try:
            result = await ask(request, tools)
        except Exception as exc:
            # 收不了图（纯文本兜底模型 / 网关拒 image_url）：去掉图重问一次，照实告诉它没看到（§七）。
            if not images or getattr(exc, "transient", True):
                raise
            result = await ask(messages + [model_images.refused_message(images)], tools)
        images = []
        calls = list(getattr(result, "tool_calls", None) or [])
        content = str(getattr(result, "content", "") or "")
        if not calls:
            if not content.strip():
                return {"ok": False, "error": "子代理没有交回任何内容。", "rounds": round_index, "filesRead": read}
            return {"ok": True, "result": content, "rounds": round_index, "filesRead": read,
                    **({"filesMissing": missing} if missing else {})}
        messages.append({"role": "assistant", "content": content, "tool_calls": [
            {"id": str(call.get("id")), "type": "function", "function": {
                "name": str(call.get("name")), "arguments": json.dumps(call.get("arguments") or {}, ensure_ascii=False)}}
            for call in calls]})
        for call in calls:
            args = call.get("arguments") if isinstance(call.get("arguments"), dict) else {}
            if call.get("name") in ("read_file", "view_image") and args.get("path") and str(args["path"]) not in read:
                read.append(str(args["path"]))
            if call.get("name") == "view_image" and callable(getattr(workspace, "read_image", None)):
                path = str(args.get("path") or "").strip()
                data = workspace.read_image(path)
                summary, image = model_images.prepare(data, path) if data is not None else (
                    {"ok": False, "error": "file_not_found", "human": f"工作区里没有 {path} 这张图。"}, None)
                if image is not None:
                    images.append(image)
                else:
                    missing.append(path)
                reply = json.dumps(summary, ensure_ascii=False)
            else:
                reply = run_subagent_tool(workspace, str(call.get("name")), args)
            messages.append({"role": "tool", "tool_call_id": str(call.get("id")), "content": reply})
    return {"ok": False, "error": f"子代理在 {MAX_ROUNDS} 轮内没有交回结论。", "rounds": MAX_ROUNDS, "filesRead": read}
