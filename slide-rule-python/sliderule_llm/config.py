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


#: 所有调用的输出上限，一个口径（2026-08-13）。
#:
#: ## 为什么必须统一
#:
#: `max_tokens` 在非推理模型上是"输出上限"，在**推理模型上是"思考 + 输出的
#: 共享池"**。这个语义变化让所有按旧口径定的预算一起失效——而且失败形态是
#: **静默返回空正文**（`finish_reason=length` + `completion_tokens` 顶满），
#: 不是报错，最难查。
#:
#: 换 DeepSeek 那趟实测，18 处硬编码预算里当场挂了两处：
#:
#:     freeform_block:1246  max_tokens=1200   思考吃光 → 「怎么画」的润色静默跳过
#:     freeform_block:2033  max_tokens=14000  思考吃光 → **整个首页设计失败**，
#:                                            3 次重试全一样，白烧 433.8s
#:
#: 逐个调大是治不完的：18 个点、每换一次模型再来一遍。所以收成一个数。
#:
#: ## 为什么调大是安全的
#:
#: `max_tokens` 是**上限不是配额**——按实际生成的 token 计费，模型说完就停。
#: 把上限抬高不会让正常调用变贵，只是让"思考+正文"不再被人为截断。
#: 唯一的代价是失控生成时的天花板变高，这由各调用点自己的提示词约束兜着。
#:
#: ## 为什么连"分路旋钮"也一起收掉
#:
#: 以前有 `LLM_GENERATE_MAX_TOKENS` / `LLM_ROUND_CAP_MAX_TOKENS` 两个分路开关，
#: **它们已经删了**。分路旋钮救不了这个病，反而是病因的一部分：换模型那趟，
#: 这两个都调大了，挂掉的却是它俩都管不着的第三处硬编码。而且留着分路值
#: 还会**反向咬人**——旧 .env 里一个 `LLM_ROUND_CAP_MAX_TOKENS=32000`
#: 会让那条路悄悄比全局窄，正是要根除的形态。现在只剩一个 `LLM_MAX_TOKENS`：
#: 调它，全链路一起变；旧变量留在 .env 里也只是被忽略，不会再造成局部收窄。
DEFAULT_MAX_TOKENS = 65536


def default_max_tokens() -> int:
    """所有 LLM 调用的输出上限。`LLM_MAX_TOKENS` 可覆盖，全链路唯一旋钮。

    **每次读环境变量**，不做模块级常量：测试与评测脚本要能改完立刻生效。
    写坏了（空/非数字/非正数）退回默认值而不是抛——配错一个数就让整场推演
    挂掉，比用默认值糟得多。
    """
    return _positive_int(os.environ.get("LLM_MAX_TOKENS"), DEFAULT_MAX_TOKENS)


#: 结构化生成（深层节点树 / 严格 JSON 契约）的推理档位（2026-08-13）。
#:
#: ## 为什么这个要分路，而上面那个不许分路
#:
#: 看着像自相矛盾，其实是两种不同的东西：
#:
#: - `max_tokens` 是**上限**。分路只会让某条路比全局更窄，是纯粹的坑，
#:   所以收成一个数（见 DEFAULT_MAX_TOKENS 头上那段）。
#: - `reasoning_effort` 是**任务属性**。"判个意图要不要澄清"和"拼一棵七层
#:   深的节点树"需要的思考量本来就差一个量级，一个数按不住两头。
#:   仓库里早就在这么用了（v5_agentic_pick 那处显式传 low）。
#:
#: ## 实测（deepseek-v4-flash，同一道真题）
#:
#:     全局 medium：model.generate 281.9s ok=1   monitor.design 292.1s ok=1
#:     全局 low   ：model.generate 139.4s ok=1   monitor.design  95.3s **ok=0**
#:
#: low 把生成提速一倍，却把首页设计跑挂了——3 次尝试全是
#: `5 validation errors ... tag Field required`：思考砍太狠，模型拼不出合法的
#: 深层树。机械修复（json-repair / rowsRef 修补）都触发了也没救回来。
#:
#: ## 它现在是地板，不是补丁（2026-08-13 当日修正）
#:
#: 这个常量原本的用途是"全局走 low 吃掉那一倍提速，结构化生成单独抬回来"。
#: **那个前提已经撤销了**——全局回到 medium（理由写在 .env.example 的
#: LLM_REASONING_EFFORT 头上：low 省的是思考量，而这条链上到处是深层 JSON
#: 契约，按住一个崩点不等于按住下一个，何况崩起来是静默的校验失败）。
#:
#: 常量留着，语义从"补丁"变成"地板"：全局配到 medium 以下时，这条路不跟着降。
#: 没删是因为它按住的那个崩点是实测过的，删掉等于把这条经验也删了——
#: 谁再去调全局旋钮，首页设计不会跟着一起掉下去。
DEFAULT_STRUCTURED_REASONING_EFFORT = "medium"


#: 档位强弱次序，只用来比大小。表外的值（网关自定义档位）一律当"不认识"，
#: 见 structured_reasoning_effort 里的处理。
_REASONING_EFFORT_RANK = {"minimal": 0, "none": 0, "low": 1, "medium": 2, "high": 3}


def structured_reasoning_effort() -> str:
    """结构化生成的推理档位，**地板语义**。`LLM_STRUCTURED_REASONING_EFFORT` 可覆盖。

    返回空串表示"不要覆盖，跟全局走"。两种情况会返回空串：

    1. 显式配了空值——逃生舱：某些网关不认这个参数，或者换了个不需要额外思考的
       模型时，配个空值就能整条退回全局档位。
    2. **全局档位已经不低于地板**——这条是关键，不是优化。

    ## 为什么第 2 条必须在

    这个分路旋钮原本是配合"全局 low"用的，无条件覆盖没问题（medium > low）。
    全局回到 medium 之后，无条件覆盖就变成了一个**反向收窄**的陷阱：谁把全局
    调到 high，这条最需要思考的路会被这里悄悄按回 medium——正是
    DEFAULT_MAX_TOKENS 头上那段警告的"分路值反向咬人"，只是这次咬的是思考量，
    而且症状同样是静默的深层 JSON 校验失败，最难查。

    所以只在"全局比地板低"时才覆盖。全局设了但**不认识**（网关自定义档位）
    也不覆盖——那是运维明确写下的选择，不该被一个默认值改掉。
    """
    raw = os.environ.get("LLM_STRUCTURED_REASONING_EFFORT")
    floor = DEFAULT_STRUCTURED_REASONING_EFFORT if raw is None else raw.strip()
    if not floor:
        return ""
    global_effort = (_pick("LLM_REASONING_EFFORT", "OPENAI_REASONING_EFFORT") or "").strip()
    if global_effort:
        global_rank = _REASONING_EFFORT_RANK.get(global_effort.lower())
        floor_rank = _REASONING_EFFORT_RANK.get(floor.lower())
        # 认不出全局、或全局已经不低于地板 → 不插手
        if global_rank is None or floor_rank is None or global_rank >= floor_rank:
            return ""
    return floor


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
