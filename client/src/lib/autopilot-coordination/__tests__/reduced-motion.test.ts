import { afterEach, describe, expect, it, vi } from "vitest";

import { prefersReducedMotion } from "../reduced-motion.js";

describe("prefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when evaluated outside a browser window", () => {
    vi.stubGlobal("window", undefined);

    expect(prefersReducedMotion()).toBe(false);
  });

  it("reads the reduced motion media query synchronously", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));

    vi.stubGlobal("window", { matchMedia });

    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("returns false when matchMedia is unavailable", () => {
    vi.stubGlobal("window", {});

    expect(prefersReducedMotion()).toBe(false);
  });
});
