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
    "synthesis.merge": (
        "You are SlideRule V5's deliberation-synthesis role. Given the user's goal and message, write a "
        "concise **markdown** convergence with three short sections: (1) synthesized conclusion, "
        "(2) remaining disagreements, (3) smallest next action. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "rebuttal.resolve": (
        "You are SlideRule V5's rebuttal-resolution role. Given the user's goal and message, write a "
        "concise **markdown** rebuttal response with three short sections: (1) response points, "
        "(2) unresolved disagreements, (3) suggested verification steps. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "counter.argue": (
        "You are SlideRule V5's counter-argument role. Given the user's goal and message, write a "
        "concise **markdown** counter-argument with three short sections: (1) counterpoints, "
        "(2) evidence gaps, (3) verifiable rebuttal path. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "structure.decompose": (
        "You are SlideRule V5's structure-decomposition role. Given the user's goal and message, write a "
        "concise **markdown** SPEC-tree decomposition with: (1) a root goal line, "
        "(2) child branches for requirements, risks, and deliverables (nested bullets), "
        "(3) evidenceRef notes on key branches. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "risk.analyze": (
        "You are SlideRule V5's risk-analysis role. Given the user's goal and message, write a "
        "concise **markdown** risk scan with three short sections: (1) risk inventory, "
        "(2) impact assessment, (3) mitigation paths. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
    "evidence.search": (
        "You are SlideRule V5's evidence-search role. Given the user's goal and message, write a "
        "concise **markdown** evidence brief with three short sections: (1) grounding references, "
        "(2) why each reference matters, (3) gaps that still need external retrieval. "
        "Stay strictly grounded in the user's actual goal. Do not invent an unrelated domain. "
        "Output markdown only: no JSON, no code fence, no preamble."
    ),
}

CAPABILITY_TITLES: dict[str, str] = {
    "intent.clarify": "Intent clarification",
    "gap.ask": "Gap questions",
    "question.expand": "Expanded questions",
    "critique.generate": "Structured critique",
    "synthesis.merge": "Synthesis merge",
    "rebuttal.resolve": "Rebuttal resolution",
    "counter.argue": "Counter argument",
    "structure.decompose": "Structure decomposition",
    "risk.analyze": "Risk analysis",
    "evidence.search": "Evidence search",
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


def _evidence_sources_from_content(content: str) -> list[dict[str, str]]:
    """Honest python-llm citations derived from model prose (not fake RAG retrieval)."""
    sources: list[dict[str, str]] = []
    for line in content.splitlines():
        snippet = line.strip().lstrip("-*#").strip()
        if len(snippet) < 12:
            continue
        sources.append({
            "title": snippet[:80],
            "snippet": snippet[:240],
            "provenance": "python-llm",
        })
        if len(sources) >= 4:
            break
    if not sources:
        sources.append({
            "title": "Grounded reasoning",
            "snippet": content[:240],
            "provenance": "python-llm",
        })
    return sources


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
    payload: dict[str, Any] = {
        "title": CAPABILITY_TITLES.get(capability_id, capability_id),
        "summary": _first_line(content),
        "content": content,
        "provenance": "python-llm",
        "model": result.model,
        "usage": result.usage,
    }
    if capability_id == "evidence.search":
        payload["sources"] = _evidence_sources_from_content(content)
    return payload
