"""Contract tests for the lightweight production observability rollup.

The rollup is a deployment-readiness summary over existing telemetry route
envelopes. It is deliberately contract-only: no Datadog, OpenTelemetry
collector, billing system, or other production sink is contacted here.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


ROLLUP_CONTRACT_VERSION = "python-observability-rollup.runtime.v1"
ROLLUP_RUNTIME = "python-observability-rollup"
ROLLUP_STATUSES = {"healthy", "degraded", "unhealthy", "unknown"}
METRIC_STATES = {"present", "missing", "unknown"}


def _dump(result):
    return result.model_dump(mode="json")


def _build_rollup(status="degraded", telemetry_state="present", cost_state="present"):
    from services.telemetry_runtime import execute_telemetry_route_contract

    metrics = _dump(
        execute_telemetry_route_contract(
            {
                "operation": "metrics",
                "route": "telemetry",
                "snapshot": {
                    "totalTokensIn": 12,
                    "totalTokensOut": 8,
                    "totalCost": 0.00042,
                    "totalCalls": 2,
                    "activeAgentCount": 1,
                    "errorCount": 1,
                    "latencyMs": {"average": 24, "p95": 48},
                    "updatedAt": 1710000000000,
                },
            }
        )
    )
    cost = _dump(
        execute_telemetry_route_contract(
            {
                "operation": "cost",
                "route": "cost",
                "cost": {
                    "amountUsd": 0.0015,
                    "estimatedUsd": 0.0015,
                    "actualUsd": None,
                    "source": "estimated",
                    "billingSource": "static_pricing_table",
                    "isEstimate": True,
                    "pricingSource": "contract_static_fixture",
                },
                "tokens": {
                    "promptTokens": 1000,
                    "completionTokens": 500,
                    "totalTokens": 1500,
                    "source": "estimated",
                },
            }
        )
    )
    error = _dump(
        execute_telemetry_route_contract(
            {
                "operation": "error",
                "route": "monitoring",
                "error": {
                    "code": "telemetry_contract_probe_failed",
                    "message": "Telemetry projection failed.",
                    "retryable": True,
                },
                "businessOutcome": {
                    "ok": True,
                    "telemetryErrorIgnored": True,
                },
            }
        )
    )

    return {
        "contractVersion": ROLLUP_CONTRACT_VERSION,
        "runtime": ROLLUP_RUNTIME,
        "status": status,
        "generatedAt": "2026-06-20T00:00:00.000Z",
        "provenance": {
            "source": "python-contract",
            "synthetic": True,
            "externalMonitoringRequest": False,
            "externalSink": False,
        },
        "health": {
            "status": status,
            "runtimeReachable": True,
            "checkedAt": "2026-06-20T00:00:00.000Z",
            "detail": "telemetry error envelope observed",
        },
        "telemetry": {
            "state": telemetry_state,
            "totalCalls": metrics["metrics"]["totalCalls"],
            "errorCount": metrics["metrics"]["errorCount"],
            "eventCount": 0,
            "latencyMs": metrics["metrics"]["latencyMs"],
            "tokens": metrics["metrics"]["tokens"],
            "updatedAt": metrics["metrics"]["updatedAt"],
        },
        "cost": {
            "state": cost_state,
            "amountUsd": cost["cost"]["amountUsd"],
            "estimatedUsd": cost["cost"]["estimatedUsd"],
            "actualUsd": cost["cost"]["actualUsd"],
            "source": cost["cost"]["source"],
            "billingSource": cost["cost"]["billingSource"],
            "isEstimate": cost["cost"]["isEstimate"],
            "tokens": cost["tokens"],
        },
        "error": {
            "state": "present",
            "count": 1,
            "lastError": error["error"],
            "envelopeStatus": error["status"],
        },
        "degradedReasons": ["telemetry_error_count_nonzero"],
    }


def _assert_rollup_contract(rollup):
    assert rollup["contractVersion"] == ROLLUP_CONTRACT_VERSION
    assert rollup["runtime"] == ROLLUP_RUNTIME
    assert rollup["status"] in ROLLUP_STATUSES
    assert rollup["health"]["status"] in ROLLUP_STATUSES
    assert rollup["telemetry"]["state"] in METRIC_STATES
    assert rollup["cost"]["state"] in METRIC_STATES
    assert rollup["error"]["state"] in METRIC_STATES
    assert rollup["provenance"]["externalMonitoringRequest"] is False
    assert rollup["provenance"]["externalSink"] is False
    if rollup["status"] == "healthy":
        assert rollup["health"]["status"] == "healthy"
        assert rollup["telemetry"]["state"] == "present"
        assert rollup["cost"]["state"] == "present"
        assert rollup["error"]["state"] == "present"
        assert rollup["degradedReasons"] == []


def test_python_rollup_exposes_health_error_telemetry_and_cost_summary():
    rollup = _build_rollup()

    _assert_rollup_contract(rollup)

    assert rollup["status"] == "degraded"
    assert rollup["health"]["runtimeReachable"] is True
    assert rollup["telemetry"]["errorCount"] == 1
    assert rollup["telemetry"]["tokens"] == {
        "promptTokens": 12,
        "completionTokens": 8,
        "totalTokens": 20,
        "source": "synthetic",
    }
    assert rollup["cost"]["source"] == "estimated"
    assert rollup["cost"]["actualUsd"] is None
    assert rollup["error"]["lastError"]["code"] == "telemetry_contract_probe_failed"
    assert rollup["degradedReasons"] == ["telemetry_error_count_nonzero"]


@pytest.mark.parametrize("missing_state", ["missing", "unknown"])
def test_unknown_or_missing_metric_state_cannot_be_healthy(missing_state):
    rollup = _build_rollup(
        status="healthy",
        telemetry_state=missing_state,
        cost_state="present",
    )

    with pytest.raises(AssertionError):
        _assert_rollup_contract(rollup)


def test_rollup_rejects_external_observability_sink_claims():
    rollup = _build_rollup()
    rollup["provenance"]["externalMonitoringRequest"] = True

    with pytest.raises(AssertionError):
        _assert_rollup_contract(rollup)
