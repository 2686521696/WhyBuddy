import { describe, expect, it } from "vitest";

import type { McpToolExecutionResult } from "../../../tool/api/mcp-tool-adapter.js";
import { createDefaultMcpGithubCapabilityPolicy } from "./policy.js";
import {
  deriveGithubOutputSummary,
  extractCommitShaFromEtag,
  extractGithubMetadataFromJson,
  extractGithubMetadataFromMcpResult,
  sha256Digest,
} from "./summary-derivation.js";

const SAMPLE_JSON = JSON.stringify({
  name: "dashboard",
  full_name: "example/dashboard",
  description: "Release dashboard",
  language: "TypeScript",
  default_branch: "main",
  stargazers_count: 42,
  pushed_at: "2026-04-01T00:00:00Z",
  html_url: "https://github.com/example/dashboard",
  visibility: "public",
  // fields that must be IGNORED (not mapped / not leaked):
  owner: { email: "owner@example.com", url: "https://internal.example/owner" },
});

describe("extractGithubMetadataFromJson", () => {
  it("maps every whitelisted field from a GitHub REST response shape", () => {
    const metadata = extractGithubMetadataFromJson(SAMPLE_JSON);
    expect(metadata).toEqual({
      name: "dashboard",
      fullName: "example/dashboard",
      description: "Release dashboard",
      language: "TypeScript",
      defaultBranch: "main",
      stargazersCount: 42,
      pushedAt: "2026-04-01T00:00:00Z",
      htmlUrl: "https://github.com/example/dashboard",
      visibility: "public",
    });
  });

  it("does not leak nested owner fields (email / url)", () => {
    const metadata = extractGithubMetadataFromJson(SAMPLE_JSON);
    expect(JSON.stringify(metadata)).not.toContain("owner@example.com");
    expect(JSON.stringify(metadata)).not.toContain("internal.example");
  });

  it("returns null for invalid JSON or non-objects", () => {
    expect(extractGithubMetadataFromJson("not-json")).toBeNull();
    expect(extractGithubMetadataFromJson("[1, 2, 3]")).toBeNull();
    expect(extractGithubMetadataFromJson("")).toBeNull();
  });
});

describe("extractGithubMetadataFromMcpResult", () => {
  function buildResult(
    override: Partial<McpToolExecutionResult>,
  ): McpToolExecutionResult {
    return {
      ok: true,
      status: "completed",
      targetLabel: "github/get_repository",
      operation: "mcp_tool",
      resource: "mcp:github/get_repository",
      output: "",
      response: undefined,
      governance: {
        approval: { required: false, status: "not_required", source: "none" },
      },
      metadata: {
        serverId: "github",
        toolName: "github.get_repository",
        timeoutMs: 30_000,
        fallbackUsed: false,
      },
      ...override,
    };
  }

  it("maps GitHub REST shape when result.response is an object", () => {
    const result = buildResult({
      response: {
        name: "dashboard",
        full_name: "example/dashboard",
        default_branch: "main",
      },
    });
    expect(extractGithubMetadataFromMcpResult(result)).toEqual({
      name: "dashboard",
      fullName: "example/dashboard",
      description: undefined,
      language: undefined,
      defaultBranch: "main",
      stargazersCount: undefined,
      pushedAt: undefined,
      htmlUrl: undefined,
      visibility: undefined,
    });
  });

  it("falls back to JSON-parsing result.response when it's a string", () => {
    const result = buildResult({
      response: JSON.stringify({
        full_name: "example/dashboard",
        language: "TypeScript",
      }),
    });
    expect(extractGithubMetadataFromMcpResult(result)?.fullName).toBe(
      "example/dashboard",
    );
    expect(extractGithubMetadataFromMcpResult(result)?.language).toBe(
      "TypeScript",
    );
  });

  it("falls back to JSON-parsing result.output when response is absent", () => {
    const result = buildResult({
      response: undefined,
      output: JSON.stringify({ full_name: "example/dashboard" }),
    });
    expect(extractGithubMetadataFromMcpResult(result)?.fullName).toBe(
      "example/dashboard",
    );
  });

  it("returns null when neither response nor output can be mapped", () => {
    const result = buildResult({ response: undefined, output: "plain text" });
    expect(extractGithubMetadataFromMcpResult(result)).toBeNull();
  });
});

describe("deriveGithubOutputSummary", () => {
  const policy = createDefaultMcpGithubCapabilityPolicy();

  it("renders the canonical template with all fields populated", () => {
    const summary = deriveGithubOutputSummary(
      {
        fullName: "example/dashboard",
        language: "TypeScript",
        stargazersCount: 42,
        defaultBranch: "main",
        pushedAt: "2026-04-01T00:00:00Z",
      },
      policy,
    );
    expect(summary).toContain("example/dashboard");
    expect(summary).toContain("TypeScript");
    expect(summary).toContain("42★");
    expect(summary).toContain("default branch main");
    expect(summary).toContain("last pushed 2026-04-01T00:00:00Z");
  });

  it("uses sensible defaults for missing fields", () => {
    const summary = deriveGithubOutputSummary({}, policy);
    expect(summary).toContain("unknown/unknown");
    expect(summary).toContain("unknown");
    expect(summary).toContain("0★");
    expect(summary).toContain("default branch main");
    expect(summary).toContain("last pushed unknown");
  });
});

describe("sha256Digest", () => {
  it("returns a stable lowercase hex digest for a given input", () => {
    const digest = sha256Digest("hello");
    expect(digest).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("extractCommitShaFromEtag", () => {
  it("extracts the sha1 inside a weak etag", () => {
    expect(
      extractCommitShaFromEtag('W/"abc123def4567890abc123def456789012345678"'),
    ).toBe("abc123def4567890abc123def456789012345678");
  });

  it("extracts the sha1 inside a strong etag", () => {
    expect(extractCommitShaFromEtag('"abc123"')).toBe("abc123");
  });

  it("returns undefined for non-hex content or missing input", () => {
    expect(extractCommitShaFromEtag(undefined)).toBeUndefined();
    expect(extractCommitShaFromEtag("")).toBeUndefined();
    expect(extractCommitShaFromEtag('W/"not-hex-!"')).toBeUndefined();
  });
});
