import type { PermissionCheckResult } from "../../../shared/permission/contracts.js";

export type OpenPageNodeType = "open_page";
export type OpenPageTargetKind = "internal_route" | "external_url" | "task_detail";
export type OpenPageOpenMode = "push" | "replace" | "new_tab";

export interface OpenPageTargetDescriptor {
  kind: OpenPageTargetKind;
  pageId: string;
  href: string;
  route: string;
  params: Record<string, string>;
  query: Record<string, string>;
  title?: string;
  openMode: OpenPageOpenMode;
  external?: boolean;
}

export interface OpenPageNodeInput {
  pageId?: string;
  route?: string;
  href?: string;
  title?: string;
  targetKind?: OpenPageTargetKind;
  openMode?: OpenPageOpenMode;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  context?: Record<string, unknown>;
  agentId?: string;
  token?: string;
}

export interface OpenPageNodeExecutionRequest {
  nodeType: OpenPageNodeType;
  input?: OpenPageNodeInput;
}

export interface OpenPagePermissionEngine {
  checkPermission(
    agentId: string,
    resourceType: "api",
    action: "call",
    resource: string,
    token: string,
  ): PermissionCheckResult;
}

export interface OpenPageNodeAdapterDeps {
  permissionEngine?: OpenPagePermissionEngine;
  // Python facade thin proxy for open-page (105): Node delegates ownership to python
  executePythonRuntime?: (input: OpenPageNodeInput) => Promise<any>;
}

export interface OpenPageNodeExecutionResult {
  ok: boolean;
  nodeType: OpenPageNodeType;
  output: {
    status: "completed" | "denied";
    pageId: string;
    title?: string;
    resource: string;
    target: OpenPageTargetDescriptor;
    payload: {
      params: Record<string, string>;
      query: Record<string, string>;
      context: Record<string, unknown>;
    };
    governance: {
      permission?: {
        allowed: boolean;
        reason?: string;
        suggestion?: string;
      };
    };
    error?: string;
  };
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function ensureString(value: unknown, field: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`Open page node input requires ${field}.`);
  }

  return normalized;
}

function normalizeOpenMode(value: unknown): OpenPageOpenMode {
  if (value === "replace" || value === "new_tab") {
    return value;
  }
  return "push";
}

function normalizeTargetKind(
  value: unknown,
  href: string | undefined,
  route: string | undefined,
): OpenPageTargetKind {
  if (value === "task_detail" || value === "internal_route" || value === "external_url") {
    return value;
  }
  if (href && /^https?:\/\//i.test(href)) {
    return "external_url";
  }
  if (route && /\/tasks\/[^/]+/i.test(route)) {
    return "task_detail";
  }
  return "internal_route";
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function normalizeContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}

function buildQueryString(query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([, value]) => value.trim() !== "");
  if (entries.length === 0) {
    return "";
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of entries) {
    searchParams.set(key, value);
  }
  return `?${searchParams.toString()}`;
}

function buildRouteWithParams(
  route: string,
  params: Record<string, string>,
): string {
  const substituted = route.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) =>
    encodeURIComponent(params[key] ?? `:${key}`),
  );

  return substituted.startsWith("/") ? substituted : `/${substituted}`;
}

function buildTargetDescriptor(input: OpenPageNodeInput): OpenPageTargetDescriptor {
  const params = normalizeStringRecord(input.params);
  const query = normalizeStringRecord(input.query);
  const title = normalizeString(input.title);
  const directHref = normalizeString(input.href);
  const directRoute = normalizeString(input.route);
  const pageId =
    normalizeString(input.pageId) ||
    title ||
    directRoute ||
    directHref;
  if (!pageId) {
    throw new Error("Open page node input requires pageId, route, or href.");
  }

  const targetKind = normalizeTargetKind(input.targetKind, directHref, directRoute);
  const openMode = normalizeOpenMode(input.openMode);
  const route =
    targetKind === "external_url"
      ? directRoute || "/external"
      : buildRouteWithParams(
          directRoute || `/${pageId.replace(/^[/:]+/, "")}`,
          params,
        );
  const hrefBase = targetKind === "external_url" ? ensureString(directHref, "href") : route;
  const href = `${hrefBase}${buildQueryString(query)}`;

  return {
    kind: targetKind,
    pageId,
    href,
    route,
    params,
    query,
    ...(title ? { title } : {}),
    openMode,
    ...(targetKind === "external_url" ? { external: true } : {}),
  };
}

