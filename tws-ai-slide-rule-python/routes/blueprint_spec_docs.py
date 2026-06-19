"""Minimal Blueprint spec-docs proxy endpoint.

This is a contract slice, not the full Blueprint migration. Node still owns
batch orchestration, artifacts, progress events, review, and export.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException

from config.settings import settings


router = APIRouter(tags=["Blueprint spec-docs proxy"])

SUPPORTED_TYPES = {"requirements", "design", "tasks"}
PROMPT_ID = "blueprint.spec-documents.v1"


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


def _digest(payload: Any) -> str:
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _clean_text(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback


def _safe_slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:64] or "section"


def _build_markdown(doc_type: str, node_title: str, node_summary: str, target_text: str) -> tuple[str, str, str]:
    label = {
        "requirements": "Requirements",
        "design": "Design",
        "tasks": "Tasks",
    }[doc_type]
    title = f"{label}: {node_title}"
    summary = f"{label} document for {node_title}."
    body_sections = [
        (
            "Context",
            f"- Target: {target_text}\n- Node: {node_title}\n- Summary: {node_summary}",
        ),
        (
            "Acceptance",
            f"- The {doc_type} document stays grounded in the requested Blueprint node.\n"
            "- Node remains owned by the Node Blueprint pipeline for artifacts and events.",
        ),
    ]
    content = f"# {title}\n\n{summary}\n\n"
    for section_title, body in body_sections:
        content += f"## {section_title}\n\n{body}\n\n"
    return title, summary, content.rstrip() + "\n"


@router.post("/generate-one")
async def generate_one(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)

    doc_type = _clean_text(payload.get("targetDocumentType"), "")
    if doc_type not in SUPPORTED_TYPES:
        raise HTTPException(400, "targetDocumentType must be requirements, design, or tasks")

    node = payload.get("specTreeNode")
    if not isinstance(node, dict):
        raise HTTPException(400, "specTreeNode is required")
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}

    node_title = _clean_text(node.get("title"), "Untitled node")
    node_summary = _clean_text(node.get("summary"), "No summary provided")
    target_text = _clean_text(request.get("targetText"), "No target text provided")

    title, summary, content = _build_markdown(doc_type, node_title, node_summary, target_text)
    fingerprint_payload = {
        "promptId": PROMPT_ID,
        "targetDocumentType": doc_type,
        "nodeId": node.get("id"),
        "nodeTitle": node_title,
        "targetText": target_text,
        "sectionSeed": _safe_slug(node_title),
    }

    return {
        "generationSource": "llm",
        "title": title,
        "summary": summary,
        "content": content,
        "status": "draft",
        "promptId": PROMPT_ID,
        "model": "python-blueprint-spec-docs-contract",
        "promptFingerprint": _digest(fingerprint_payload),
        "responseDigest": _digest({"title": title, "summary": summary, "content": content}),
    }
