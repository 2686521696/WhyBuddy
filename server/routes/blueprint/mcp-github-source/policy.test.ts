import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  applyMcpGithubCapabilityRedaction,
  checkMcpGithubHttpPolicy,
  createDefaultMcpGithubCapabilityPolicy,
  redactMcpArguments,
  type McpGithubCapabilityPolicy,
} from "./policy.js";

describe("checkMcpGithubHttpPolicy", () => {
  const policy = createDefaultMcpGithubCapabilityPolicy();

  it("accepts https://api.github.com repos URLs", () => {
    const result = checkMcpGithubHttpPolicy(
      policy,
      "https://api.github.com/repos/example/dashboard",
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects http scheme with reason 'https required'", () => {
    const result = checkMcpGithubHttpPolicy(
      policy,
      "http://api.github.com/repos/example/dashboard",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("https required");
  });

  it("rejects hosts outside the allow-list", () => {
    const result = checkMcpGithubHttpPolicy(
      policy,
      "https://evil.example/repos/example/dashboard",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("allow-list rejected");
  });

  it("rejects substring prefix attacks (exact-origin match)", () => {
    const result = checkMcpGithubHttpPolicy(
      policy,
      "https://api.github.com.evil.example/repos/a/b",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("allow-list rejected");
  });

  it("rejects malformed URLs with reason 'invalid url'", () => {
    const result = checkMcpGithubHttpPolicy(policy, "not a url");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("invalid url");
  });
});

describe("applyMcpGithubCapabilityRedaction", () => {
  const policy = createDefaultMcpGithubCapabilityPolicy();

  it("redacts GitHub PAT prefixes to [redacted-github-token]", () => {
    const token = "ghp_" + "a".repeat(36);
    const redacted = applyMcpGithubCapabilityRedaction(
      `leak=${token} trailing`,
      policy,
    );
    expect(redacted).not.toContain(token);
    expect(redacted).toContain("[redacted-github-token]");
  });

  it("redacts emails to [redacted-email]", () => {
    const redacted = applyMcpGithubCapabilityRedaction(
      "contact owner user@example.com today",
      policy,
    );
    expect(redacted).not.toContain("user@example.com");
    expect(redacted).toContain("[redacted-email]");
  });

  it("redacts authorization header-style key:value pairs", () => {
    const redacted = applyMcpGithubCapabilityRedaction(
      "Authorization: Bearer deadbeef123",
      policy,
    );
    expect(redacted).toMatch(/Authorization: \[redacted\]/i);
    expect(redacted).not.toContain("Bearer deadbeef123");
  });

  it("is case-insensitive on the redaction keyword", () => {
    const redacted = applyMcpGithubCapabilityRedaction(
      "X-GitHub-Token = abc123",
      policy,
    );
    expect(redacted).toMatch(/X-GitHub-Token: \[redacted\]/i);
    expect(redacted).not.toContain("abc123");
  });
});

describe("redactMcpArguments", () => {
  const policy = createDefaultMcpGithubCapabilityPolicy();

  it("redacts values at sensitive keys (case-insensitive) and preserves others", () => {
    const result = redactMcpArguments(
      { token: "abc", owner: "foo" },
      policy,
    );
    expect(result.token).toBe("[redacted]");
    expect(result.owner).toBe("foo");
  });

  it("preserves non-sensitive records untouched", () => {
    const result = redactMcpArguments(
      { owner: "foo", repo: "bar" },
      policy,
    );
    expect(result).toEqual({ owner: "foo", repo: "bar" });
  });

  it("scrubs string values at non-sensitive keys via applyMcpGithubCapabilityRedaction", () => {
    const token = "ghp_" + "b".repeat(36);
    const result = redactMcpArguments(
      { description: `owner uses ${token}` },
      policy,
    );
    expect(result.description).toContain("[redacted-github-token]");
    expect(result.description).not.toContain(token);
  });
});

describe("createDefaultMcpGithubCapabilityPolicy", () => {
  it("matches design §2.D8 defaults", () => {
    const policy = createDefaultMcpGithubCapabilityPolicy();
    expect(policy.allowedHttpOrigins).toEqual(["https://api.github.com"]);
    expect(policy.requireHttps).toBe(true);
    expect(policy.maxResponseBodyBytes).toBe(1_048_576);
    expect(policy.maxInvocationTimeoutMs).toBe(30_000);
    expect(policy.mcpToolName).toBe("github.get_repository");
    expect(policy.mcpServerId).toBe("github");
    expect(policy.maxLogLines).toBe(50);
    expect(policy.maxLogBytes).toBe(10_240);
    expect(policy.redactionKeywords).toEqual([
      "authorization",
      "x-github-token",
      "token",
      "api_key",
      "apikey",
      "secret",
      "password",
      "bearer",
      "access_token",
    ]);
    expect(policy.redactedEmailPattern).toBeInstanceOf(RegExp);
    expect(policy.redactedGithubPatPattern).toBeInstanceOf(RegExp);
  });
});

describe("BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS override", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("overrides the default timeout when set to a positive integer", () => {
    vi.stubEnv("BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS", "15000");
    const policy: McpGithubCapabilityPolicy =
      createDefaultMcpGithubCapabilityPolicy();
    expect(policy.maxInvocationTimeoutMs).toBe(15_000);
  });

  it("falls back to 30_000 when the env var is unset or invalid", () => {
    vi.stubEnv("BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS", "not-a-number");
    expect(
      createDefaultMcpGithubCapabilityPolicy().maxInvocationTimeoutMs,
    ).toBe(30_000);
  });

  it("clamps override values above 120_000 to the upper bound", () => {
    vi.stubEnv("BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS", "999999");
    expect(
      createDefaultMcpGithubCapabilityPolicy().maxInvocationTimeoutMs,
    ).toBe(120_000);
  });
});