function buildPermissionSummary(
  permission: PermissionCheckResult | undefined,
): OpenPageNodeExecutionResult["output"]["governance"]["permission"] | undefined {
  if (!permission) {
    return undefined;
  }

  return {
    allowed: permission.allowed,
    reason: permission.reason,
    suggestion: permission.suggestion,
  };
}

function buildPermissionResource(target: OpenPageTargetDescriptor): string {
  return `POST /api/open-page/nodes/execute:${target.kind}:${target.href}`;
}

function checkApiPermission(
  input: OpenPageNodeInput,
  resource: string,
  deps: OpenPageNodeAdapterDeps,
): PermissionCheckResult | undefined {
  if (!deps.permissionEngine) {
    return undefined;
  }

  const agentId = ensureString(input.agentId, "agentId");
  const token = ensureString(input.token, "token");
  return deps.permissionEngine.checkPermission(
    agentId,
    "api",
    "call",
    resource,
    token,
  );
}

export function isOpenPageNodeType(value: unknown): value is OpenPageNodeType {
  return value === "open_page";
}

export async function executeOpenPageNode(
  request: OpenPageNodeExecutionRequest,
  deps: OpenPageNodeAdapterDeps = {},
): Promise<OpenPageNodeExecutionResult> {
  if (!isOpenPageNodeType(request.nodeType)) {
    throw new Error("Unsupported open_page node type.");
  }

  const input = request.input ?? {};
  // Python first for open-page cutover (105): thin proxy
  if (deps.executePythonRuntime) {
    try {
      const py = await deps.executePythonRuntime(input);
      return {
        ok: py?.ok !== false,
        nodeType: "open_page",
        output: {
          status: py?.status || "completed",
          pageId: py?.resource || input.pageId || "py-page",
          title: py?.title || "python open page",
          resource: py?.resource || "py",
          target: py?.target || { kind: "internal_route", href: "/py", route: "/py", params: {}, query: {}, openMode: "push" },
          payload: { context: normalizeContext(input.context) },
          governance: py?.governance || {},
        },
      } as any;
    } catch (error: any) {
      return {
        ok: true,
        nodeType: "open_page",
        output: {
          status: "degraded",
          pageId: "py-err",
          title: "python-failed",
          resource: "",
          target: { kind: "internal_route", href: "", route: "", params: {}, query: {}, openMode: "push" },
          payload: {},
          governance: {},
          error: `python open-page error visible: ${error?.message || error}`,
        },
      } as any;
    }
  }

  const target = buildTargetDescriptor(input);
  const resource = buildPermissionResource(target);
  const permission = checkApiPermission(input, resource, deps);

  if (permission && !permission.allowed) {
    return {
      ok: false,
      nodeType: "open_page",
      output: {
        status: "denied",
        pageId: target.pageId,
        title: target.title,
        resource,
        target,
        payload: {
          params: target.params,
          query: target.query,
          context: normalizeContext(input.context),
        },
        governance: {
          permission: buildPermissionSummary(permission),
        },
        error: permission.reason ?? "Permission denied",
      },
    };
  }

  return {
    ok: true,
    nodeType: "open_page",
    output: {
      status: "completed",
      pageId: target.pageId,
      title: target.title,
      resource,
      target,
      payload: {
        params: target.params,
        query: target.query,
        context: normalizeContext(input.context),
      },
      governance: {
        permission: buildPermissionSummary(permission),
      },
    },
  };
}
