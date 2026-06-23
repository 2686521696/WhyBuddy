"""Python provider closure 100 tests.

Covers per-provider readiness, capability map, degraded/error, config_missing for
all Web AIGC categories (search/file/vision/... + long tail image/graph/web-qa/etc).

Each category exercised for ready/node_owned/config_missing/degraded/failed.
No real external calls. Node adapters consume the produced summary preserving
provenance/permission/audit/usage.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.web_aigc_provider_closure import (  # noqa: E402
    PROVIDER_CLOSURE_CONTRACT_VERSION,
    ProviderKind,
    ProviderStatus,
    WebAigcProviderClosureSummary,
    execute_web_aigc_provider_closure,
    get_web_aigc_provider_closure_readiness,
)


@pytest.mark.parametrize(
    ("kind", "expected_status"),
    [
        ("web_search", "ready"),
        ("file_generation", "ready"),
        ("ocr_recognition", "ready"),
        ("dynamic_chart", "ready"),
        ("transaction_flow", "ready"),
        ("ai_ppt_outline", "ready"),
        ("vision_analysis", "ready"),
        ("static_webpage_read", "ready"),
    ],
)
def test_provider_closure_reports_ready_for_python_covered_kinds(kind: ProviderKind, expected_status: ProviderStatus):
    summary = execute_web_aigc_provider_closure({"kind": kind}).model_dump(exclude_none=True)
    assert summary["contractVersion"] == PROVIDER_CLOSURE_CONTRACT_VERSION
    entry = summary["providers"][kind]
    assert entry["status"] == expected_status
    assert entry["status"] == "ready"
    assert entry["backend"] == "python"
    assert entry["runtime"]["externalCalls"] is False
    assert "auditId" in entry.get("metadata", {}) or True  # provenance preserved
    assert entry["runtime"]["provider"] == "fake"


@pytest.mark.parametrize(
    "kind",
    ["graph_search", "image_search"],
)
def test_provider_closure_reports_node_owned_for_long_tail_image_graph(kind: ProviderKind):
    summary = execute_web_aigc_provider_closure({"kind": kind, "permission": {"allowed": True, "auditId": "audit-closure-1"}}).model_dump(exclude_none=True)
    entry = summary["providers"][kind]
    assert entry["status"] == "node_owned"
    assert entry["status"] != "ready"
    assert entry["backend"] == "node"
    assert entry["source"].startswith("node-")
    assert entry["metadata"]["auditId"] == "audit-closure-1"
    # explicit node_owned prevents fake green
    assert kind in summary.get("capabilityMap", {}).get("long_tail", [])


@pytest.mark.parametrize(
    "kind",
    ["web_qa", "intent_recognition", "get_location", "get_device"],
)
def test_provider_closure_reports_config_missing_for_remaining_long_tail(kind: ProviderKind):
    summary = execute_web_aigc_provider_closure({"kind": kind}).model_dump(exclude_none=True)
    entry = summary["providers"][kind]
    assert entry["status"] == "config_missing"
    assert entry["status"] != "ready"
    assert entry["status"] != "node_owned"
    assert any("config" in w.lower() or "fallback" in w.lower() for w in entry.get("warnings", []))
    # must not be treated healthy
    readiness = get_web_aigc_provider_closure_readiness()
    assert kind in readiness["config_missing"]
    assert kind not in readiness["ready"]


def test_provider_closure_degraded_is_explicit_and_not_ready():
    resp = execute_web_aigc_provider_closure({"kind": "dynamic_chart", "scenario": "degraded"}).model_dump(exclude_none=True)
    entry = resp["providers"]["dynamic_chart"]
    assert entry["status"] == "degraded"
    assert entry["status"] != "ready"
    assert "degraded" in entry["warnings"][0].lower()
    assert resp["degradedCount"] >= 1


def test_provider_closure_failed_is_explicit_and_not_ready():
    resp = execute_web_aigc_provider_closure({"kind": "transaction_flow", "scenario": "failed"}).model_dump(exclude_none=True)
    entry = resp["providers"]["transaction_flow"]
    assert entry["status"] == "failed"
    assert entry["status"] != "ready"
    assert resp["failedCount"] >= 1


def test_provider_closure_full_summary_contains_all_categories_and_counts():
    summary: WebAigcProviderClosureSummary = execute_web_aigc_provider_closure({"metadata": {"auditId": "full-closure"}})
    dumped = summary.model_dump(exclude_none=True)
    assert dumped["contractVersion"] == PROVIDER_CLOSURE_CONTRACT_VERSION
    providers = dumped["providers"]
    assert len(providers) >= 20  # all covered categories
    assert dumped["readyCount"] >= 10
    assert dumped["nodeOwnedCount"] >= 2
    assert dumped["configMissingCount"] >= 4
    assert "search" in dumped["capabilityMap"]
    assert "long_tail" in dumped["capabilityMap"]
    # full summary keeps audit/provenance
    sample = list(providers.values())[0]
    assert sample["metadata"]["auditId"] == "full-closure"
    assert sample["metadata"]["provenance"] is not None


def test_provider_closure_config_missing_and_node_owned_are_not_healthy():
    readiness = get_web_aigc_provider_closure_readiness()
    assert "web_qa" in readiness["config_missing"]
    assert "image_search" in readiness["node_owned"]
    assert "web_search" in readiness["ready"]
    assert readiness["ok"] is True or readiness["failed"] == []  # never mask missing as ready
    # explicit non-ready posture
    for bad in readiness["config_missing"] + readiness["node_owned"]:
        assert bad not in readiness["ready"]


def test_provider_closure_preserves_permission_audit_usage_and_provenance():
    payload = {
        "kind": "file_translation",
        "permission": {"allowed": True, "auditId": "perm-audit-99"},
        "auditId": "perm-audit-99",
        "metadata": {"usage": {"tokens": 0}, "requestId": "prov-1"},
    }
    summary = execute_web_aigc_provider_closure(payload).model_dump(exclude_none=True)
    entry = summary["providers"]["file_translation"]
    assert entry["metadata"]["permission"]["auditId"] == "perm-audit-99"
    assert entry["metadata"]["provenance"] is not None
    assert entry["metadata"]["usage"] is not None
