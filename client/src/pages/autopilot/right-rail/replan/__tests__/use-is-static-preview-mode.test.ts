import { describe, expect, it, vi } from "vitest";

import {
  detectStaticPreviewMode,
  useIsStaticPreviewMode,
} from "../use-is-static-preview-mode";

describe("useIsStaticPreviewMode", () => {
  it("exports a hook and treats the module flag as static preview without probing latest jobs", async () => {
    const probeLatestJobs = vi.fn();

    await expect(
      detectStaticPreviewMode({
        moduleStaticFlag: true,
        fallbackStaticPreview: false,
        probeLatestJobs,
      }),
    ).resolves.toBe(true);

    expect(typeof useIsStaticPreviewMode).toBe("function");
    expect(probeLatestJobs).not.toHaveBeenCalled();
  });

  it("falls back to static preview when the latest jobs probe cannot reach the API", async () => {
    await expect(
      detectStaticPreviewMode({
        moduleStaticFlag: false,
        fallbackStaticPreview: true,
        probeLatestJobs: vi.fn().mockResolvedValue({ ok: false }),
      }),
    ).resolves.toBe(true);
  });

  it("keeps local server mode enabled when latest jobs responds successfully", async () => {
    await expect(
      detectStaticPreviewMode({
        moduleStaticFlag: false,
        fallbackStaticPreview: true,
        probeLatestJobs: vi.fn().mockResolvedValue({ ok: true }),
      }),
    ).resolves.toBe(false);
  });
});
