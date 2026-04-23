import type {
  DynamicChartNodeExecutionRequest,
  DynamicChartNodeExecutionResult,
  DynamicChartNodeInput,
  DynamicChartNodeType,
  WebAigcDynamicChartArtifactPayload,
  WebAigcDynamicChartDatasetInput,
  WebAigcDynamicChartDatasetSummary,
  WebAigcDynamicChartRequestedType,
  WebAigcDynamicChartSeriesDatasetInput,
  WebAigcDynamicChartSeriesDefinition,
  WebAigcDynamicChartSeriesItemInput,
  WebAigcDynamicChartSummaryDatasetInput,
  WebAigcDynamicChartTableDatasetInput,
  WebAigcDynamicChartType,
  WebAigcDynamicChartUiPayload,
} from "../../../shared/web-aigc-dynamic-chart.js";

const COLOR_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

type NormalizedDataset = {
  summary: WebAigcDynamicChartDatasetSummary;
  series: WebAigcDynamicChartSeriesDefinition[];
  warnings: string[];
};

export class DynamicChartNodeError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DynamicChartNodeError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return { ...value };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toDisplayLabel(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toNumericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const normalized = Number(value.trim());
    if (Number.isFinite(normalized)) {
      return normalized;
    }
  }

  return undefined;
}

