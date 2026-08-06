import { describe, expect, it } from "vitest";

import {
  normalizeScreenshotDevice,
  resolveScreenshotResponseDevice,
  screenshotCacheSlug,
} from "../routes/sliderule-screenshot-device.js";

describe("SlideRule screenshot device contract", () => {
  it("accepts only the supported phone device", () => {
    expect(normalizeScreenshotDevice("phone")).toBe("phone");
    expect(normalizeScreenshotDevice("desktop")).toBe("desktop");
    expect(normalizeScreenshotDevice("tablet")).toBe("desktop");
    expect(normalizeScreenshotDevice(undefined)).toBe("desktop");
  });

  it("keeps desktop and phone screenshots in separate cache entries", () => {
    const desktop = screenshotCacheSlug("session-1", "model-1", "desktop");
    const phone = screenshotCacheSlug("session-1", "model-1", "phone");

    expect(desktop).not.toBe(phone);
    expect(desktop).toContain("-desktop-");
    expect(phone).toContain("-phone-");
  });

  it("uses the authoritative response device over a conflicting request", () => {
    expect(resolveScreenshotResponseDevice("desktop", "phone")).toBe("phone");
    expect(resolveScreenshotResponseDevice("phone", "desktop")).toBe("desktop");
    expect(resolveScreenshotResponseDevice("phone", null)).toBe("phone");
    expect(resolveScreenshotResponseDevice("tablet", "tablet")).toBe("desktop");
  });
});
