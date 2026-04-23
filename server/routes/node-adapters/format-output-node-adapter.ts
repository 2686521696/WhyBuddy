import { inspect } from "node:util";

export type FormatOutputNodeType = "format_output";
export type FormatOutputFormat = "text" | "json" | "table" | "template";

export interface FormatOutputNodeInput {
  format?: FormatOutputFormat;
  raw?: unknown;
  data?: unknown;
  template?: string;
  columns?: string[];
  title?: string;
}

export interface FormatOutputNodeExecutionRequest {
  nodeType: FormatOutputNodeType;
  input?: FormatOutputNodeInput;
}

export interface FormatOutputNodeExecutionResult {
  ok: true;
  nodeType: FormatOutputNodeType;
  output: {
    status: "completed";
    requestedFormat: FormatOutputFormat;
    format: FormatOutputFormat | "text";
    content: string;
    structured: unknown;
    fallbackUsed: boolean;
    error?: string;
    metadata: {
      title?: string;
      contentType: string;
      rowCount?: number;
      columnCount?: number;
      templateKeys?: string[];
      fallbackFrom?: FormatOutputFormat;
      downstreamConsumers: Array<"end" | "file_generation">;
    };
  };
}

interface TableRenderResult {
  content: string;
  structured: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
  };
  metadata: Pick<
    FormatOutputNodeExecutionResult["output"]["metadata"],
    "contentType" | "rowCount" | "columnCount"
  >;
}

const DOWNSTREAM_CONSUMERS = ["end", "file_generation"] as const;

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeColumns(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFormat(value: unknown): FormatOutputFormat {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "text"
  ) {
    return "text";
  }

  if (
    value === "json" ||
    value === "table" ||
    value === "template"
  ) {
    return value;
  }

  throw new Error(
    "Unsupported format_output format. Expected text, json, table, or template.",
  );
}

function resolveSourceValue(input: FormatOutputNodeInput): unknown {
  if (input.data !== undefined) {
    return input.data;
  }

  if (input.raw !== undefined) {
    return input.raw;
  }

  return "";
}

function stringifyDisplayValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "";
  }

  try {
    const serialized = JSON.stringify(
      value,
      (_key, candidate) => {
        if (typeof candidate === "bigint") {
          return candidate.toString();
        }
        if (typeof candidate === "function" || typeof candidate === "symbol") {
          return String(candidate);
        }
        return candidate;
      },
      2,
    );
    if (typeof serialized === "string") {
      return serialized;
    }
  } catch {
    return inspect(value, {
      depth: 6,
      breakLength: Infinity,
      maxArrayLength: 50,
    });
  }

  return inspect(value, {
    depth: 6,
    breakLength: Infinity,
    maxArrayLength: 50,
  });
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  if (
    (normalized.startsWith("{") && normalized.endsWith("}")) ||
    (normalized.startsWith("[") && normalized.endsWith("]"))
  ) {
    try {
      return JSON.parse(normalized);
    } catch {
      return value;
    }
  }

  return value;
}

function stringifyJsonValue(value: unknown): string {
  const normalizedValue = parseMaybeJson(value);
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(
    normalizedValue === undefined ? null : normalizedValue,
    (_key, candidate) => {
      if (typeof candidate === "bigint") {
        return candidate.toString();
      }
      if (typeof candidate === "function" || typeof candidate === "symbol") {
        return String(candidate);
      }
      if (candidate && typeof candidate === "object") {
        if (seen.has(candidate)) {
          throw new Error(
            "Circular structure is not supported for json format.",
          );
        }
        seen.add(candidate);
      }
      return candidate;
    },
    2,
  );

  if (typeof serialized !== "string") {
    return "null";
  }

  return serialized;
}

function escapeTableCell(value: unknown): string {
  return stringifyDisplayValue(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br/>");
}

function normalizeTableRows(value: unknown): Array<Record<string, unknown>> {
  const normalizedValue = parseMaybeJson(value);
  const sourceRows =
    Array.isArray(normalizedValue)
      ? normalizedValue
      : isRecord(normalizedValue) && Array.isArray(normalizedValue.rows)
        ? normalizedValue.rows
        : null;

  if (!sourceRows) {
    throw new Error(
      "Table format requires an array of rows or an object with rows.",
    );
  }

  return sourceRows.map((row, rowIndex) => {
    if (isRecord(row)) {
      return row;
    }

    if (Array.isArray(row)) {
      return row.reduce<Record<string, unknown>>((accumulator, cell, cellIndex) => {
        accumulator[`col_${cellIndex + 1}`] = cell;
        return accumulator;
      }, {});
    }

    return {
      value: row,
      rowIndex,
    };
  });
}

function resolveTableColumns(
  rows: Array<Record<string, unknown>>,
  requestedColumns: string[] | undefined,
): string[] {
  if (requestedColumns && requestedColumns.length > 0) {
    return requestedColumns;
  }

  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
  }

  return columns.length > 0 ? columns : ["value"];
}

function renderTable(
  value: unknown,
  requestedColumns: string[] | undefined,
): TableRenderResult {
  const rows = normalizeTableRows(value);
  const columns = resolveTableColumns(rows, requestedColumns);
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const lines = rows.map((row) =>
    `| ${columns.map((column) => escapeTableCell(row[column])).join(" | ")} |`,
  );

  return {
    content: [header, separator, ...lines].join("\n"),
    structured: {
      columns,
      rows,
    },
    metadata: {
      contentType: "text/markdown; charset=utf-8",
      rowCount: rows.length,
      columnCount: columns.length,
    },
  };
}

