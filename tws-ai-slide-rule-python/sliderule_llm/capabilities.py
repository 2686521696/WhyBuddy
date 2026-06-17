"""
Real capability execution for the Python V5 backend — replaces the canned `rag_service` brain.

execute_capability() builds a per-capability prompt and makes a REAL LLM call via client.call_llm
(httpx → the configured endpoint, e.g. su8/rcouyi). Returns the V5 capability shape
{title, summary, content, provenance, model, usage}. provenance is "python-llm" (honest: a real model
call, NOT retrieval) so it is distinguishable from the old fake "python-rag" stub.

Dialogue-family caps emit MARKDOWN prose (not a strict JSON schema): reasoning models (e.g. rcouyi's
gemini) reliably write grounded markdown but routinely ignore an exact JSON shape, so we package the
prose into the V5 fields ourselves rather than depending on the model obeying a schema.

Only capabilities listed in CAPABILITY_PROMPTS are "really migrated"; anything else raises
UnsupportedCapability so the caller can fall back (we migrate one slice at a time).
"""
from __future__ import annotations

import re
from typing import Any, Callable

from .client import LlmError, LlmResult, call_llm_with_retry


class UnsupportedCapability(Exception):
    pass


CAPABILITY_PROMPTS: dict[str, str] = {
    "intent.clarify": (
        "You are SlideRule V5's intent-clarification role. Given the user's goal and message, write a "
        "concise **markdown** clarification with three short sections: (1) restated goal, "
        "(2) implicit assumptions, (3) key open questions to resolve before planning. "
        "Stay strictly grounded in the user's actual goal — do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "gap.ask": (
        "You are SlideRule V5's gap-discovery role. Given the user's goal and message, write a "
        "concise **markdown** gap analysis with three short sections: (1) missing information, "
        "(2) why each gap matters, (3) the smallest set of questions to ask next. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "question.expand": (
        "You are SlideRule V5's question-expansion role. Given the user's goal and rough question, write a "
        "concise **markdown** expansion with three short sections: (1) expanded questions, "
        "(2) why those questions matter, (3) suggested answer format for the user. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "critique.generate": (
        "You are SlideRule V5's structured-critique role. Given the user's goal and message, write a "
        "concise **markdown** critique with three short sections: (1) critique points, "
        "(2) risks, (3) minimal verification steps. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
}

CAPABILITY_TITLES: dict[str, str] = {
    "intent.clarify": "Intent clarification",
    "gap.ask": "Gap questions",
    "question.expand": "Expanded questions",
    "critique.generate": "Structured critique",
}


def is_python_native_capability(capability_id: str) -> bool:
    return capability_id in CAPABILITY_PROMPTS


def build_messages(capability_id: str, body: dict[str, Any]) -> list[dict[str, str]]:
    system = CAPABILITY_PROMPTS.get(capability_id)
    if not system:
        raise UnsupportedCapability(capability_id)
    state = body.get("state") or {}
    goal = ((state.get("goal") or {}).get("text") or "").strip()
    user_text = (body.get("userText") or "").strip()
    user = (
        f"GOAL: {goal or '(none stated)'}\n"
        f"USER_MESSAGE: {user_text or '(none)'}\n"
        f"ROLE: {body.get('roleId', 'agent')}  TURN: {body.get('turnId', '')}\n\n"
        "Write the markdown now."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


_FENCE = re.compile(r"^\s*```[a-z]*\s*\n?|\n?\s*```\s*$", re.IGNORECASE)


def _clean(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = _FENCE.sub("", t).strip()
    return t


def _first_line(text: str, limit: int = 120) -> str:
    for line in text.splitlines():
        s = line.strip().lstrip("#").strip()
        if s:
            return s[:limit]
    return ""


def execute_capability(
    body: dict[str, Any],
    *,
    caller: Callable[..., LlmResult] | None = None,
    max_tokens: int = 2000,
) -> dict[str, Any]:
    """Run one capability via a REAL LLM call. Raises UnsupportedCapability / LlmError on failure
    (caller decides fallback). `caller` is injectable for deterministic unit tests."""
    capability_id = body.get("capabilityId")
    if not is_python_native_capability(capability_id):
        raise UnsupportedCapability(str(capability_id))

    messages = build_messages(capability_id, body)
    llm_caller = caller or call_llm_with_retry
    result = llm_caller(messages, max_tokens=max_tokens)

    content = _clean(result.content)
    if not content:
        raise LlmError("python backend produced empty capability content", transient=False)
    return {
        "title": CAPABILITY_TITLES.get(capability_id, capability_id),
        "summary": _first_line(content),
        "content": content,
        "provenance": "python-llm",
        "model": result.model,
        "usage": result.usage,
    }
