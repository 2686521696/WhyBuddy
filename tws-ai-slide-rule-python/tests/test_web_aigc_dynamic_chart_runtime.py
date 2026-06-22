"""Runtime bridge tests for web AIGC dynamic chart adapter shapes.

Python owns only the chart decision envelope in this migration slice. It
normalizes chart specs, validates input data, and returns diagnostic envelopes
without calling a real chart renderer, BI platform, browser, or database.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.web_aigc_dynamic_chart_adapter import (  # noqa: E402
    execute_dynamic_chart_runtime_bridge,
)


def test_runtime_bridge_returns_chart_ready_spec_without_external_rendering():
    response = execute_dynamic_chart_runtime_bridge(
        {
            "chartType": "auto",
            "title": "Ticket Trend",
            "dataset": {
                "headers": ["day", "opened", "closed"],
                "rows": [
                    ["2026-06-20", 12, 9],
                    ["2026-06-21", 15, 11],
                ],
            },
            "artifact": {"enabled": True, "fileName": "ticket-trend"},
            "metadata": {"requestId": "chart-runtime-success"},
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is True
    assert response["status"] == "chart_ready"
    assert response["status"] != "invalid"
    assert response["chartSpec"]["chartType"] == "bar"
    assert response["chartSpec"]["ui"]["renderer"] == "recharts"
    assert response["chartSpec"]["dataset"]["rowCount"] == 2
    assert response["artifact"]["persisted"] is False
    assert response["runtime"] == {
        "backend": "python",
        "provider": "fake",
        "source": "python-dynamic-chart-runtime",
        "externalCalls": False,
        "rendered": False,
        "persisted": False,
    }
    assert response["metadata"]["requestId"] == "chart-runtime-success"


def test_runtime_bridge_invalid_data_is_not_chart_ready():
    response = execute_dynamic_chart_runtime_bridge(
        {
            "chartType": "bar",
            "dataset": {
                "headers": ["name", "state"],
                "rows": [
                    ["task-a", "done"],
                    ["task-b", "open"],
                ],
            },
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is False
    assert response["status"] == "invalid"
    assert response["status"] != "chart_ready"
    assert response.get("chartSpec") is None
    assert response["error"]["code"] == "invalid_data"
    assert "numeric value column" in response["error"]["message"]
    assert response["runtime"]["backend"] == "python"
    assert response["runtime"]["externalCalls"] is False


def test_runtime_bridge_unsupported_chart_is_invalid_not_chart_ready():
    response = execute_dynamic_chart_runtime_bridge(
        {
            "chartType": "radar",
            "dataset": {
                "headers": ["name", "score"],
                "rows": [["A", 10]],
            },
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is False
    assert response["status"] == "invalid"
    assert response["status"] != "chart_ready"
    assert response.get("chartSpec") is None
    assert response["error"]["code"] == "unsupported_chart"
    assert response["runtime"]["rendered"] is False


def test_runtime_bridge_degraded_provider_is_not_chart_ready():
    response = execute_dynamic_chart_runtime_bridge(
        {
            "scenario": "degraded",
            "chartType": "line",
            "dataset": {
                "kind": "series",
                "categories": ["Mon", "Tue"],
                "series": [{"name": "Visits", "data": [10, 12]}],
            },
            "metadata": {"auditId": "audit-chart-degraded"},
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is False
    assert response["status"] == "degraded"
    assert response["status"] != "chart_ready"
    assert response.get("chartSpec") is None
    assert response["error"]["code"] == "provider_degraded"
    assert response["warnings"] == ["Dynamic chart provider is degraded."]
    assert response["metadata"]["auditId"] == "audit-chart-degraded"
    assert response["runtime"]["externalCalls"] is False


def test_runtime_bridge_runtime_error_is_not_chart_ready():
    response = execute_dynamic_chart_runtime_bridge(
        {
            "scenario": "error",
            "chartType": "pie",
            "dataset": {
                "kind": "summary",
                "values": {"A": 4, "B": 6},
            },
        }
    ).model_dump(exclude_none=True)

    assert response["ok"] is False
    assert response["status"] == "error"
    assert response["status"] != "chart_ready"
    assert response.get("chartSpec") is None
    assert response["error"]["code"] == "runtime_error"
    assert response["runtime"]["provider"] == "fake"