function resolveTemplatePath(
  context: Record<string, unknown>,
  path: string,
): unknown {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = context;

  for (const segment of segments) {
    if (isRecord(current) && segment in current) {
      current = current[segment];
      continue;
    }

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }

    throw new Error(`Template variable "${path}" is missing.`);
  }

  return current;
}

function buildTemplateContext(
  value: unknown,
  title: string | undefined,
): Record<string, unknown> {
  if (isRecord(value)) {
    return {
      ...value,
      value,
      ...(title ? { title } : {}),
    };
  }

  return {
    value,
    ...(title ? { title } : {}),
  };
}

function renderTemplate(
  template: string,
  value: unknown,
  title: string | undefined,
): {
  content: string;
  structured: {
    rendered: string;
    template: string;
    variables: string[];
    source: unknown;
  };
  metadata: Pick<
    FormatOutputNodeExecutionResult["output"]["metadata"],
    "contentType" | "templateKeys"
  >;
} {
  const context = buildTemplateContext(value, title);
  const templateKeys = Array.from(
    new Set(
      Array.from(template.matchAll(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g)).map(
        (match) => match[1],
      ),
    ),
  );

  const content = template.replace(
    /{{\s*([a-zA-Z0-9_.]+)\s*}}/g,
    (_match, path: string) => stringifyDisplayValue(resolveTemplatePath(context, path)),
  );

  return {
    content,
    structured: {
      rendered: content,
      template,
      variables: templateKeys,
      source: value,
    },
    metadata: {
      contentType: "text/plain; charset=utf-8",
      templateKeys,
    },
  };
}

function buildCompletedResult(input: {
  requestedFormat: FormatOutputFormat;
  format: FormatOutputNodeExecutionResult["output"]["format"];
  content: string;
  structured: unknown;
  title?: string;
  error?: string;
  fallbackUsed: boolean;
  metadata: Partial<FormatOutputNodeExecutionResult["output"]["metadata"]>;
}): FormatOutputNodeExecutionResult {
  return {
    ok: true,
    nodeType: "format_output",
    output: {
      status: "completed",
      requestedFormat: input.requestedFormat,
      format: input.format,
      content: input.content,
      structured: input.structured,
      fallbackUsed: input.fallbackUsed,
      ...(input.error ? { error: input.error } : {}),
      metadata: {
        ...(input.title ? { title: input.title } : {}),
        contentType:
          input.metadata.contentType ?? "text/plain; charset=utf-8",
        ...(typeof input.metadata.rowCount === "number"
          ? { rowCount: input.metadata.rowCount }
          : {}),
        ...(typeof input.metadata.columnCount === "number"
          ? { columnCount: input.metadata.columnCount }
          : {}),
        ...(input.metadata.templateKeys
          ? { templateKeys: input.metadata.templateKeys }
          : {}),
        ...(input.metadata.fallbackFrom
          ? { fallbackFrom: input.metadata.fallbackFrom }
          : {}),
        downstreamConsumers: [...DOWNSTREAM_CONSUMERS],
      },
    },
  };
}

function buildFallbackResult(
  requestedFormat: FormatOutputFormat,
  sourceValue: unknown,
  title: string | undefined,
  error: unknown,
): FormatOutputNodeExecutionResult {
  const message =
    error instanceof Error ? error.message : "Format output node failed.";

  return buildCompletedResult({
    requestedFormat,
    format: "text",
    content: stringifyDisplayValue(sourceValue),
    structured: sourceValue,
    title,
    error: message,
    fallbackUsed: true,
    metadata: {
      contentType: "text/plain; charset=utf-8",
      fallbackFrom: requestedFormat,
    },
  });
}

export function isFormatOutputNodeType(
  value: unknown,
): value is FormatOutputNodeType {
  return value === "format_output";
}

export async function executeFormatOutputNode(
  request: FormatOutputNodeExecutionRequest,
): Promise<FormatOutputNodeExecutionResult> {
  if (!isFormatOutputNodeType(request.nodeType)) {
    throw new Error("Unsupported format_output node type.");
  }

  const input = request.input ?? {};
  const requestedFormat = normalizeFormat(input.format);
  const sourceValue = resolveSourceValue(input);
  const title = normalizeString(input.title);
  const columns = normalizeColumns(input.columns);

  try {
    if (requestedFormat === "text") {
      return buildCompletedResult({
        requestedFormat,
        format: "text",
        content: stringifyDisplayValue(sourceValue),
        structured: sourceValue,
        title,
        fallbackUsed: false,
        metadata: {
          contentType: "text/plain; charset=utf-8",
        },
      });
    }

    if (requestedFormat === "json") {
      const normalizedValue = parseMaybeJson(sourceValue);
      return buildCompletedResult({
        requestedFormat,
        format: "json",
        content: stringifyJsonValue(normalizedValue),
        structured: normalizedValue === undefined ? null : normalizedValue,
        title,
        fallbackUsed: false,
        metadata: {
          contentType: "application/json; charset=utf-8",
        },
      });
    }

    if (requestedFormat === "table") {
      const table = renderTable(sourceValue, columns);
      return buildCompletedResult({
        requestedFormat,
        format: "table",
        content: table.content,
        structured: table.structured,
        title,
        fallbackUsed: false,
        metadata: table.metadata,
      });
    }

    const template = normalizeString(input.template);
    if (!template) {
      throw new Error(
        "Template format requires template content.",
      );
    }
    const rendered = renderTemplate(template, sourceValue, title);
    return buildCompletedResult({
      requestedFormat,
      format: "template",
      content: rendered.content,
      structured: rendered.structured,
      title,
      fallbackUsed: false,
      metadata: rendered.metadata,
    });
  } catch (error) {
    return buildFallbackResult(requestedFormat, sourceValue, title, error);
  }
}
