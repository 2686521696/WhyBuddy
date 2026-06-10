/**
 * Thin WhyBuddy-specific adapter for MCP GitHub source/evidence capabilities.
 *
 * Reuses the pure, policy-aware helpers from the existing mcp-github-source
 * modules (url parsing, API URL building, metadata extraction, summary
 * derivation, and default policy) without pulling in the full Blueprint
 * bridge (routes, jobs, heavy ctx, MCP tool adapter).
 *
 * For P0 we use a controlled direct HTTP path (https, timeout, body size
 * ceiling, credential header scrub) + the derivation logic.
 *
 * The adapter returns the exact raw executor shape expected by the
 * WhyBuddy CapabilityExecutor seam so that commitArtifact / Trust Gate /
 * producedBy / evidenceRefs / stale cascade / report 9-section continue to
 * be owned exclusively by the runtime.
 */

import { fetch } from "undici";

import {
  parseGithubUrl,
  buildGithubRepoApiUrl,
} from "../routes/blueprint/mcp-github-source/url-parser.js";
import {
  extractGithubMetadataFromJson,
  deriveGithubOutputSummary,
  type GithubRepoMetadata,
} from "../routes/blueprint/mcp-github-source/summary-derivation.js";
import {
  createDefaultMcpGithubCapabilityPolicy,
  type McpGithubCapabilityPolicy,
} from "../routes/blueprint/mcp-github-source/policy.js";

export interface GithubMcpResult {
  title: string;
  summary: string;
  content: string;
  provenance: "mcp:github";
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 256 * 1024; // conservative for WhyBuddy P0 (full policy default is 1MiB)

function truncateForSafety(text: string, max = 2000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

async function safeGithubFetchJson(url: string, policy: McpGithubCapabilityPolicy): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.maxInvocationTimeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "whybuddy-mcp-github-adapter",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // No Authorization / Cookie / token headers ever — policy spirit
    });

    if (!res.ok) {
      const err = new Error(`GitHub HTTP ${res.status}`);
      (err as any).status = res.status >= 400 && res.status < 500 ? 400 : 502;
      throw err;
    }

    // streamed size guard (simple for P0)
    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let received = 0;
    const limit = policy.maxResponseBodyBytes ?? MAX_BODY_BYTES;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > limit) {
          const e = new Error("response too large");
          (e as any).kind = "body_too_large";
          throw e;
        }
        chunks.push(value);
      }
    }

    const text = new TextDecoder().decode(Buffer.concat(chunks as any));
    return JSON.parse(text);
  } catch (e: any) {
    if (e?.name === "AbortError") {
      const err = new Error("timeout");
      (err as any).status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function executeGithubMcpCapability(
  capabilityId: string,
  state: any,
  inputArtifactIds: string[] = [],
): Promise<GithubMcpResult> {
  const policy = createDefaultMcpGithubCapabilityPolicy();

  const githubUrl = extractFirstGithubUrl(state, inputArtifactIds);
  if (!githubUrl) {
    const err: any = new Error("no github url found in goal or input artifacts for github mcp capability");
    err.status = 400;
    throw err;
  }

  const parsed = parseGithubUrl(githubUrl);
  if (!parsed) {
    const err: any = new Error(`invalid github url: ${githubUrl}`);
    err.status = 400;
    throw err;
  }

  const apiUrl = buildGithubRepoApiUrl(parsed, {
    apiBase: policy.allowedHttpOrigins?.[0] ?? "https://api.github.com",
  });

  let json: unknown;
  try {
    json = await safeGithubFetchJson(apiUrl, policy);
  } catch (e: any) {
    // surface a status the route can turn into 4xx/5xx for client fallback
    const status = e?.status || 502;
    const err: any = new Error(`github mcp fetch failed: ${e?.message || e}`);
    err.status = status;
    throw err;
  }

  if (!json || typeof json !== "object") {
    const err: any = new Error("github mcp returned no usable data");
    err.status = 502;
    throw err;
  }

  const meta: GithubRepoMetadata = extractGithubMetadataFromJson(json as any) || {};

  // title / summary / content tuned for WhyBuddy raw executor contract
  const fullName = meta.fullName || `${parsed.owner}/${parsed.repo}`;
  const title = capabilityId.includes("evidence")
    ? `GitHub Evidence: ${fullName}`
    : `GitHub Source: ${fullName}`;

  const oneLiner = deriveGithubOutputSummary(meta, policy);

  const content = JSON.stringify(
    {
      repository: fullName,
      description: meta.description || null,
      language: meta.language || null,
      stars: meta.stargazersCount ?? null,
      defaultBranch: meta.defaultBranch || null,
      lastPushed: meta.pushedAt || null,
      url: meta.htmlUrl || `https://github.com/${parsed.owner}/${parsed.repo}`,
      source: "mcp-github",
    },
    null,
    2,
  );

  // provenance signals real external source (distinct from "llm")
  return {
    title,
    summary: oneLiner,
    content,
    provenance: "mcp:github",
  };
}

function scanForGithubUrl(text: string): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const m = text.match(/https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (m) {
    return m[0].replace(/\.git$/, "");
  }
  return null;
}

function extractFirstGithubUrl(state: any, inputArtifactIds: string[] = []): string | null {
  const artifacts: any[] = (state as any)?.artifacts || [];

  // Priority 1: explicitly requested artifacts via inputArtifactIds (precise evidence binding)
  for (const aid of inputArtifactIds) {
    const art = artifacts.find((a: any) => a?.id === aid || a?.artifactId === aid);
    if (art) {
      const s = `${art.title || ""} ${art.summary || ""} ${art.content || ""} ${JSON.stringify(art.metadata || {})}`;
      const url = scanForGithubUrl(s);
      if (url) return url;
    }
  }

  // Priority 2: goal text
  const goalText = (state as any)?.goal?.text || (state as any)?.goal || "";
  let url = scanForGithubUrl(goalText);
  if (url) return url;

  // Priority 3: recent artifacts (last 8) as fallback
  for (const a of artifacts.slice(-8)) {
    const s = `${a?.title || ""} ${a?.summary || ""} ${a?.content || ""} ${JSON.stringify(a?.metadata || {})}`;
    url = scanForGithubUrl(s);
    if (url) return url;
  }

  return null;
}
