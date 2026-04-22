import type { Action, PermissionConstraints } from "../../../shared/permission/contracts.js";
import type { ResourceChecker } from "./filesystem-checker.js";

type McpResourceParameter = string | number | boolean | null | undefined;

export interface McpResourceBuildInput {
  serverId: string;
  toolName: string;
  parameters?: Record<string, McpResourceParameter>;
}

export interface ParsedMcpResource {
  format: "canonical" | "legacy_colon" | "bare_tool";
  serverId: string | null;
  toolName: string;
  operation: string | null;
  parameters: Record<string, string>;
  endpointCandidates: string[];
  rawResource: string;
}

/**
 * Supported resource formats:
 * - canonical: mcp://server/tool?key=value
 * - legacy:    server:tool
 * - legacy:    tool
 */
export class McpChecker implements ResourceChecker {
  checkConstraints(action: Action, resource: string, constraints: PermissionConstraints): boolean {
    void action;

    let parsed: ParsedMcpResource;
    try {
      parsed = parseMcpResource(resource);
    } catch {
      return false;
    }

    if (constraints.endpoints && constraints.endpoints.length > 0) {
      const toolAllowed = constraints.endpoints.some(
        (allowed) => allowed === "*" || parsed.endpointCandidates.includes(allowed),
      );
      if (!toolAllowed) return false;
    }

    if (constraints.methods && constraints.methods.length > 0) {
      const operationCandidates = new Set<string>([parsed.toolName]);
      if (parsed.operation) {
        operationCandidates.add(parsed.operation);
      }
      const opAllowed = constraints.methods.some(
        (allowed) => allowed === "*" || operationCandidates.has(allowed),
      );
      if (!opAllowed) return false;
    }

    if (constraints.parameterConstraints) {
      for (const [key, regexStr] of Object.entries(constraints.parameterConstraints)) {
        let regex: RegExp;
        try {
          regex = new RegExp(regexStr);
        } catch {
          return false;
        }

        const value = parsed.parameters[key];
        if (value !== undefined && !regex.test(value)) {
          return false;
        }
      }
    }

    return true;
  }
}

export function buildMcpResource(input: McpResourceBuildInput): string {
  const serverId = normalizeRequiredSegment(input.serverId, "serverId");
  const toolName = normalizeRequiredSegment(input.toolName, "toolName");
  const params = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(input.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (rawValue === undefined || rawValue === null) continue;
    params.set(key, String(rawValue));
  }

  const query = params.toString();
  const base = `mcp://${encodeURIComponent(serverId)}/${encodeURIComponent(toolName)}`;
  return query ? `${base}?${query}` : base;
}

export function parseMcpResource(resource: string): ParsedMcpResource {
  const normalized = resource.trim();
  if (!normalized) {
    throw new Error("MCP resource cannot be empty");
  }

  if (normalized.startsWith("mcp://")) {
    return parseCanonicalMcpResource(normalized);
  }

  const colonIdx = normalized.indexOf(":");
  if (colonIdx === -1) {
    const toolName = normalizeRequiredSegment(normalized, "toolName");
    return {
      format: "bare_tool",
      serverId: null,
      toolName,
      operation: null,
      parameters: {},
      endpointCandidates: buildEndpointCandidates(null, toolName, null),
      rawResource: normalized,
    };
  }

  const serverId = normalizeRequiredSegment(normalized.slice(0, colonIdx), "serverId");
  const toolName = normalizeRequiredSegment(normalized.slice(colonIdx + 1), "toolName");
  return {
    format: "legacy_colon",
    serverId,
    toolName,
    operation: toolName,
    parameters: {},
    endpointCandidates: buildEndpointCandidates(serverId, toolName, toolName),
    rawResource: normalized,
  };
}

function parseCanonicalMcpResource(resource: string): ParsedMcpResource {
  const match = resource.match(/^mcp:\/\/([^/?#]+)\/([^?#]+)(?:\?(.*))?$/);
  if (!match) {
    throw new Error(`Invalid MCP resource: ${resource}`);
  }

  const serverId = normalizeRequiredSegment(decodeURIComponent(match[1]), "serverId");
  const toolName = normalizeRequiredSegment(decodeURIComponent(match[2]), "toolName");
  const parameters = parseParameterMap(match[3]);

  return {
    format: "canonical",
    serverId,
    toolName,
    operation: toolName,
    parameters,
    endpointCandidates: buildEndpointCandidates(serverId, toolName, toolName),
    rawResource: resource,
  };
}

function parseParameterMap(query: string | undefined): Record<string, string> {
  if (!query) return {};

  const params: Record<string, string> = {};
  const searchParams = new URLSearchParams(query);
  for (const [key, value] of searchParams.entries()) {
    params[key] = value;
  }
  return params;
}

function buildEndpointCandidates(
  serverId: string | null,
  toolName: string,
  operation: string | null,
): string[] {
  const candidates = new Set<string>([toolName]);

  if (operation) {
    candidates.add(operation);
  }

  if (serverId) {
    candidates.add(serverId);
    candidates.add(`${serverId}/${toolName}`);
    candidates.add(`mcp://${serverId}/${toolName}`);
    if (operation) {
      candidates.add(`${serverId}:${operation}`);
    }
  }

  return [...candidates];
}

function normalizeRequiredSegment(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Missing MCP ${field}`);
  }
  return normalized;
}
