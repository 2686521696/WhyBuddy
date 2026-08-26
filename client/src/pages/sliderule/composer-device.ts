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

/**
 * 空态输入框的占位字。只说要写什么，不夹「输入 / 挂技能」。
 *
 * ⚠ 2026-08-26 上午在占位符尾巴加了「（输入 / 挂技能或连接器）」，下午用户
 *   指着首页圈了四处：占位符、框内 hint、工具条钮，同一句话写了三遍。
 *   斜杠入口只留工具条那颗「/ 技能 · 连接器」（sliderule-slash-hint），
 *   占位符回到只描述任务。再加回去，空框里又是三处重复。
 */
export function composerHeroPlaceholder(device: ComposerDevice): string {
  const what = device === "phone" ? "手机应用" : "业务系统";
  return `描述你想构建的${what}…`;
}
