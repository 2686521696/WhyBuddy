"""Test for external provider cutover readiness 100.

Covers:
- ready / config_missing / skipped / failed / timeout / degraded per provider
- overall computation respects that skipped/config_missing/degraded never become ready
- includes deployed_python_service provider
- safe when no config (no red/green fake)
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.external_provider_cutover import (  # noqa: E402
    run_external_provider_cutover_readiness,
    CUTOVER_ALLOWED_STATUSES,
)


def _clear_cutover_env(monkeypatch):
    keys = [
        "QDRANT_URL", "QDRANT_API_KEY", "RAG_VECTOR_STORE_URL", "RAG_VECTOR_STORE_API_KEY",
        "LLM_API_KEY", "QWEN_EMBEDDING_MODEL",
        "SEARCH_API_KEY", "WEB_SEARCH_PROVIDER",
        "OCR_API_KEY", "VISION_API_KEY", "AUDIO_API_KEY",
        "OTEL_EXPORTER_OTLP_ENDPOINT", "APM_DSN",
        "BILLING_ENABLED", "AUDIT_SINK_URL",
        "SKIP_QDRANT_LIVE_SMOKE", "SKIP_EMBEDDING_LIVE_SMOKE",
        "FORCE_CUTOVER_DEGRADED",
    ]
    for k in keys:
        monkeypatch.delenv(k, raising=False)

    # 隔离开发者本地 .env：_get_env 会回退读 pydantic settings（settings 加载 .env），
    # 仅清 os.environ 不够；把默认值为 None 的凭据属性一并清掉。
    try:
        from config.settings import settings as _settings
        for attr in ("LLM_API_KEY", "QDRANT_API_KEY"):
            if hasattr(_settings, attr):
                monkeypatch.setattr(_settings, attr, None)
    except Exception:
        pass


def test_cutover_readiness_outputs_all_statuses(monkeypatch):
    _clear_cutover_env(monkeypatch)
    result = run_external_provider_cutover_readiness()
    assert "checks" in result
    assert isinstance(result["checks"], list)
    assert len(result["checks"]) >= 10  # original 9 + deployed_python_service
    assert "deployed_python_service" in [c["provider"] for c in result["checks"]]

    seen_statuses = set()
    for c in result["checks"]:
        assert "provider" in c
        assert "status" in c
        assert c["status"] in CUTOVER_ALLOWED_STATUSES
        seen_statuses.add(c["status"])
        assert "reason" in c
        assert "duration_ms" in c
        assert isinstance(c["duration_ms"], int)
        assert "metadata" in c

    # must support degraded in output
    # force one case
    monkeypatch.setenv("FORCE_CUTOVER_DEGRADED", "true")
    result2 = run_external_provider_cutover_readiness()
    statuses2 = {c["status"] for c in result2["checks"]}
    assert "degraded" in statuses2 or result2["overall"] == "degraded"


def test_cutover_config_missing_is_safe_and_not_ready(monkeypatch):
    _clear_cutover_env(monkeypatch)
    result = run_external_provider_cutover_readiness()
    checks_by = {c["provider"]: c for c in result["checks"]}
    assert checks_by["qdrant"]["status"] == "config_missing"
    assert checks_by["embedding"]["status"] == "config_missing"
    assert result["overall"] in ("config_missing", "partial", "degraded")
    # never treat missing as ready
    assert all(c["status"] != "ready" for c in result["checks"] if c["provider"] in ("qdrant", "embedding"))


def test_cutover_skipped_respects_flag_and_not_ready(monkeypatch):
    _clear_cutover_env(monkeypatch)
    monkeypatch.setenv("SKIP_QDRANT_LIVE_SMOKE", "true")
    monkeypatch.setenv("SKIP_EMBEDDING_LIVE_SMOKE", "true")
    result = run_external_provider_cutover_readiness()
    checks_by = {c["provider"]: c for c in result["checks"]}
    assert checks_by["qdrant"]["status"] == "skipped"
    assert checks_by["embedding"]["status"] == "skipped"
    assert result["overall"] != "ready"
    assert "skipped" in result.get("note", "").lower() or "not ready" in result.get("note", "").lower()


def test_cutover_ready_with_config(monkeypatch):
    _clear_cutover_env(monkeypatch)
    monkeypatch.setenv("QDRANT_URL", "http://example.test:6333")
    monkeypatch.setenv("QDRANT_API_KEY", "k")
    monkeypatch.setenv("LLM_API_KEY", "k")

    def fake_ok(url, headers=None, timeout_s=3.0):
        class R:
            status_code = 200
        return R()

    monkeypatch.setattr("services.external_dependency_live_smoke._http_get", fake_ok)

    result = run_external_provider_cutover_readiness()
    checks_by = {c["provider"]: c for c in result["checks"]}
    assert checks_by["qdrant"]["status"] == "ready"
    assert checks_by["embedding"]["status"] == "ready"
    # python service should be ready or degraded (not crash)
    assert checks_by["deployed_python_service"]["status"] in ("ready", "degraded")


def test_cutover_failed_and_timeout(monkeypatch):
    _clear_cutover_env(monkeypatch)
    monkeypatch.setenv("QDRANT_URL", "http://bad.test")
    monkeypatch.setenv("QDRANT_API_KEY", "k")

    def fake_timeout(*a, **k):
        import httpx
        raise httpx.TimeoutException("timeout")

    monkeypatch.setattr("services.external_dependency_live_smoke._http_get", fake_timeout)

    result = run_external_provider_cutover_readiness()
    checks_by = {c["provider"]: c for c in result["checks"]}
    # since qdrant will timeout or fail
    q = checks_by["qdrant"]
    assert q["status"] in ("failed", "timeout")
    assert result["overall"] in ("degraded", "partial")


def test_cutover_degraded_state_covered(monkeypatch):
    _clear_cutover_env(monkeypatch)
    monkeypatch.setenv("FORCE_CUTOVER_DEGRADED", "1")
    result = run_external_provider_cutover_readiness()
    assert result["overall"] == "degraded"
    degraded_provs = [c["provider"] for c in result["checks"] if c["status"] == "degraded"]
    assert len(degraded_provs) > 0
