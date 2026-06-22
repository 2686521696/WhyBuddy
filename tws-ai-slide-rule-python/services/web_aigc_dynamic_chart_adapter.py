"""Python runtime bridge for the Web AIGC dynamic chart decision envelope.

This module intentionally does not render charts and does not call external
chart, BI, browser, or database services. It only normalizes chart specs,
validates input data, and returns diagnostic runtime envelopes for Node.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


DYNAMIC_CHART_CONTRACT_VERSION = "web_aigc.dynamic_chart_runtime.v1"

ChartType = Literal["bar", "line", "area", "pie"]
ChartRuntimeStatus = Literal["chart_ready", "invalid", "degraded", "error"]

COLOR_PALETTE = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
]


class ChartRuntimeMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    backend: Literal["python"] = "python"
    provider: Literal["fake"] = "fake"
    source: Literal["python-dynamic-chart-runtime"] = "python-dynamic-chart-runtime"
    externalCalls: Literal[False] = False
    rendered: Literal[False] = False
    persisted: Literal[False] = False


class ChartRuntimeError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str

    @field_validator("code", "message")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must be a non-empty string")
        return value


class ChartArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["inline_json"] = "inline_json"
    name: str
    mimeType: Literal["application/json"] = "application/json"
    description: str
    persisted: Literal[False] = False
    content: Dict[str, Any]


class DynamicChartRuntimeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[DYNAMIC_CHART_CONTRACT_VERSION] = DYNAMIC_CHART_CONTRACT_VERSION
    ok: bool
    status: ChartRuntimeStatus
    chartSpec: Optional[Dict[str, Any]] = None
    artifact: Optional[ChartArtifact] = None
    warnings: List[str] = Field(default_factory=list)
    error: Optional[ChartRuntimeError] = None
    runtime: ChartRuntimeMetadata = Field(default_factory=ChartRuntimeMetadata)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ChartValidationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def execute_dynamic_chart_runtime_bridge(payload: Dict[str, Any]) -> DynamicChartRuntimeResponse:
    """Return a Python dynamic-chart decision envelope without side effects."""

    if not isinstance(payload, dict):
        return _failure("invalid", "invalid_payload", "payload must be an object")

    metadata = _metadata(payload.get("metadata"))
    scenario = payload.get("scenario")

    if scenario == "degraded":
        return _failure(
            "degraded",
            "provider_degraded",
            "Dynamic chart provider is degraded.",
            warnings=["Dynamic chart provider is degraded."],
            metadata=metadata,
        )

    if scenario == "error":
        return _failure(
            "error",
            "runtime_error",
            "Dynamic chart runtime failed.",
            metadata=metadata,
        )

    try:
        chart_spec = _build_chart_spec(payload)
        artifact = _build_artifact(payload, chart_spec)
        return DynamicChartRuntimeResponse(
            ok=True,
            status="chart_ready",
            chartSpec=chart_spec,
            artifact=artifact,
            warnings=chart_spec.get("warnings", []),
            metadata=metadata,
        )
    except ChartValidationError as error:
        return _failure(
            "invalid",
            error.code,
            error.message,
            metadata=metadata,
        )
    except Exception as error:  # pragma: no cover - defensive envelope boundary
        return _failure(
            "error",
            "runtime_error",
            str(error) or "Dynamic chart runtime failed.",
            metadata=metadata,
        )


def _failure(
    status: Literal["invalid", "degraded", "error"],
    code: str,
    message: str,
    *,
    warnings: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> DynamicChartRuntimeResponse:
    return DynamicChartRuntimeResponse(
        ok=False,
        status=status,
        chartSpec=None,
        warnings=warnings or [],
        error=ChartRuntimeError(code=code, message=message),
        metadata=metadata or {},
    )


def _build_chart_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    requested_type = _read_chart_type(payload.get("chartType"))
    dataset = _normalize_dataset(payload.get("dataset"))
    chart_type = _resolve_chart_type(requested_type, dataset["summary"])
    warnings = _compatibility_warnings(chart_type, dataset["summary"])
    title = _read_optional_string(payload.get("title")) or _default_title(
        chart_type,
        dataset["summary"],
    )
    description = _read_optional_string(payload.get("description"))
    ui = _build_ui(chart_type, title, description, dataset["summary"], dataset["series"])

    chart_spec: Dict[str, Any] = {
        "chartType": chart_type,
        "title": title,
        "dataset": dataset["summary"],
        "ui": ui,
        "warnings": warnings,
    }
    if description:
        chart_spec["description"] = description
    return chart_spec


def _normalize_dataset(dataset: Any) -> Dict[str, Any]:
    if not isinstance(dataset, dict):
        raise ChartValidationError("invalid_data", "dynamic_chart input requires dataset.")

    if dataset.get("kind") == "summary":
        return _normalize_summary_dataset(dataset)

    if dataset.get("kind") == "series":
        return _normalize_series_dataset(dataset)

    return _normalize_table_dataset(dataset)


def _normalize_table_dataset(dataset: Dict[str, Any]) -> Dict[str, Any]:
    rows = dataset.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ChartValidationError(
            "invalid_data",
            "dynamic_chart table dataset requires a non-empty rows array.",
        )

    headers = _read_headers(dataset.get("headers"))
    normalized_rows: List[Dict[str, Any]] = []
    for row_index, row in enumerate(rows):
        if isinstance(row, list):
            row_headers = headers or [f"col_{index + 1}" for index in range(len(row))]
            normalized_rows.append(
                {key: row[index] if index < len(row) else None for index, key in enumerate(row_headers)}
            )
        elif isinstance(row, dict):
            if headers:
                normalized_rows.append({key: row.get(key) for key in headers})
            else:
                normalized_rows.append(dict(row))
        else:
            raise ChartValidationError(
                "invalid_data",
                f"dynamic_chart rows[{row_index}] must be an object row or array row.",
            )

    columns = headers or _infer_columns(normalized_rows)
    if not columns:
        raise ChartValidationError("invalid_data", "dynamic_chart table dataset has no columns.")

    requested_label = _read_optional_string(dataset.get("labelKey"))
    label_key = requested_label if requested_label in columns else _infer_label_key(columns, normalized_rows)
    requested_values = _read_string_list(dataset.get("valueKeys"))
    value_keys = (
        [key for key in requested_values if key in columns]
        if requested_values
        else _infer_value_keys(columns, normalized_rows, label_key)
    )
    if not value_keys:
        raise ChartValidationError(
            "invalid_data",
            "dynamic_chart dataset requires at least one numeric value column.",
        )

    output_rows = []
    for row in normalized_rows:
        output_row: Dict[str, Any] = {label_key: _display_label(row.get(label_key))}
        for key in value_keys:
            output_row[key] = _numeric_value(row.get(key)) or 0
        output_rows.append(output_row)

    summary = {
        "kind": "table",
        "labelKey": label_key,
        "valueKeys": value_keys,
        "rowCount": len(output_rows),
        "categories": [_display_label(row.get(label_key)) for row in output_rows],
        "rows": output_rows,
    }
    sheet_name = _read_optional_string(dataset.get("sheetName"))
    if sheet_name:
        summary["sheetName"] = sheet_name

    return {
        "summary": summary,
        "series": [
            {"key": key, "label": key, "color": _color_at(index)}
            for index, key in enumerate(value_keys)
        ],
    }


def _normalize_summary_dataset(dataset: Dict[str, Any]) -> Dict[str, Any]:
    values = dataset.get("values")
    if not isinstance(values, dict):
        raise ChartValidationError(
            "invalid_data",
            "dynamic_chart summary dataset requires values.",
        )

    entries = [
        {"label": _display_label(label), "value": numeric}
        for label, value in values.items()
        if (numeric := _numeric_value(value)) is not None
    ]
    if not entries:
        raise ChartValidationError(
            "invalid_data",
            "dynamic_chart summary dataset requires at least one numeric value.",
        )

    rows = [
        {"label": entry["label"], "value": entry["value"], "fill": _color_at(index)}
        for index, entry in enumerate(entries)
    ]
    return {
        "summary": {
            "kind": "summary",
            "labelKey": "label",
            "valueKeys": ["value"],
            "rowCount": len(rows),
            "categories": [row["label"] for row in rows],
            "rows": rows,
        },
        "series": [{"key": "value", "label": "value", "color": _color_at(0)}],
    }


def _normalize_series_dataset(dataset: Dict[str, Any]) -> Dict[str, Any]:
    categories = dataset.get("categories")
    if not isinstance(categories, list) or not categories:
        raise ChartValidationError(
            "invalid_data",
            "dynamic_chart series dataset requires a non-empty categories array.",
        )

    normalized_categories = [
        _read_optional_string(category) or f"item_{index + 1}"
        for index, category in enumerate(categories)
    ]
    raw_series = dataset.get("series")
    if not isinstance(raw_series, list) or not raw_series:
        raise ChartValidationError(
            "invalid_data",
            "dynamic_chart series dataset requires a non-empty series array.",
        )

    series = [
        _normalize_series_item(item, index, len(normalized_categories))
        for index, item in enumerate(raw_series)
    ]
    rows = []
    for category_index, category in enumerate(normalized_categories):
        row: Dict[str, Any] = {"category": category}
        for item in series:
            row[item["key"]] = item["values"][category_index]
        rows.append(row)

    return {
        "summary": {
            "kind": "series",
            "labelKey": "category",
            "valueKeys": [item["key"] for item in series],
            "rowCount": len(rows),
            "categories": normalized_categories,
            "rows": rows,
        },
        "series": [
            {"key": item["key"], "label": item["label"], "color": item["color"]}
            for item in series
        ],
    }


def _normalize_series_item(item: Any, index: int, category_count: int) -> Dict[str, Any]:
    if not isinstance(item, dict):
        raise ChartValidationError("invalid_data", f"dynamic_chart series[{index}] must be an object.")

    name = _read_optional_string(item.get("name"))
    if not name:
        raise ChartValidationError("invalid_data", f"dynamic_chart series[{index}].name is required.")

    data = item.get("data")
    if not isinstance(data, list) or len(data) != category_count:
        raise ChartValidationError(
            "invalid_data",
            f"dynamic_chart series[{index}].data length must match categories length.",
        )

    values = []
    for value_index, value in enumerate(data):
        numeric = _numeric_value(value)
        if numeric is None:
            raise ChartValidationError(
                "invalid_data",
                f"dynamic_chart series[{index}].data[{value_index}] must be numeric.",
            )
        values.append(numeric)

    return {
        "key": _sanitize_key(_read_optional_string(item.get("key")) or name, f"series_{index + 1}"),
        "label": name,
        "color": _read_optional_string(item.get("color")) or _color_at(index),
        "values": values,
    }


def _build_ui(
    chart_type: ChartType,
    title: str,
    description: Optional[str],
    dataset: Dict[str, Any],
    series: List[Dict[str, str]],
) -> Dict[str, Any]:
    ui = {
        "renderer": "recharts",
        "component": _component_for_chart_type(chart_type),
        "chartType": chart_type,
        "title": title,
        "data": dataset["rows"],
        "categoryKey": dataset["labelKey"],
        "valueKeys": dataset["valueKeys"],
        "series": series,
        "options": {
            "legend": True,
            "grid": chart_type != "pie",
            "stacked": False,
        },
    }
    if description:
        ui["description"] = description
    return ui


def _build_artifact(payload: Dict[str, Any], chart_spec: Dict[str, Any]) -> Optional[ChartArtifact]:
    artifact = payload.get("artifact")
    if not isinstance(artifact, dict) or artifact.get("enabled") is not True:
        return None

    raw_name = _read_optional_string(artifact.get("fileName")) or f"{chart_spec['title']}-{chart_spec['chartType']}"
    base_name = _sanitize_key(raw_name, "dynamic-chart")
    name = base_name if base_name.endswith(".json") else f"{base_name}.json"
    return ChartArtifact(
        name=name,
        description=f"Dynamic chart payload for {chart_spec['title']}",
        content={
            "chartType": chart_spec["chartType"],
            "title": chart_spec["title"],
            "dataset": chart_spec["dataset"],
            "ui": chart_spec["ui"],
        },
    )


def _read_chart_type(value: Any) -> Literal["auto", "bar", "line", "area", "pie"]:
    if value is None or value == "auto":
        return "auto"
    if value in {"bar", "line", "area", "pie"}:
        return value
    raise ChartValidationError(
        "unsupported_chart",
        "dynamic_chart chartType must be auto, bar, line, area, or pie.",
    )


def _resolve_chart_type(
    requested_type: Literal["auto", "bar", "line", "area", "pie"],
    dataset: Dict[str, Any],
) -> ChartType:
    if requested_type != "auto":
        return requested_type
    if dataset["kind"] == "summary":
        return "pie"
    if dataset["kind"] == "series":
        return "line"
    return "bar"


def _compatibility_warnings(chart_type: ChartType, dataset: Dict[str, Any]) -> List[str]:
    if chart_type == "pie" and len(dataset["valueKeys"]) > 1:
        raise ChartValidationError(
            "invalid_data",
            "dynamic_chart pie chart requires exactly one numeric value series.",
        )
    if dataset["kind"] == "summary" and chart_type != "pie":
        return ["summary datasets are usually best represented as pie charts."]
    return []


def _default_title(chart_type: ChartType, dataset: Dict[str, Any]) -> str:
    if dataset["kind"] == "table" and dataset.get("sheetName"):
        return f"{dataset['sheetName']} {chart_type} chart"
    if dataset["kind"] == "summary":
        return "summary chart"
    if dataset["kind"] == "series":
        return "trend chart"
    return f"{chart_type} chart"


def _component_for_chart_type(chart_type: ChartType) -> str:
    return {
        "bar": "BarChart",
        "line": "LineChart",
        "area": "AreaChart",
        "pie": "PieChart",
    }[chart_type]


def _metadata(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _read_optional_string(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _read_string_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _read_headers(value: Any) -> List[str]:
    return [
        _sanitize_key(header, f"col_{index + 1}")
        for index, header in enumerate(_read_string_list(value))
    ]


def _infer_columns(rows: List[Dict[str, Any]]) -> List[str]:
    columns: List[str] = []
    for row in rows:
        for key in row.keys():
            if key not in columns:
                columns.append(key)
    return columns


def _infer_label_key(columns: List[str], rows: List[Dict[str, Any]]) -> str:
    for column in columns:
        if any(_numeric_value(row.get(column)) is None for row in rows):
            return column
    return columns[0]


def _infer_value_keys(columns: List[str], rows: List[Dict[str, Any]], label_key: str) -> List[str]:
    return [
        column
        for column in columns
        if column != label_key and any(_numeric_value(row.get(column)) is not None for row in rows)
    ]


def _numeric_value(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    if isinstance(value, str) and value.strip():
        try:
            numeric = float(value.strip())
        except ValueError:
            return None
        return numeric if numeric == numeric and numeric not in (float("inf"), float("-inf")) else None
    return None


def _display_label(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _sanitize_key(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]+", "_", str(value).strip()).strip("_")
    return normalized or fallback


def _color_at(index: int) -> str:
    return COLOR_PALETTE[index % len(COLOR_PALETTE)]
