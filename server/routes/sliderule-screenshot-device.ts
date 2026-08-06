export type SlideruleScreenshotDevice = "desktop" | "phone";

export function normalizeScreenshotDevice(value: unknown): SlideruleScreenshotDevice {
  return value === "phone" ? "phone" : "desktop";
}

export function resolveScreenshotResponseDevice(
  requested: unknown,
  actual: unknown,
): SlideruleScreenshotDevice {
  if (actual === "desktop" || actual === "phone") return actual;
  return normalizeScreenshotDevice(requested);
}

export function screenshotAuthoritySlug(
  sessionId: string,
  modelHash: string | undefined,
): string {
  return `${sessionId.slice(0, 32)}-${(modelHash ?? "nohash").slice(0, 16)}-device`;
}

export function screenshotCacheSlug(
  sessionId: string,
  modelHash: string | undefined,
  device: SlideruleScreenshotDevice,
): string {
  return `${sessionId.slice(0, 32)}-${device}-${(modelHash ?? "nohash").slice(0, 16)}`;
}
