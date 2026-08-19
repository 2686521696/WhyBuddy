/**
 * 作曲家「应用 / Web」目标形态。词表跟 device_policy 的 Device 对齐
 * （desktop / phone），不另发明 tablet。
 */
export type ComposerDevice = "desktop" | "phone";

export function parseComposerDevice(raw: unknown): ComposerDevice {
  return raw === "phone" ? "phone" : "desktop";
}

export const COMPOSER_DEVICE_OPTIONS: Array<{
  id: ComposerDevice;
  label: string;
}> = [
  { id: "phone", label: "应用" },
  { id: "desktop", label: "Web" },
];

export function composerHeroPlaceholder(device: ComposerDevice): string {
  return device === "phone"
    ? "描述你想构建的手机应用…"
    : "描述你想构建的业务系统…";
}
