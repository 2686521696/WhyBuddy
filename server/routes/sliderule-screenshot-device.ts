export type SlideruleScreenshotDevice = "desktop" | "phone";

export function normalizeScreenshotDevice(value: unknown): SlideruleScreenshotDevice {
  return value === "phone" ? "phone" : "desktop";
}

export function screenshotCacheSlug(
  sessionId: string,
  modelHash: string | undefined,
  device: SlideruleScreenshotDevice,
): string {
  return `${sessionId.slice(0, 32)}-${device}-${(modelHash ?? "nohash").slice(0, 16)}`;
}
