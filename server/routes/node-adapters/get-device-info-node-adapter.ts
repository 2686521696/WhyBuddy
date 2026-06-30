import type {
  GetDeviceInfoNodeExecutionRequest,
  GetDeviceInfoNodeExecutionResult,
  GetDeviceInfoNodeInput,
  GetDeviceInfoNodeType,
  WebAigcDeviceClientHints,
} from "../../../shared/web-aigc-device-info.js";

export interface GetDeviceInfoNodeAdapterDeps {
  processPlatform?: string;
  processArch?: string;
  processVersion?: string;
  // Python thin proxy wiring (web-aigc longtail cutover 105): when provided, Node is thin proxy and does not own semantics
  executePythonRuntime?: (input: GetDeviceInfoNodeInput) => Promise<any>;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function normalizeLocale(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  try {
    return Intl.getCanonicalLocales(normalized)[0];
  } catch {
    return normalized;
  }
}

function normalizeTimezone(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: normalized });
    return normalized;
  } catch {
    return undefined;
  }
}

function normalizeScreenCategory(
  value: unknown,
): "desktop" | "tablet" | "mobile" | "unknown" | undefined {
  return value === "desktop" ||
    value === "tablet" ||
    value === "mobile" ||
    value === "unknown"
    ? value
    : undefined;
}

function parseBrowserFamily(userAgent: string | undefined): string | undefined {
  const ua = userAgent?.toLowerCase() ?? "";
  if (!ua) return undefined;
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("chrome/")) return "Chrome";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
  if (ua.includes("firefox/")) return "Firefox";
  if (ua.includes("electron/")) return "Electron";
  return "Unknown";
}

function parseOsFamily(userAgent: string | undefined): string | undefined {
  const ua = userAgent?.toLowerCase() ?? "";
  if (!ua) return undefined;
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "iOS";
  if (ua.includes("linux")) return "Linux";
  return "Unknown";
}

function normalizeClientHints(value: unknown): WebAigcDeviceClientHints | undefined {
  const record = normalizeObject(value);
  const userAgent = normalizeString(record.userAgent);
  const platform = normalizeString(record.platform);
  const locale = normalizeLocale(record.locale);
  const timezone = normalizeTimezone(record.timezone);
  const appVersion = normalizeString(record.appVersion);
  const screenCategory = normalizeScreenCategory(record.screenCategory);

  if (
    !userAgent &&
    !platform &&
    !locale &&
    !timezone &&
    !appVersion &&
    !screenCategory
  ) {
    return undefined;
  }

  return {
    ...(userAgent ? { userAgent } : {}),
    ...(platform ? { platform } : {}),
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
    ...(appVersion ? { appVersion } : {}),
    ...(screenCategory ? { screenCategory } : {}),
  };
}

