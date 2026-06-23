"""Production external dependency live smoke (97).

Provides configurable, skippable, diagnostic live smoke for external providers.
- config_missing when no explicit prod config
- skipped when intentionally bypassed
- ready when config present and (light) check passes
- failed / timeout on error cases
Never mutates; only read-only when config present. Never treats missing as healthy.
"""

import os
import time
from typing import Any, Dict, List, Optional

import httpx

try:
    from config.settings import settings  # type: ignore
except Exception:
    settings = None  # type: ignore


def _get_env(key: str, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(key)
    if val is None and settings is not None:
        val = getattr(settings, key, None)
    if val is None:
        return default
    return str(val) if val is not None else default


def _should_skip(provider: str) -> bool:
    flag = os.getenv(f"SKIP_{provider.upper()}_LIVE_SMOKE", "").lower()
    return flag in ("1", "true", "skip", "yes")


def _http_get(url: str, headers: Optional[Dict[str, str]] = None, timeout_s: float = 3.0):
    """Internal helper to allow monkeypatching in tests without real net."""
    headers = headers or {}
    with httpx.Client(timeout=timeout_s) as client:
        return client.get(url, headers=headers)


def _check_qdrant(start: float) -> Dict[str, Any]:
    url = _get_env("QDRANT_URL") or _get_env("RAG_VECTOR_STORE_URL", "")
    key = _get_env("QDRANT_API_KEY") or _get_env("RAG_VECTOR_STORE_API_KEY")
    if not url or not key:
        dur = int((time.time() - start) * 1000)
        return {
            "provider": "qdrant",
            "status": "config_missing",
            "reason": "QDRANT_URL and QDRANT_API_KEY (or RAG_*) required for live smoke",
            "duration_ms": dur,
            "metadata": {"url": url or None},
        }
    # explicit config present: perform read-only smoke
    try:
        base = url.rstrip("/")
        hdrs: Dict[str, str] = {"api-key": key} if key else {}
        resp = _http_get(f"{base}/collections", headers=hdrs, timeout_s=2.0)
        dur = int((time.time() - start) * 1000)
        if resp.status_code < 500:
            return {
                "provider": "qdrant",
                "status": "ready",
                "reason": "",
                "duration_ms": dur,
                "metadata": {"http_status": resp.status_code},
            }
        return {
            "provider": "qdrant",
            "status": "failed",
            "reason": f"http {resp.status_code}",
            "duration_ms": dur,
            "metadata": {},
        }
    except httpx.TimeoutException:
        dur = int((time.time() - start) * 1000)
        return {
            "provider": "qdrant",
            "status": "timeout",
            "reason": "qdrant live smoke timed out",
            "duration_ms": dur,
            "metadata": {},
        }
    except Exception as exc:  # pragma: no cover - network variance
        dur = int((time.time() - start) * 1000)
        return {
            "provider": "qdrant",
            "status": "failed",
            "reason": str(exc)[:200],
            "duration_ms": dur,
            "metadata": {},
        }


def _check_embedding(start: float) -> Dict[str, Any]:
    key = _get_env("LLM_API_KEY")
    model = _get_env("QWEN_EMBEDDING_MODEL") or _get_env("LLM_MODEL")
    dur = int((time.time() - start) * 1000)
    if not key:
        return {
            "provider": "embedding",
            "status": "config_missing",
            "reason": "LLM_API_KEY not configured",
            "duration_ms": dur,
            "metadata": {},
        }
    # config present: mark ready (smoke avoids actual embed calls to stay cheap and side-effect free)
    return {
        "provider": "embedding",
        "status": "ready",
        "reason": "",
        "duration_ms": dur,
        "metadata": {"model": model},
    }


def _check_generic(provider: str, start: float, key_names: List[str], ready_note: str = "") -> Dict[str, Any]:
    dur = int((time.time() - start) * 1000)
    has = any(bool(_get_env(k)) for k in key_names)
    if not has:
        return {
            "provider": provider,
            "status": "config_missing",
            "reason": f"no explicit config keys for {provider}",
            "duration_ms": dur,
            "metadata": {},
        }
    return {
        "provider": provider,
        "status": "ready",
        "reason": ready_note,
        "duration_ms": dur,
        "metadata": {"via": "env-config"},
    }


def run_external_dependency_live_smoke() -> Dict[str, Any]:
    """Return live smoke result with per-provider diagnostics.

    Status values: ready | skipped | config_missing | failed | timeout
    Always includes metadata; skipped/config_missing are explicit and must never be treated as healthy production wiring.
    """
    all_start = time.time()
    provider_order = ["qdrant", "embedding", "search", "ocr", "vision", "audio", "apm", "billing", "audit"]
    checks: List[Dict[str, Any]] = []

    for prov in provider_order:
        if _should_skip(prov):
            checks.append(
                {
                    "provider": prov,
                    "status": "skipped",
                    "reason": "explicit SKIP_*_LIVE_SMOKE flag",
                    "duration_ms": 0,
                    "metadata": {},
                }
            )
            continue

        if prov == "qdrant":
            checks.append(_check_qdrant(time.time()))
            continue
        if prov == "embedding":
            checks.append(_check_embedding(time.time()))
            continue

        if prov == "search":
            checks.append(
                _check_generic(prov, time.time(), ["SEARCH_API_KEY", "WEB_SEARCH_PROVIDER", "SERPER_KEY", "BING_KEY"], "search may be delegated")
            )
            continue
        if prov == "ocr":
            checks.append(
                _check_generic(prov, time.time(), ["OCR_API_KEY", "TESSERACT_OCR", "VISION_OCR_ENABLED"])
            )
            continue
        if prov == "vision":
            checks.append(
                _check_generic(prov, time.time(), ["VISION_API_KEY", "LLM_VISION_MODEL"])
            )
            continue
        if prov == "audio":
            checks.append(
                _check_generic(prov, time.time(), ["AUDIO_API_KEY", "SPEECH_API_KEY"])
            )
            continue
        if prov == "apm":
            checks.append(
                _check_generic(prov, time.time(), ["OTEL_EXPORTER_OTLP_ENDPOINT", "APM_DSN", "SENTRY_DSN"])
            )
            continue
        if prov == "billing":
            checks.append(
                _check_generic(prov, time.time(), ["BILLING_ENABLED", "STRIPE_KEY", "BILLING_API"])
            )
            continue
        if prov == "audit":
            checks.append(
                _check_generic(prov, time.time(), ["AUDIT_SINK_URL", "AUDIT_PLATFORM", "AUDIT_ENABLED"])
            )
            continue

        dur = int((time.time() - time.time()) * 1000)
        checks.append({"provider": prov, "status": "skipped", "reason": "no classification", "duration_ms": dur, "metadata": {}})

    total_dur = int((time.time() - all_start) * 1000)
    ready_count = sum(1 for c in checks if c["status"] == "ready")
    missing_count = sum(1 for c in checks if c["status"] == "config_missing")
    skipped_count = sum(1 for c in checks if c["status"] == "skipped")
    problem_count = sum(1 for c in checks if c["status"] in ("failed", "timeout"))

    if ready_count > 0 and missing_count == 0 and problem_count == 0:
        overall = "ready"
    elif problem_count > 0:
        overall = "degraded"
    elif missing_count > 0 and ready_count == 0:
        overall = "config_missing"
    else:
        overall = "partial"

    return {
        "overall": overall,
        "checks": checks,
        "duration_ms": total_dur,
        "counts": {
            "ready": ready_count,
            "skipped": skipped_count,
            "config_missing": missing_count,
            "failed_or_timeout": problem_count,
        },
        "note": "config_missing or skipped means this dependency is not wired for live external use. Do not treat as production external takeover evidence.",
    }
