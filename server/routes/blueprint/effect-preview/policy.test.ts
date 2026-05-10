import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyEffectPreviewRedaction,
  createDefaultEffectPreviewLlmPolicy,
} from "./policy.js";

/**
 * Validates: Requirements 2.8, 4.1, 5.1, 9.8
 *
 * ~6 example-based tests covering:
 * - Default policy timeout value (30_000)
 * - Env var override for timeout (valid value)
 * - Invalid env var values fall back to 30_000
 * - API key redaction
 * - Email redaction
 * - ReDoS sentinel (5MB plain text within 200ms)
 */

describe("createDefaultEffectPreviewLlmPolicy", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // 2.1 Default timeout value
  it("returns maxInvocationTimeoutMs === 30_000 by default", () => {
    const policy = createDefaultEffectPreviewLlmPolicy();
    expect(policy.maxInvocationTimeoutMs).toBe(30_000);
  });

  // 2.2 Env var override for timeout
  it('reads BLUEPRINT_EFFECT_PREVIEW_LLM_TIMEOUT_MS="5000" and sets maxInvocationTimeoutMs === 5_000', () => {
    vi.stubEnv("BLUEPRINT_EFFECT_PREVIEW_LLM_TIMEOUT_MS", "5000");
    const policy = createDefaultEffectPreviewLlmPolicy();
    expect(policy.maxInvocationTimeoutMs).toBe(5_000);
  });

  // 2.3 Invalid env var values fall back to 30_000
  it('falls back to 30_000 for invalid env var values ("abc" / "-1" / "99999" / "0")', () => {
    const invalidValues = ["abc", "-1", "99999", "0"];
    for (const value of invalidValues) {
      vi.stubEnv("BLUEPRINT_EFFECT_PREVIEW_LLM_TIMEOUT_MS", value);
      const policy = createDefaultEffectPreviewLlmPolicy();
      expect(policy.maxInvocationTimeoutMs).toBe(30_000);
      vi.unstubAllEnvs();
    }
  });
});

describe("applyEffectPreviewRedaction", () => {
  const policy = createDefaultEffectPreviewLlmPolicy();

  // 2.4 API key redaction
  it("redacts API keys so the original substring is not present", () => {
    const input = "sk-ABCDEFGHIJKLMNOP1234567890";
    const result = applyEffectPreviewRedaction(input, policy);
    expect(result).not.toContain("sk-ABCDEFGHIJKLMNOP1234567890");
    expect(result).toContain("[redacted-api-key]");
  });

  // 2.5 Email redaction
  it("redacts email addresses so the original substring is not present", () => {
    const input = "contact alice@example.com";
    const result = applyEffectPreviewRedaction(input, policy);
    expect(result).not.toContain("alice@example.com");
    expect(result).toContain("[redacted-email]");
  });

  // 2.6 ReDoS sentinel
  it("processes a 5MB string within 200ms (ReDoS sentinel)", () => {
    const fiveMB = "a".repeat(5_000_000);
    const start = performance.now();
    applyEffectPreviewRedaction(fiveMB, policy);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
