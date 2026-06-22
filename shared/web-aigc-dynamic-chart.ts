export const WEB_AIGC_DYNAMIC_CHART_API = {
  EXECUTE: "POST /api/dynamic-chart/nodes/execute",
} as const;

export const WEB_AIGC_DYNAMIC_CHART_NODE_TYPES = [
  "dynamic_chart",
] as const;

export type DynamicChartNodeType =
  (typeof WEB_AIGC_DYNAMIC_CHART_NODE_TYPES)[number];

export const WEB_AIGC_DYNAMIC_CHART_TYPES = [
  "bar",
  "line",
  "area",
  "pie",
] as const;

export type WebAigcDynamicChartType =
  (typeof WEB_AIGC_DYNAMIC_CHART_TYPES)[number];

export type WebAigcDynamicChartRequestedType =
  | WebAigcDynamicChartType
  | "auto";

export const WEB_AIGC_DYNAMIC_CHART_DATASET_KINDS = [
  "table",
  "summary",
  "series",
] as const;

export type WebAigcDynamicChartDatasetKind =
  (typeof WEB_AIGC_DYNAMIC_CHART_DATASET_KINDS)[number];

export type WebAigcDynamicChartPythonStatus =
  | "chart_ready"
  | "invalid"
  | "degraded"
  | "error";

export type DynamicChartNodeOutputStatus =
  | "completed"
  | "degraded"
  | "failed";

export interface WebAigcDynamicChartTableDatasetInput {
  kind?: "table";
  sheetName?: string;
  headers?: string[];
  rows?: Array<Record<string, unknown> | unknown[]>;
  labelKey?: string;
  valueKeys?: string[];
}

export interface WebAigcDynamicChartSummaryDatasetInput {
  kind: "summary";
  values: Record<string, number>;
}

export interface WebAigcDynamicChartSeriesItemInput {
  key?: string;
  name: string;
  data: number[];
  color?: string;
}

export interface WebAigcDynamicChartSeriesDatasetInput {
  kind: "series";
  categories: string[];
  series: WebAigcDynamicChartSeriesItemInput[];
}

export type WebAigcDynamicChartDatasetInput =
  | WebAigcDynamicChartTableDatasetInput
  | WebAigcDynamicChartSummaryDatasetInput
  | WebAigcDynamicChartSeriesDatasetInput;

export interface WebAigcDynamicChartArtifactInput {
  enabled?: boolean;
  fileName?: string;
}

export interface DynamicChartNodeInput {
  chartType?: WebAigcDynamicChartRequestedType;
  title?: string;
  description?: string;
  dataset?: WebAigcDynamicChartDatasetInput;
  artifact?: WebAigcDynamicChartArtifactInput;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface DynamicChartNodeExecutionRequest {
  nodeType: DynamicChartNodeType;
  input?: DynamicChartNodeInput;
}

export interface WebAigcDynamicChartSeriesDefinition {
  key: string;
  label: string;
  color: string;
}

export interface WebAigcDynamicChartDatasetSummary {
  kind: WebAigcDynamicChartDatasetKind;
  sheetName?: string;
  labelKey: string;
  valueKeys: string[];
  rowCount: number;
  categories: string[];
  rows: Array<Record<string, string | number | null>>;
}

export interface WebAigcDynamicChartUiPayload {
  renderer: "recharts";
  component: "BarChart" | "LineChart" | "AreaChart" | "PieChart";
  chartType: WebAigcDynamicChartType;
  title: string;
  description?: string;
  data: Array<Record<string, string | number | null>>;
  categoryKey: string;
  valueKeys: string[];
  series: WebAigcDynamicChartSeriesDefinition[];
  options: {
    legend: boolean;
    grid: boolean;
    stacked: boolean;
  };
}

export interface WebAigcDynamicChartArtifactPayload {
  kind: "inline_json";
  name: string;
  mimeType: "application/json";
  description: string;
  persisted?: boolean;
  content: {
    chartType: WebAigcDynamicChartType;
    title: string;
    dataset: WebAigcDynamicChartDatasetSummary;
    ui: WebAigcDynamicChartUiPayload;
  };
}

export interface WebAigcDynamicChartSpec {
  chartType: WebAigcDynamicChartType;
  title: string;
  description?: string;
  dataset: WebAigcDynamicChartDatasetSummary;
  ui: WebAigcDynamicChartUiPayload;
}

export interface WebAigcDynamicChartRuntimeMetadata {
  backend: "python" | string;
  provider: "fake" | string;
  source: string;
  externalCalls: boolean;
  rendered?: boolean;
  persisted?: boolean;
}

export interface WebAigcDynamicChartError {
  code: string;
  message: string;
}

export interface WebAigcDynamicChartPythonRuntimeResponse {
  contractVersion?: string;
  ok: boolean;
  status: WebAigcDynamicChartPythonStatus;
  chartSpec?: WebAigcDynamicChartSpec | null;
  artifact?: WebAigcDynamicChartArtifactPayload;
  warnings?: string[];
  error?: WebAigcDynamicChartError;
  runtime?: WebAigcDynamicChartRuntimeMetadata;
  metadata?: Record<string, unknown>;
}

export interface DynamicChartNodeOutput {
  status: DynamicChartNodeOutputStatus;
  pythonStatus?: WebAigcDynamicChartPythonStatus;
  chartType?: WebAigcDynamicChartType;
  title?: string;
  description?: string;
  dataset?: WebAigcDynamicChartDatasetSummary;
  ui?: WebAigcDynamicChartUiPayload;
  artifact?: WebAigcDynamicChartArtifactPayload;
  context: Record<string, unknown>;
  warnings: string[];
  error?: WebAigcDynamicChartError;
  runtime?: WebAigcDynamicChartRuntimeMetadata;
  metadata?: Record<string, unknown>;
  observability?: {
    eventKey: "ui.dynamic_chart";
    nodeType: DynamicChartNodeType;
    chartType: WebAigcDynamicChartType;
    datasetKind: WebAigcDynamicChartDatasetKind;
    rowCount: number;
    seriesCount: number;
    artifactEnabled: boolean;
  };
}

export interface DynamicChartNodeExecutionResult {
  ok: boolean;
  nodeType: DynamicChartNodeType;
  output: DynamicChartNodeOutput;
}