function sanitizeKey(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function colorAt(index: number): string {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

function normalizeRequestedChartType(value: unknown): WebAigcDynamicChartRequestedType {
  return value === "bar" ||
    value === "line" ||
    value === "area" ||
    value === "pie"
    ? value
    : "auto";
}

function isSummaryDataset(
  value: WebAigcDynamicChartDatasetInput | undefined,
): value is WebAigcDynamicChartSummaryDatasetInput {
  return Boolean(value && isRecord(value) && value.kind === "summary");
}

function isSeriesDataset(
  value: WebAigcDynamicChartDatasetInput | undefined,
): value is WebAigcDynamicChartSeriesDatasetInput {
  return Boolean(value && isRecord(value) && value.kind === "series");
}

function normalizeTableRows(
  input: WebAigcDynamicChartTableDatasetInput,
): Array<Record<string, unknown>> {
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new DynamicChartNodeError(
      400,
      "dynamic_chart table dataset requires a non-empty rows array.",
    );
  }

  const explicitHeaders = Array.isArray(input.headers)
    ? input.headers.map((header, index) =>
        sanitizeKey(normalizeString(header) || `col_${index + 1}`, `col_${index + 1}`),
      )
    : undefined;

  return input.rows.map((row, rowIndex) => {
    if (Array.isArray(row)) {
      const headers =
        explicitHeaders && explicitHeaders.length > 0
          ? explicitHeaders
          : row.map((_, index) => `col_${index + 1}`);
      return headers.reduce<Record<string, unknown>>((accumulator, key, index) => {
        accumulator[key] = row[index];
        return accumulator;
      }, {});
    }

    if (isRecord(row)) {
      const record = explicitHeaders
        ? explicitHeaders.reduce<Record<string, unknown>>((accumulator, key) => {
            accumulator[key] = row[key];
            return accumulator;
          }, {})
        : { ...row };
      return record;
    }

    throw new DynamicChartNodeError(
      400,
      `dynamic_chart rows[${rowIndex}] must be an object row or array row.`,
    );
  });
}

function inferColumns(
  rows: Array<Record<string, unknown>>,
  headers?: string[],
): string[] {
  if (headers && headers.length > 0) {
    return headers;
  }

  const columns = new Set<string>();
  for (const row of rows) {
    Object.keys(row).forEach(key => columns.add(key));
  }

  return [...columns];
}

function inferLabelKey(columns: string[], rows: Array<Record<string, unknown>>): string {
  const preferred = columns.find(column =>
    rows.some(row => toNumericValue(row[column]) === undefined),
  );

  return preferred || columns[0];
}

function inferValueKeys(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  labelKey: string,
): string[] {
  return columns.filter(column => {
    if (column === labelKey) {
      return false;
    }

    return rows.some(row => toNumericValue(row[column]) !== undefined);
  });
}

function normalizeTableDataset(
  input: WebAigcDynamicChartTableDatasetInput,
): NormalizedDataset {
  const rows = normalizeTableRows(input);
  const columns = inferColumns(
    rows,
    Array.isArray(input.headers)
      ? input.headers.map((header, index) =>
          sanitizeKey(normalizeString(header) || `col_${index + 1}`, `col_${index + 1}`),
        )
      : undefined,
  );

  if (columns.length === 0) {
    throw new DynamicChartNodeError(400, "dynamic_chart table dataset has no columns.");
  }

  const labelKey =
    normalizeString(input.labelKey) && columns.includes(normalizeString(input.labelKey)!)
      ? normalizeString(input.labelKey)!
      : inferLabelKey(columns, rows);
  const requestedValueKeys = Array.isArray(input.valueKeys)
    ? input.valueKeys
        .map(valueKey => normalizeString(valueKey))
        .filter((valueKey): valueKey is string => Boolean(valueKey))
    : undefined;
  const valueKeys =
    requestedValueKeys && requestedValueKeys.length > 0
      ? requestedValueKeys.filter(valueKey => columns.includes(valueKey))
      : inferValueKeys(columns, rows, labelKey);

  if (valueKeys.length === 0) {
    throw new DynamicChartNodeError(
      400,
      "dynamic_chart dataset requires at least one numeric value column.",
    );
  }

  const normalizedRows = rows.map(row => {
    const normalized: Record<string, string | number | null> = {
      [labelKey]: toDisplayLabel(row[labelKey]),
    };

    for (const valueKey of valueKeys) {
      const numeric = toNumericValue(row[valueKey]);
      normalized[valueKey] = typeof numeric === "number" ? numeric : 0;
    }

    return normalized;
  });

  return {
    summary: {
      kind: "table",
      ...(normalizeString(input.sheetName) ? { sheetName: normalizeString(input.sheetName) } : {}),
      labelKey,
      valueKeys,
      rowCount: normalizedRows.length,
      categories: normalizedRows.map(row => toDisplayLabel(row[labelKey])),
      rows: normalizedRows,
    },
    series: valueKeys.map((valueKey, index) => ({
      key: valueKey,
      label: valueKey,
      color: colorAt(index),
    })),
    warnings: [],
  };
}

function normalizeSummaryDataset(
  input: WebAigcDynamicChartSummaryDatasetInput,
): NormalizedDataset {
  const entries = Object.entries(input.values)
    .map(([label, value]) => ({
      label: normalizeString(label) || label,
      value: toNumericValue(value),
    }))
    .filter((entry): entry is { label: string; value: number } => typeof entry.value === "number");

  if (entries.length === 0) {
    throw new DynamicChartNodeError(
      400,
      "dynamic_chart summary dataset requires at least one numeric value.",
    );
  }

  const rows = entries.map((entry, index) => ({
    label: entry.label,
    value: entry.value,
    fill: colorAt(index),
  }));

  return {
    summary: {
      kind: "summary",
      labelKey: "label",
      valueKeys: ["value"],
      rowCount: rows.length,
      categories: rows.map(row => row.label),
      rows,
    },
    series: [
      {
        key: "value",
        label: "值",
        color: colorAt(0),
      },
    ],
    warnings: [],
  };
}

function normalizeSeriesItem(
  item: WebAigcDynamicChartSeriesItemInput,
  index: number,
  categoryCount: number,
): WebAigcDynamicChartSeriesDefinition & { values: number[] } {
  const name = normalizeString(item.name);
  if (!name) {
    throw new DynamicChartNodeError(
      400,
      `dynamic_chart series[${index}].name is required.`,
    );
  }

  if (!Array.isArray(item.data) || item.data.length !== categoryCount) {
    throw new DynamicChartNodeError(
      400,
      `dynamic_chart series[${index}].data length must match categories length.`,
    );
  }

  const values = item.data.map((value, valueIndex) => {
    const numeric = toNumericValue(value);
    if (typeof numeric !== "number") {
      throw new DynamicChartNodeError(
        400,
        `dynamic_chart series[${index}].data[${valueIndex}] must be numeric.`,
      );
    }

    return numeric;
  });

  const key = sanitizeKey(normalizeString(item.key) || name, `series_${index + 1}`);
  return {
    key,
    label: name,
    color: normalizeString(item.color) || colorAt(index),
    values,
  };
}

function normalizeSeriesDataset(
  input: WebAigcDynamicChartSeriesDatasetInput,
): NormalizedDataset {
  if (!Array.isArray(input.categories) || input.categories.length === 0) {
    throw new DynamicChartNodeError(
      400,
      "dynamic_chart series dataset requires a non-empty categories array.",
    );
  }

  const categories = input.categories.map((category, index) =>
    normalizeString(category) || `item_${index + 1}`,
  );

  if (!Array.isArray(input.series) || input.series.length === 0) {
    throw new DynamicChartNodeError(
      400,
      "dynamic_chart series dataset requires a non-empty series array.",
    );
  }

  const series = input.series.map((item, index) =>
    normalizeSeriesItem(item, index, categories.length),
  );

  const rows = categories.map((category, index) => {
    const row: Record<string, string | number | null> = {
      category,
    };
    for (const seriesItem of series) {
      row[seriesItem.key] = seriesItem.values[index];
    }
    return row;
  });

  return {
    summary: {
      kind: "series",
      labelKey: "category",
      valueKeys: series.map(seriesItem => seriesItem.key),
      rowCount: rows.length,
      categories,
      rows,
    },
    series: series.map(({ key, label, color }) => ({
      key,
      label,
      color,
    })),
    warnings: [],
  };
}

function normalizeDataset(
  dataset: WebAigcDynamicChartDatasetInput | undefined,
): NormalizedDataset {
  if (!dataset || !isRecord(dataset)) {
    throw new DynamicChartNodeError(
      400,
      "dynamic_chart input requires dataset.",
    );
  }

  if (isSummaryDataset(dataset)) {
    return normalizeSummaryDataset(dataset);
  }

  if (isSeriesDataset(dataset)) {
    return normalizeSeriesDataset(dataset);
  }

  return normalizeTableDataset(dataset as WebAigcDynamicChartTableDatasetInput);
}

function resolveChartType(
  requestedType: WebAigcDynamicChartRequestedType,
  dataset: WebAigcDynamicChartDatasetSummary,
): WebAigcDynamicChartType {
  if (requestedType !== "auto") {
    return requestedType;
  }

  if (dataset.kind === "summary") {
    return "pie";
  }

  if (dataset.kind === "series") {
    return "line";
  }

  return "bar";
}

function componentForChartType(
  chartType: WebAigcDynamicChartType,
): WebAigcDynamicChartUiPayload["component"] {
  if (chartType === "line") {
    return "LineChart";
  }

  if (chartType === "area") {
    return "AreaChart";
  }

  if (chartType === "pie") {
    return "PieChart";
  }

  return "BarChart";
}

function ensureChartTypeCompatibility(
  chartType: WebAigcDynamicChartType,
  dataset: WebAigcDynamicChartDatasetSummary,
): string[] {
  const warnings: string[] = [];

  if (chartType === "pie" && dataset.valueKeys.length > 1) {
    throw new DynamicChartNodeError(
      400,
      "dynamic_chart pie chart requires exactly one numeric value series.",
    );
  }

  if (dataset.kind === "summary" && chartType !== "pie") {
    warnings.push("summary 数据集默认更适合饼图；当前已按请求输出其他图表类型。");
  }

  return warnings;
}

function defaultTitle(
  chartType: WebAigcDynamicChartType,
  dataset: WebAigcDynamicChartDatasetSummary,
): string {
  if (dataset.kind === "table" && dataset.sheetName) {
    return `${dataset.sheetName} ${chartType} 图表`;
  }

  if (dataset.kind === "summary") {
    return "统计汇总图表";
  }

  if (dataset.kind === "series") {
    return "趋势图表";
  }

  return `${chartType} 图表`;
}

function buildUiPayload(input: {
  chartType: WebAigcDynamicChartType;
  title: string;
  description?: string;
  dataset: WebAigcDynamicChartDatasetSummary;
  series: WebAigcDynamicChartSeriesDefinition[];
}): WebAigcDynamicChartUiPayload {
  return {
    renderer: "recharts",
    component: componentForChartType(input.chartType),
    chartType: input.chartType,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    data: input.dataset.rows,
    categoryKey: input.dataset.labelKey,
    valueKeys: input.dataset.valueKeys,
    series: input.series,
    options: {
      legend: true,
      grid: input.chartType !== "pie",
      stacked: false,
    },
  };
}

function buildArtifact(
  input: {
    fileName?: string;
    chartType: WebAigcDynamicChartType;
    title: string;
    dataset: WebAigcDynamicChartDatasetSummary;
    ui: WebAigcDynamicChartUiPayload;
  },
): WebAigcDynamicChartArtifactPayload {
  const baseName = sanitizeKey(
    normalizeString(input.fileName) || `${input.title}-${input.chartType}`,
    "dynamic-chart",
  );

  return {
    kind: "inline_json",
    name: baseName.endsWith(".json") ? baseName : `${baseName}.json`,
    mimeType: "application/json",
    description: `Dynamic chart payload for ${input.title}`,
    content: {
      chartType: input.chartType,
      title: input.title,
      dataset: input.dataset,
      ui: input.ui,
    },
  };
}

function buildContext(
  input: DynamicChartNodeInput,
  dataset: WebAigcDynamicChartDatasetSummary,
  ui: WebAigcDynamicChartUiPayload,
  artifact: WebAigcDynamicChartArtifactPayload | undefined,
): Record<string, unknown> {
  const baseContext = normalizeObject(input.context);

  return {
    ...baseContext,
    dynamicChart: {
      chartType: ui.chartType,
      title: ui.title,
      dataset,
      ui,
      ...(artifact ? { artifact } : {}),
    },
  };
}

export function isDynamicChartNodeType(
  value: unknown,
): value is DynamicChartNodeType {
  return value === "dynamic_chart";
}

export async function executeDynamicChartNode(
  request: DynamicChartNodeExecutionRequest,
): Promise<DynamicChartNodeExecutionResult> {
  if (!isDynamicChartNodeType(request.nodeType)) {
    throw new DynamicChartNodeError(
      400,
      "Unsupported dynamic_chart node type.",
    );
  }

  const input = request.input ?? {};
  const datasetResult = normalizeDataset(input.dataset);
  const requestedType = normalizeRequestedChartType(input.chartType);
  const chartType = resolveChartType(requestedType, datasetResult.summary);
  const warnings = [
    ...datasetResult.warnings,
    ...ensureChartTypeCompatibility(chartType, datasetResult.summary),
  ];
  const title =
    normalizeString(input.title) || defaultTitle(chartType, datasetResult.summary);
  const description = normalizeString(input.description);
  const ui = buildUiPayload({
    chartType,
    title,
    ...(description ? { description } : {}),
    dataset: datasetResult.summary,
    series: datasetResult.series,
  });
  const artifactEnabled = normalizeBoolean(input.artifact?.enabled, false);
  const artifact = artifactEnabled
    ? buildArtifact({
        fileName: normalizeString(input.artifact?.fileName),
        chartType,
        title,
        dataset: datasetResult.summary,
        ui,
      })
    : undefined;

  return {
    ok: true,
    nodeType: "dynamic_chart",
    output: {
      status: "completed",
      chartType,
      title,
      ...(description ? { description } : {}),
      dataset: datasetResult.summary,
      ui,
      ...(artifact ? { artifact } : {}),
      context: buildContext(input, datasetResult.summary, ui, artifact),
      warnings,
      observability: {
        eventKey: "ui.dynamic_chart",
        nodeType: "dynamic_chart",
        chartType,
        datasetKind: datasetResult.summary.kind,
        rowCount: datasetResult.summary.rowCount,
        seriesCount: datasetResult.series.length,
        artifactEnabled,
      },
    },
  };
}
