import { describe, expect, it } from "vitest";

import {
  normalizeScreenshotDevice,
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
});
