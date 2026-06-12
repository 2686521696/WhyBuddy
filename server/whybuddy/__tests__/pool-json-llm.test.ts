import { describe, it, expect, afterEach, vi } from "vitest";
import {
  resolveWhyBuddyPoolRaceMode,
  resolveWhyBuddyPoolTimeoutMs,
  shouldSkipPrimaryLlmAfterPoolExhausted,
  resetWhyBuddyCapabilityPoolCache,
} from "../pool-json-llm.js";

describe("pool-json-llm tuning", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetWhyBuddyCapabilityPoolCache();
  });

  it("defaults race mode to parallel", () => {
    expect(resolveWhyBuddyPoolRaceMode()).toBe("parallel");
  });

  it("caps default pool timeout at 90s", () => {
    expect(resolveWhyBuddyPoolTimeoutMs(300_000)).toBe(90_000);
  });

  it("honors WHYBUDDY_POOL_TIMEOUT_MS override", () => {
    vi.stubEnv("WHYBUDDY_POOL_TIMEOUT_MS", "45000");
    expect(resolveWhyBuddyPoolTimeoutMs(300_000)).toBe(45_000);
  });

  it("skips primary after pool when enabled and pool configured", () => {
    vi.stubEnv("WHYBUDDY_CAPABILITY_POOL_ENABLED", "true");
    vi.stubEnv(
      "BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS",
      "k1,k2"
    );
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL", "https://example.test/v1");
    resetWhyBuddyCapabilityPoolCache();
    expect(shouldSkipPrimaryLlmAfterPoolExhausted()).toBe(true);
  });
});