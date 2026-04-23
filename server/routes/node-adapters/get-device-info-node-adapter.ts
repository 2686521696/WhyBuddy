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

export async function executeGetDeviceInfoNode(
  request: GetDeviceInfoNodeExecutionRequest,
  deps: GetDeviceInfoNodeAdapterDeps = {},
): Promise<GetDeviceInfoNodeExecutionResult> {
  if (!isGetDeviceInfoNodeType(request.nodeType)) {
    throw new Error("Unsupported get_device_info node type.");
  }

  const input = request.input ?? {};
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
