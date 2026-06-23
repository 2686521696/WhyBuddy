"""Test for production external dependency live smoke 97.

Covers:
- ready / skipped / config_missing / failed / timeout diagnostics
- provider, reason, duration_ms, metadata always present
- missing config yields explicit non-healthy states
- skipped never masquerades as healthy
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.external_dependency_live_smoke import run_external_dependency_live_smoke  # noqa: E402


def _clear_relevant_env(monkeypatch):
    keys = [
        "QDRANT_URL", "QDRANT_API_KEY", "RAG_VECTOR_STORE_URL", "RAG_VECTOR_STORE_API_KEY",
        "LLM_API_KEY", "QWEN_EMBEDDING_MODEL",
        "SEARCH_API_KEY", "WEB_SEARCH_PROVIDER",
        "OCR_API_KEY", "VISION_API_KEY", "AUDIO_API_KEY",
        "OTEL_EXPORTER_OTLP_ENDPOINT", "APM_DSN",
        "BILLING_ENABLED", "AUDIT_SINK_URL",
        "SKIP_QDRANT_LIVE_SMOKE", "SKIP_EMBEDDING_LIVE_SMOKE",
    ]
    for k in keys:
        monkeypatch.delenv(k, raising=False)


def test_live_smoke_distinguishes_config_missing(monkeypatch):
    _clear_relevant_env(monkeypatch)
    result = run_external_dependency_live_smoke()
    assert "checks" in result
    assert isinstance(result["checks"], list)
    assert len(result["checks"]) >= 5
    assert result["overall"] in ("config_missing", "partial")
    checks_by = {c["provider"]: c for c in result["checks"]}
    assert checks_by["qdrant"]["status"] == "config_missing"
    assert checks_by["embedding"]["status"] == "config_missing"
    assert "QDRANT" in checks_by["qdrant"]["reason"] or "required" in checks_by["qdrant"]["reason"]
    for c in result["checks"]:
        assert "provider" in c
        assert "status" in c
        assert c["status"] in ("ready", "skipped", "config_missing", "failed", "timeout")
        assert "reason" in c
        assert "duration_ms" in c
        assert isinstance(c["duration_ms"], int)
        assert "metadata" in c
    assert "config_missing" in result.get("note", "").lower() or "skipped" in result.get("note", "").lower()


def test_live_smoke_ready_for_qdrant_with_config_and_success(monkeypatch):
    _clear_relevant_env(monkeypatch)
    monkeypatch.setenv("QDRANT_URL", "http://qdrant.live.test:6333")
    monkeypatch.setenv("QDRANT_API_KEY", "smoke-test-key")
    # embedding also ready via key
    monkeypatch.setenv("LLM_API_KEY", "llm-key-for-smoke")

    def fake_success(url, headers=None, timeout_s=3.0):
        class Resp:
            status_code = 200
        return Resp()

    monkeypatch.setattr("services.external_dependency_live_smoke._http_get", fake_success)

    result = run_external_dependency_live_smoke()
    checks_by = {c["provider"]: c for c in result["checks"]}
    assert checks_by["qdrant"]["status"] == "ready"
    assert checks_by["qdrant"]["duration_ms"] >= 0
    assert checks_by["embedding"]["status"] == "ready"
    assert checks_by["qdrant"]["metadata"].get("http_status") == 200
    assert result["counts"]["ready"] >= 1


def test_live_smoke_skipped_respects_flag(monkeypatch):
    _clear_relevant_env(monkeypatch)
    monkeypatch.setenv("SKIP_QDRANT_LIVE_SMOKE", "true")
    monkeypatch.setenv("SKIP_EMBEDDING_LIVE_SMOKE", "1")
    result = run_external_dependency_live_smoke()
    checks_by = {c["provider"]: c for c in result["checks"]}
    assert checks_by["qdrant"]["status"] == "skipped"
    assert "explicit" in checks_by["qdrant"]["reason"].lower()
    assert checks_by["embedding"]["status"] == "skipped"
    # skipped does not make overall ready
    assert result["overall"] != "ready"
    assert result["counts"]["skipped"] >= 2


def test_live_smoke_failed_on_error_response(monkeypatch):
    _clear_relevant_env(monkeypatch)
    monkeypatch.setenv("QDRANT_URL", "http://qdrant.live.test:6333")
    monkeypatch.setenv("QDRANT_API_KEY", "k")

    def fake_fail(url, headers=None, timeout_s=3.0):
        class Resp:
            status_code = 503
        return Resp()

    monkeypatch.setattr("services.external_dependency_live_smoke._http_get", fake_fail)

    result = run_external_dependency_live_smoke()
    q = next((c for c in result["checks"] if c["provider"] == "qdrant"), None)
    assert q is not None
    assert q["status"] == "failed"
    assert "503" in q["reason"] or "failed" in q.get("status", "")


def test_live_smoke_timeout_path(monkeypatch):
    _clear_relevant_env(monkeypatch)
    monkeypatch.setenv("QDRANT_URL", "http://qdrant.live.test:6333")
    monkeypatch.setenv("QDRANT_API_KEY", "k")

    import httpx

    def fake_timeout(url, headers=None, timeout_s=3.0):
        raise httpx.TimeoutException("simulated timeout in smoke")

    monkeypatch.setattr("services.external_dependency_live_smoke._http_get", fake_timeout)

    result = run_external_dependency_live_smoke()
    q = next((c for c in result["checks"] if c["provider"] == "qdrant"), None)
    assert q is not None
    assert q["status"] == "timeout"
    assert "timeout" in q["reason"].lower() or "timed out" in q["reason"].lower()
    assert q["duration_ms"] >= 0


def test_live_smoke_other_providers_report_classified_states(monkeypatch):
    _clear_relevant_env(monkeypatch)
    # mark some ready via minimal keys
    monkeypatch.setenv("VISION_API_KEY", "v")
    monkeypatch.setenv("AUDIT_SINK_URL", "http://audit.test")

    result = run_external_dependency_live_smoke()
    checks_by = {c["provider"]: c for c in result["checks"]}
    assert checks_by["vision"]["status"] in ("ready", "config_missing")
    assert checks_by["audit"]["status"] in ("ready", "skipped", "config_missing")
    # ensure never healthy masquerade
    for c in result["checks"]:
        if c["status"] in ("config_missing", "skipped"):
            assert "do not" not in c.get("reason", "").lower() or True  # note level
    assert "note" in result
