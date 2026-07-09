import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveImSurfaceMode } from "../im-surface-mode";

describe("resolveImSurfaceMode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to product without window (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(resolveImSurfaceMode()).toBe("product");
  });

  it("defaults to product timeline in browser", () => {
    vi.stubGlobal("window", {
      location: { search: "" },
    });
    expect(resolveImSurfaceMode()).toBe("product");
  });

  it("?im=minimal enables bare narration tier", () => {
    vi.stubGlobal("window", {
      location: { search: "?im=minimal" },
    });
    expect(resolveImSurfaceMode()).toBe("minimal");
  });

  it("?im=dev enables engineering tier", () => {
    vi.stubGlobal("window", {
      location: { search: "?im=dev" },
    });
    expect(resolveImSurfaceMode()).toBe("engineering");
  });
});