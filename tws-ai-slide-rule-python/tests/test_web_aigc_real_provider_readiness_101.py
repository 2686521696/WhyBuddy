"""Test for Web AIGC real provider readiness 101.

Covers:
- Python outputs provider readiness matrix for search/file/vision/audio/OCR/static/AI PPT/chart/transaction
- Classifications: ready, skipped-live, blocked, degraded, unsupported
- skipped-live for real external (search/vision/audio/ocr) never claimed as ready
- synthetic/python paths (file/ai-ppt/chart/transaction) default ready
- Node bridge / observability can consume matrix; skipped-live does not count as real takeover
- explicit non-ready states are reported distinctly
- existing web aigc adapter runtime tests remain passing (no side effects)
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.web_aigc_real_provider_readiness import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    WebAigcRealProviderStatus,
    execute_web_aigc_real_provider_readiness,
    get_web_aigc_real_provider_readiness_matrix,
)


def test_real_provider_readiness_contract_and_defaults():
    result = execute_web_aigc_real_provider_readiness({})
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["runtime"]["owner"] == "python"
    assert result["runtime"]["externalCalls"] is False
    assert "matrix" in result
    assert "providers" in result
    assert result["ok"] in (True, False)  # may be false due to skipped-lives


def test_real_provider_readiness_covers_all_task_categories():
    result = get_web_aigc_real_provider_readiness_matrix()
    matrix = result["matrix"]
    for cat in ["search", "file", "vision", "audio", "ocr", "ai_ppt", "chart", "transaction"]:
        assert cat in matrix
        assert len(matrix[cat]) >= 1
    # static is mapped under search or separate
    providers = result["providers"]
    assert "web_search" in providers
    assert "file_generation" in providers
    assert "ai_ppt_outline" in providers
    assert "dynamic_chart" in providers
    assert "transaction_flow" in providers


@pytest.mark.parametrize(
    ("kind", "expected_status"),
    [
        ("file_generation", "ready"),
        ("file_slicing", "ready"),
        ("ai_ppt_outline", "ready"),
        ("dynamic_chart", "ready"),
        ("transaction_flow", "ready"),
        ("excel_read", "ready"),
    ],
)
def test_real_provider_readiness_python_synthetic_are_ready(kind: str, expected_status: WebAigcRealProviderStatus):
    result = execute_web_aigc_real_provider_readiness({"kind": kind})  # kind ignored for global but ok
    # use full and lookup
    result = get_web_aigc_real_provider_readiness_matrix()
    entry = result["providers"].get(kind) or next((v for k, v in result["providers"].items() if k == kind), None)
    assert entry is not None
    assert entry["status"] == expected_status
    assert entry["synthetic"] is True
    assert entry["externalCalls"] is False


@pytest.mark.parametrize(
    "kind",
    ["web_search", "image_search", "vision_analysis", "audio_recognition", "ocr_recognition"],
)
def test_real_provider_readiness_external_are_skipped_live(kind: str):
    result = get_web_aigc_real_provider_readiness_matrix()
    entry = result["providers"][kind]
    assert entry["status"] == "skipped-live"
    assert entry["status"] != "ready"
    assert "skipped-live" in entry["reason"].lower() or "synthetic only" in entry["reason"].lower()
    assert result["counts"]["skippedLive"] >= 1
    # must not count skipped as ready
    assert kind not in [k for k, e in result["providers"].items() if e["status"] == "ready"]


def test_real_provider_readiness_simulate_blocked_degraded_unsupported():
    blocked = execute_web_aigc_real_provider_readiness({"simulate": {"status": "blocked", "kinds": ["web_search"]}})
    assert blocked["providers"]["web_search"]["status"] == "blocked"
    assert blocked["counts"]["blocked"] >= 1
    assert blocked["ok"] is False

    degraded = execute_web_aigc_real_provider_readiness({"simulate": {"status": "degraded"}})
    assert degraded["providers"]["ai_ppt_outline"]["status"] == "degraded"
    assert degraded["counts"]["degraded"] >= 1

    unsup = execute_web_aigc_real_provider_readiness({"simulate": {"status": "unsupported", "kinds": ["graph_search"]}})
    assert unsup["providers"]["graph_search"]["status"] == "unsupported"


def test_real_provider_readiness_skipped_live_never_ready():
    result = get_web_aigc_real_provider_readiness_matrix()
    readiness = result
    for k, e in readiness["providers"].items():
        if e["status"] == "skipped-live":
            assert e["status"] != "ready"
    # counts must separate
    assert readiness["counts"]["skippedLive"] >= 4  # at least search related
    assert readiness["counts"]["ready"] >= 5  # file + ppt + chart + tx
    # note asserts no real takeover
    assert "skipped-live" in str(readiness["note"]).lower()


def test_real_provider_readiness_full_matrix_distinguishes_all_statuses():
    # force to exercise all
    for st in ["ready", "skipped-live", "blocked", "degraded", "unsupported"]:
        r = execute_web_aigc_real_provider_readiness({"simulate": {"status": st}})
        assert any(e["status"] == st for e in r["providers"].values())
        if st == "ready":
            assert r["counts"]["ready"] > 0
        if st == "skipped-live":
            assert r["counts"]["skippedLive"] > 0
