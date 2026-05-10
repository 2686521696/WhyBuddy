import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyEngineeringHandoffRedaction,
  createDefaultEngineeringHandoffLlmPolicy,
} from "./policy.js";

describe("EngineeringHandoffLlmPolicy", () => {
  // 2.1 — default maxInvocationTimeoutMs is 30_000
  it("createDefaultEngineeringHandoffLlmPolicy returns maxInvocationTimeoutMs === 30_000 by default", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();
    expect(policy.maxInvocationTimeoutMs).toBe(30_000);
  });

  // 2.2 — env var override is respected
  describe("env var BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS override", () => {
    const ENV_KEY = "BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS";
    let originalValue: string | undefined;

    beforeEach(() => {
      originalValue = process.env[ENV_KEY];
    });

    afterEach(() => {
      if (originalValue === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = originalValue;
      }
    });

    it("reads BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS and applies valid value", () => {
      process.env[ENV_KEY] = "5000";
      const policy = createDefaultEngineeringHandoffLlmPolicy();
      expect(policy.maxInvocationTimeoutMs).toBe(5_000);
    });

    // 2.3 — invalid env var values fall back to 30_000
    it("falls back to 30_000 for invalid env var values", () => {
      const invalidValues = ["abc", "-1", "99999", "0"];
      for (const val of invalidValues) {
        process.env[ENV_KEY] = val;
        const policy = createDefaultEngineeringHandoffLlmPolicy();
        expect(policy.maxInvocationTimeoutMs).toBe(30_000);
      }
    });
  });

  // 2.4 — API key and GitHub PAT redaction
  it("redacts API keys and GitHub PATs", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();

    // sk- style API key
    const apiKeyInput = "sk-ABCDEFGHIJKLMNOP1234567890";
    const apiKeyResult = applyEngineeringHandoffRedaction(apiKeyInput, policy);
    expect(apiKeyResult).not.toContain("sk-ABCDEFGHIJKLMNOP1234567890");
    expect(apiKeyResult).toContain("[redacted-api-key]");

    // GitHub classic PAT (ghp_ prefix, 36+ chars)
    const ghpToken = "ghp_" + "a".repeat(36);
    const ghpResult = applyEngineeringHandoffRedaction(ghpToken, policy);
    expect(ghpResult).not.toContain(ghpToken);
    expect(ghpResult).toContain("[redacted-github-token]");

    // GitHub fine-grained PAT (github_pat_ prefix, 22+ chars)
    const fineGrainedToken = "github_pat_" + "B".repeat(22);
    const fineGrainedResult = applyEngineeringHandoffRedaction(
      fineGrainedToken,
      policy,
    );
    expect(fineGrainedResult).not.toContain(fineGrainedToken);
    expect(fineGrainedResult).toContain("[redacted-github-token]");
  });

  // 2.5 — email and key-value pair redaction
  it("redacts emails and key-value secret pairs", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();

    // Email redaction
    const emailResult = applyEngineeringHandoffRedaction(
      "contact alice@example.com",
      policy,
    );
    expect(emailResult).not.toContain("alice@example.com");
    expect(emailResult).toContain("[redacted-email]");

    // Authorization: Bearer xxx
    const authResult = applyEngineeringHandoffRedaction(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9",
      policy,
    );
    expect(authResult).toContain("authorization: [redacted]");
    expect(authResult).not.toContain("eyJhbGciOiJIUzI1NiJ9");

    // token=xxx
    const tokenResult = applyEngineeringHandoffRedaction(
      "token=superSecretToken123",
      policy,
    );
    expect(tokenResult).toContain("token: [redacted]");
    expect(tokenResult).not.toContain("superSecretToken123");

    // api_key=xxx
    const apiKeyResult = applyEngineeringHandoffRedaction(
      "api_key=mySecretKey456",
      policy,
    );
    expect(apiKeyResult).toContain("api_key: [redacted]");
    expect(apiKeyResult).not.toContain("mySecretKey456");
  });

  // 2.6 — ReDoS sentinel: 5MB string completes in < 200ms
  it("processes a 5MB string in under 200ms (ReDoS sentinel)", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();
    const largeInput = "a".repeat(5_000_000);

    const start = performance.now();
    applyEngineeringHandoffRedaction(largeInput, policy);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
  });
});
