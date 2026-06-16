"""
LLM config + wire selection — port of server/core/ai-config.ts.

Reads the SAME env vars as the Node app so a single .env drives both during migration.
Stdlib-only (no pydantic) so it can be unit-tested without any third-party deps.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

# ── env helpers ───────────────────────────────────────────────────────────────

def _pick(*names: str) -> str | None:
    """First non-empty env var among names (mirrors ai-config pickProviderValue)."""
    for n in names:
        v = os.environ.get(n)
        if v is not None and v != "":
            return v
    return None


def _int(v: str | None, default: int) -> int:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return default


def _bool(v: str | None, default: bool = False) -> bool:
    if v is None or v == "":
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _csv(v: str | None) -> tuple[str, ...]:
    return tuple(s.strip() for s in (v or "").split(",") if s.strip())


# ── wire selection (port of ai-config.ts:104-121) ─────────────────────────────

_REASONING_MODEL_RE = re.compile(r"gpt-5|gpt5|o[0-3]|thinking|reasoning", re.IGNORECASE)


def select_wire_api(raw_wire: str | None, model: str, reasoning_effort: str | None) -> str:
    """
    Decide 'chat_completions' vs 'responses'.

    Matches the (fixed) ai-config behaviour:
      - explicit 'responses'        → responses
      - explicit 'chat_completions' → chat_completions  (HONORED as-is; do NOT auto-upgrade —
        some providers like rcouyi only implement /chat/completions and 501 on /responses)
      - unset → reasoning models (gpt-5.x / o-series / thinking) default to 'responses',
        otherwise 'chat_completions'
    """
    has_reasoning = bool(
        reasoning_effort and reasoning_effort.strip() and reasoning_effort.strip().lower() != "none"
    )
    is_reasoning_model = bool(_REASONING_MODEL_RE.search(model or ""))
    rw = (raw_wire or "").strip().lower()
    if rw == "responses":
        return "responses"
    if rw == "chat_completions":
        return "chat_completions"
    return "responses" if (has_reasoning and is_reasoning_model) else "chat_completions"


# ── high-level (primary) config ───────────────────────────────────────────────

@dataclass(frozen=True)
class LlmConfig:
    api_key: str
    base_url: str
    model: str
    wire_api: str  # "chat_completions" | "responses"
    reasoning_effort: str | None
    timeout_ms: int
    stream: bool
    unlimited_models: tuple[str, ...]


def get_llm_config() -> LlmConfig:
    base = (_pick("LLM_BASE_URL", "OPENAI_BASE_URL") or "").rstrip("/")
    model = _pick("LLM_MODEL", "OPENAI_MODEL") or "gpt-5.5"
    reasoning = _pick("LLM_REASONING_EFFORT", "OPENAI_REASONING_EFFORT")
    raw_wire = _pick("LLM_WIRE_API", "OPENAI_WIRE_API")
    return LlmConfig(
        api_key=_pick("LLM_API_KEY", "OPENAI_API_KEY") or "",
        base_url=base,
        model=model,
        wire_api=select_wire_api(raw_wire, model, reasoning),
        reasoning_effort=reasoning,
        timeout_ms=_int(_pick("LLM_TIMEOUT_MS", "OPENAI_TIMEOUT_MS"), 600_000),
        stream=_bool(_pick("LLM_STREAM", "OPENAI_STREAM"), False),
        unlimited_models=_csv(_pick("LLM_UNLIMITED_MODELS")),
    )


# ── low-level pool config (port of pool-json-llm env) ──────────────────────────

@dataclass(frozen=True)
class PoolConfig:
    keys: tuple[str, ...]
    labels: tuple[str, ...]
    base_url: str
    model: str
    timeout_ms: int
    race_mode: str  # "parallel" | "sequential"
    enabled: bool


def _resolve_race_mode() -> str:
    """
    Port of resolveSlideRulePoolRaceMode: explicit override wins; otherwise default 'parallel'.
    (We deliberately drop the Node proxy-auto-detect → sequential heuristic: in Python httpx the
    proxy is handled cleanly via trust_env, so parallel is safe.)
    """
    raw = (_pick("SLIDERULE_POOL_RACE_MODE", "WHYBUDDY_POOL_RACE_MODE") or "").strip().lower()
    if raw in ("parallel", "sequential"):
        return raw
    return "parallel"


def get_pool_config() -> PoolConfig:
    keys = _csv(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS"))
    labels = _csv(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_LABELS"))
    if len(labels) != len(keys):
        labels = tuple(f"key-{i + 1}" for i in range(len(keys)))
    return PoolConfig(
        keys=keys,
        labels=labels,
        base_url=(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL") or "").rstrip("/"),
        model=_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_MODEL") or "gpt-5.5",
        timeout_ms=_int(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_TIMEOUT_MS"), 300_000),
        race_mode=_resolve_race_mode(),
        enabled=_bool(_pick("SLIDERULE_CAPABILITY_POOL_ENABLED"), False),
    )
