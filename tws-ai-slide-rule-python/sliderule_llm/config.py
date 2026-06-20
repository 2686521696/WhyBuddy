"""
LLM config + wire selection — port of server/core/ai-config.ts.

Reads the SAME env vars as the Node app so a single .env drives both during migration.
Stdlib-only (no pydantic) so it can be unit-tested without any third-party deps.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

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


def _positive_int(v: str | None, default: int) -> int:
    parsed = _int(v, default)
    return parsed if parsed > 0 else default


def _provider_name(base_url: str) -> str:
    parsed = urlparse(base_url or "")
    return parsed.netloc or base_url


def _dedupe_models(models: tuple[str, ...], primary_model: str) -> tuple[str, ...]:
    seen = {primary_model.strip().lower()} if primary_model else set()
    result: list[str] = []
    for model in models:
        normalized = model.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(model)
    return tuple(result)


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
    router_model: str | None
    wire_api: str  # "chat_completions" | "responses"
    reasoning_effort: str | None
    timeout_ms: int
    stream: bool
    unlimited_models: tuple[str, ...]
    model_fallbacks: tuple[str, ...]
    max_context: int
    max_concurrent: int
    provider_name: str
    chat_thinking_type: str | None
    supports_image_content_parts: bool = False


def get_llm_config() -> LlmConfig:
    base = (_pick("LLM_BASE_URL", "OPENAI_BASE_URL") or "").rstrip("/")
    model = _pick("LLM_MODEL", "OPENAI_MODEL") or "gpt-5.5"
    router_model = _pick("LLM_ROUTER_MODEL", "OPENAI_ROUTER_MODEL")
    reasoning = _pick("LLM_REASONING_EFFORT", "OPENAI_REASONING_EFFORT")
    raw_wire = _pick("LLM_WIRE_API", "OPENAI_WIRE_API")
    return LlmConfig(
        api_key=_pick("LLM_API_KEY", "OPENAI_API_KEY") or "",
        base_url=base,
        model=model,
        router_model=router_model,
        wire_api=select_wire_api(raw_wire, model, reasoning),
        reasoning_effort=reasoning,
        timeout_ms=_positive_int(_pick("LLM_TIMEOUT_MS", "OPENAI_TIMEOUT_MS"), 600_000),
        stream=_bool(_pick("LLM_STREAM", "OPENAI_STREAM"), False),
        unlimited_models=_csv(_pick("LLM_UNLIMITED_MODELS")),
        model_fallbacks=_dedupe_models(_csv(_pick("LLM_MODEL_FALLBACKS")), model),
        max_context=_positive_int(_pick("LLM_MAX_CONTEXT"), 1_000_000),
        max_concurrent=max(1, _int(_pick("LLM_MAX_CONCURRENT"), 9999)),
        provider_name=_provider_name(base),
        chat_thinking_type=_pick("LLM_CHAT_THINKING_TYPE", "OPENAI_CHAT_THINKING_TYPE"),
        supports_image_content_parts=_bool(_pick("LLM_SUPPORTS_IMAGE_CONTENT_PARTS"), False),
    )


# ── fallback provider config (port of llm-client buildProviders env) ───────────

@dataclass(frozen=True)
class FallbackLlmConfig:
    enabled: bool
    api_key: str
    base_url: str
    model: str
    wire_api: str
    timeout_ms: int
    reasoning_effort: str | None
    force_model: bool
    stream: bool
    chat_thinking_type: str | None
    retries: int
    cooldown_ms: int


def get_fallback_llm_config() -> FallbackLlmConfig:
    api_key = _pick("FALLBACK_LLM_API_KEY") or ""
    base_url = (_pick("FALLBACK_LLM_BASE_URL") or "").rstrip("/")
    model = _pick("FALLBACK_LLM_MODEL") or "glm-4.6"
    return FallbackLlmConfig(
        enabled=bool(api_key and base_url),
        api_key=api_key,
        base_url=base_url,
        model=model,
        wire_api="responses" if (_pick("FALLBACK_LLM_WIRE_API") or "").lower() == "responses" else "chat_completions",
        timeout_ms=_positive_int(_pick("FALLBACK_LLM_TIMEOUT_MS"), 600_000),
        reasoning_effort=_pick("FALLBACK_LLM_REASONING_EFFORT"),
        force_model=(_pick("FALLBACK_LLM_FORCE_MODEL") or "true").lower() != "false",
        stream=(_pick("FALLBACK_LLM_STREAM") or "false").lower() != "false",
        chat_thinking_type=_pick("FALLBACK_LLM_CHAT_THINKING_TYPE") or "disabled",
        retries=_positive_int(_pick("FALLBACK_LLM_RETRIES"), 3),
        cooldown_ms=_positive_int(_pick("FALLBACK_LLM_COOLDOWN_MS"), 30_000),
    )


# ── low-level pool config (port of pool-json-llm env) ──────────────────────────

@dataclass(frozen=True)
class PoolConfig:
    keys: tuple[str, ...]
    labels: tuple[str, ...]
    base_url: str
    model: str
    timeout_ms: int
    wire_api: str
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
    model = _pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_MODEL") or "ouyi-5-preview-thinking"
    raw_wire = (_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API") or "").strip().lower()
    if raw_wire:
        wire_api = "responses" if raw_wire == "responses" else "chat_completions"
    elif re.search(r"gpt-5|gpt5|5\.[0-9]", model or "", re.IGNORECASE):
        wire_api = "responses"
    else:
        wire_api = "chat_completions"
    return PoolConfig(
        keys=keys,
        labels=labels,
        base_url=(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL") or "https://api.rcouyi.com/v1").rstrip("/"),
        model=model,
        timeout_ms=_positive_int(_pick("BLUEPRINT_SPEC_DOCS_LLM_POOL_TIMEOUT_MS"), 300_000),
        wire_api=wire_api,
        race_mode=_resolve_race_mode(),
        enabled=_bool(_pick("SLIDERULE_CAPABILITY_POOL_ENABLED"), False),
    )


@dataclass(frozen=True)
class VectorStoreConfig:
    """Runtime config contract for vector-backed evidence retrieval."""

    runtime: str
    enabled: bool
    base_url: str
    collection: str
    api_key: str
    timeout_ms: int
    dimension: int


def _normalize_vector_runtime(raw_runtime: str | None, enabled: bool) -> tuple[str, bool]:
    runtime = (raw_runtime or "").strip().lower()
    if runtime in ("qdrant", "real", "vector"):
        return "qdrant", True
    if runtime in ("disabled", "off", "none", "fallback"):
        return "disabled", False
    if enabled:
        return "qdrant", True
    return "disabled", False


def get_vector_store_config() -> VectorStoreConfig:
    enabled = _bool(
        _pick(
            "SLIDERULE_REAL_VECTOR_RETRIEVAL_ENABLED",
            "RAG_VECTOR_RETRIEVAL_ENABLED",
        ),
        False,
    )
    runtime, enabled = _normalize_vector_runtime(
        _pick("SLIDERULE_VECTOR_RUNTIME", "RAG_VECTOR_RUNTIME"),
        enabled,
    )
    return VectorStoreConfig(
        runtime=runtime,
        enabled=enabled,
        base_url=(_pick("QDRANT_URL", "RAG_VECTOR_STORE_URL") or "http://localhost:6333").rstrip("/"),
        collection=_pick("QDRANT_COLLECTION", "RAG_VECTOR_COLLECTION") or "knowledge_base",
        api_key=_pick("QDRANT_API_KEY", "RAG_VECTOR_STORE_API_KEY") or "",
        timeout_ms=_positive_int(_pick("QDRANT_TIMEOUT_MS", "RAG_VECTOR_TIMEOUT_MS"), 10_000),
        dimension=_positive_int(_pick("QDRANT_DIMENSION", "RAG_EMBEDDING_DIMENSION"), 1536),
    )
