/**
 * MCP GitHub capability bridge — metadata extraction and summary derivation.
 *
 * Pure module. No HTTP client imports, no `undici`, no module-level `fetch()`.
 * Owns the data-shape translation between raw GitHub REST / MCP tool output
 * and the bridge's internal {@link GithubRepoMetadata}, plus user-visible
 * output-summary rendering.
 */

import { createHash } from "node:crypto";

import type { McpToolExecutionResult } from "../../../tool/api/mcp-tool-adapter.js";
import {
  applyMcpGithubCapabilityRedaction,
  type McpGithubCapabilityPolicy,
} from "./policy.js";

/**
 * Normalised repository metadata the bridge cares about. All fields are
 * optional because upstream shape may drift (MCP tool result) or be absent
 * on private repos / enterprise endpoints.
 *
 * **Only whitelisted fields are included**. `owner.email`, `owner.url`,
 * etc. are never mapped into this envelope.
 */
export interface GithubRepoMetadata {
  readonly name?: string;
  readonly fullName?: string;
  readonly description?: string;
  readonly language?: string;
  readonly defaultBranch?: string;
  readonly stargazersCount?: number;
  readonly pushedAt?: string;
  readonly htmlUrl?: string;
  readonly visibility?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mapGithubRestShape(source: Record<string, unknown>): GithubRepoMetadata {
  return {
    name: asOptionalString(source.name),
    fullName: asOptionalString(source.full_name ?? source.fullName),
    description: asOptionalString(source.description),
    language: asOptionalString(source.language),
    defaultBranch: asOptionalString(
      source.default_branch ?? source.defaultBranch,
    ),
    stargazersCount: asOptionalNumber(
      source.stargazers_count ?? source.stargazersCount,
    ),
    pushedAt: asOptionalString(source.pushed_at ?? source.pushedAt),
    htmlUrl: asOptionalString(source.html_url ?? source.htmlUrl),
    visibility: asOptionalString(source.visibility),
  };
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Extract repo metadata from the raw HTTP response body string (HTTP real path).
 *
 * Only takes whitelisted top-level fields. Nested `owner` is ignored so emails
 * and private URLs never leak into `outputSummary` even if the API exposes them.
 */
export function extractGithubMetadataFromJson(
  body: string,
): GithubRepoMetadata | null {
  if (typeof body !== "string" || body.length === 0) {
    return null;
  }
  const parsed = parseJsonSafely(body);
  if (!isRecord(parsed)) {
    return null;
  }
  return mapGithubRestShape(parsed);
}

/**
 * Extract repo metadata from an MCP tool result (MCP real path).
 *
 * Strategy (design §4.7):
 * 1. `result.response` is an object matching GitHub REST shape → map.
 * 2. `result.response` is a string → try `JSON.parse`, then map.
 * 3. `result.output` is a string → try `JSON.parse`, then map.
 * 4. Otherwise → return `null`. The bridge will still return a real-MCP
 *    invocation but with a neutral summary (no `repoUrl` / `commitSha`).
 */
export function extractGithubMetadataFromMcpResult(
  result: McpToolExecutionResult,
): GithubRepoMetadata | null {
  if (isRecord(result.response)) {
    return mapGithubRestShape(result.response);
  }
  if (typeof result.response === "string") {
    const parsed = parseJsonSafely(result.response);
    if (isRecord(parsed)) {
      return mapGithubRestShape(parsed);
    }
  }
  if (typeof result.output === "string") {
    const parsed = parseJsonSafely(result.output);
    if (isRecord(parsed)) {
      return mapGithubRestShape(parsed);
    }
  }
  return null;
}

/**
 * Render a user-visible one-liner from {@link GithubRepoMetadata}.
 *
 * Template (design §4.7 / requirement 3.3):
 *   `repo {fullName} · {language ?? "unknown"} · {stargazersCount ?? 0}★ ·
 *    default branch {defaultBranch ?? "main"} · last pushed {pushedAt ?? "unknown"}`
 *
 * The rendered string is re-scrubbed through
 * {@link applyMcpGithubCapabilityRedaction} defensively — since
 * {@link extractGithubMetadataFromJson} only exposes whitelisted fields this
 * is usually a no-op, but it's a cheap safety net if upstream shape changes.
 */
export function deriveGithubOutputSummary(
  metadata: GithubRepoMetadata,
  policy: McpGithubCapabilityPolicy,
): string {
  const fullName = metadata.fullName ?? metadata.name ?? "unknown/unknown";
  const language = metadata.language ?? "unknown";
  const stars =
    metadata.stargazersCount !== undefined ? metadata.stargazersCount : 0;
  const defaultBranch = metadata.defaultBranch ?? "main";
  const pushedAt = metadata.pushedAt ?? "unknown";
  const rendered = `repo ${fullName} · ${language} · ${stars}★ · default branch ${defaultBranch} · last pushed ${pushedAt}`;
  return applyMcpGithubCapabilityRedaction(rendered, policy);
}

/**
 * SHA-256 digest helper (hex, lowercase). Used to populate
 * `provenance.apiResponseDigest` on the HTTP real path.
 */
export function sha256Digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Extract the commit SHA embedded in a GitHub REST `etag` header.
 *
 * GitHub returns ETags shaped like `W/"<sha1>"` or `"<sha1>"`. Returns the
 * inner sha1 when it looks hex-like, otherwise `undefined`.
 */
export function extractCommitShaFromEtag(
  etag: string | undefined,
): string | undefined {
  if (typeof etag !== "string" || etag.length === 0) {
    return undefined;
  }
  const match = etag.match(/"([^"]+)"/);
  if (!match) {
    return undefined;
  }
  const candidate = match[1];
  if (!/^[a-f0-9]{4,64}$/i.test(candidate)) {
    return undefined;
  }
  return candidate.toLowerCase();
}