function normalizeRetention(
  value: unknown,
): "ephemeral" | "session" | "workflow" {
  return value === "session" || value === "workflow" ? value : "ephemeral";
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function buildPythonDevicePrivacySummary(
  value: unknown,
): GetDeviceInfoNodeExecutionResult["output"]["privacy"] {
  const record = normalizeObject(value);
  const redactedFields = Array.isArray(record.redactedFields)
    ? record.redactedFields.filter((field): field is string => typeof field === "string")
    : [];
  const notes = Array.isArray(record.notes)
    ? record.notes.filter((note): note is string => typeof note === "string")
    : ["Device info was returned by the Python facade."];

  return {
    collectionMode: "summary_only",
    rawUserAgentStored: normalizeBoolean(record.rawUserAgentStored, false),
    redactedFields,
    retention: normalizeRetention(record.retention),
    notes,
  };
}

function buildRuntimeSummary(
  deps: GetDeviceInfoNodeAdapterDeps,
  privacy: Record<string, unknown>,
): GetDeviceInfoNodeExecutionResult["output"]["runtime"] {
  if (!normalizeBoolean(privacy.allowRuntimeDetails, true)) {
    return {
      runtime: "node",
    };
  }

  return {
    runtime: "node",
    platform: deps.processPlatform ?? process.platform,
    arch: deps.processArch ?? process.arch,
    nodeVersion: deps.processVersion ?? process.version,
  };
}

function buildClientSummary(
  input: GetDeviceInfoNodeInput,
  warnings: string[],
): GetDeviceInfoNodeExecutionResult["output"]["client"] | undefined {
  const privacy = normalizeObject(input.privacy);
  if (!normalizeBoolean(privacy.allowClientHints, true)) {
    return undefined;
  }

  const clientHints = normalizeClientHints(input.clientHints);
  if (!clientHints) {
    return undefined;
  }

  if (!normalizeTimezone(clientHints.timezone) && normalizeString(clientHints.timezone)) {
    warnings.push("timezone was ignored because it was not a valid IANA timezone.");
  }

  return {
    ...(clientHints.platform ? { platform: clientHints.platform } : {}),
    ...(parseBrowserFamily(clientHints.userAgent)
      ? { browserFamily: parseBrowserFamily(clientHints.userAgent) }
      : {}),
    ...(parseOsFamily(clientHints.userAgent)
      ? { osFamily: parseOsFamily(clientHints.userAgent) }
      : {}),
    ...(clientHints.locale ? { locale: clientHints.locale } : {}),
    ...(clientHints.timezone ? { timezone: clientHints.timezone } : {}),
    ...(clientHints.appVersion ? { appVersion: clientHints.appVersion } : {}),
    ...(clientHints.screenCategory
      ? { screenCategory: clientHints.screenCategory }
      : {}),
  };
}

export function isGetDeviceInfoNodeType(
  value: unknown,
): value is GetDeviceInfoNodeType {
  return value === "get_device_info";
}

// Thin proxy map for python-owned device info facade (cutover 105).
// When py reports failure (ok:false), surface as ok:false so callers can distinguish python path failure (per review: no hiding py failure as ok:true degraded).
export function mapPythonDeviceInfoRuntimeResponse(py: any, input: GetDeviceInfoNodeInput = {}): GetDeviceInfoNodeExecutionResult {
  if (py && py.ok === false) {
    return {
      ok: false,
      nodeType: "get_device_info",
      output: {
        status: "error",
        runtime: py?.runtime ?? { runtime: "python" },
        error: py?.error || { code: "py_bridge", message: "python device facade failed" },
        privacy: buildPythonDevicePrivacySummary(py?.privacy),
        context: normalizeObject(input.context),
        warnings: Array.isArray(py?.warnings) ? py.warnings : ["python path failed"],
        ...(py?.metadata ? { metadata: py.metadata } : {}),
      },
    };
  }
  const status = py?.status === "completed" ? "completed" : "degraded";
  return {
    ok: true,
    nodeType: "get_device_info",
    output: {
      status,
      runtime: py?.runtime ?? { runtime: "python" },
      ...(py?.client ? { client: py.client } : {}),
      privacy: buildPythonDevicePrivacySummary(py?.privacy),
      context: normalizeObject(input.context),
      warnings: Array.isArray(py?.warnings) ? py.warnings : ["proxied via python facade"],
      ...(py?.metadata ? { metadata: py.metadata } : {}),
    },
  };
}

export async function executeGetDeviceInfoNode(
  request: GetDeviceInfoNodeExecutionRequest,
  deps: GetDeviceInfoNodeAdapterDeps = {},
): Promise<GetDeviceInfoNodeExecutionResult> {
  if (!isGetDeviceInfoNodeType(request.nodeType)) {
    throw new Error("Unsupported get_device_info node type.");
  }

  const input = request.input ?? {};
  // Python-first: Node is thin proxy when executePythonRuntime provided (long-tail cutover 105)
  if (deps.executePythonRuntime) {
    try {
      const pyResponse = await deps.executePythonRuntime(input);
      return mapPythonDeviceInfoRuntimeResponse(pyResponse, input);
    } catch (error: any) {
      // explicit failure (ok:false) so python bridge error is not hidden behind Node ok:true degraded (review finding 2)
      return {
        ok: false,
        nodeType: "get_device_info",
        output: {
          status: "error",
          runtime: { runtime: "python-failed" },
          error: { code: "py_bridge", message: String(error?.message || error) },
          privacy: buildPythonDevicePrivacySummary(undefined),
          warnings: ["python device facade failed"],
          context: normalizeObject(input.context),
        },
      };
    }
  }

  // Retained Node compatibility shell (explicit boundary; python not wired by caller)
  const privacy = normalizeObject(input.privacy);
  const warnings: string[] = [];
  const client = buildClientSummary(input, warnings);
  const redactUserAgent = normalizeBoolean(privacy.redactUserAgent, true);
  const redactedFields = redactUserAgent ? ["clientHints.userAgent"] : [];

  if (!client) {
    warnings.push("Client hints were unavailable; only runtime summary was returned.");
  }

  return {
    ok: true,
    nodeType: "get_device_info",
    output: {
      status: "completed",
      runtime: buildRuntimeSummary(deps, privacy),
      ...(client ? { client } : {}),
      privacy: {
        collectionMode: "summary_only",
        rawUserAgentStored: false,
        redactedFields,
        retention: normalizeRetention(privacy.retention),
        notes: [
          "Only summary-level runtime and client hints are returned.",
          "Raw user-agent, IP, hostname, and hardware identifiers are not persisted.",
        ],
      },
      compatibility: {
        hostRuntime: "server",
        hasClientHints: Boolean(client),
        fallbackMode: !client,
      },
      context: normalizeObject(input.context),
      warnings,
    },
  };
}
