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
 * 空态输入框的占位字。
 *
 * ⚠ 2026-08-26 加上了「输入 / 挂技能或连接器」这半句：用户反馈"输入框中
 *   应该加入提醒"。斜杠唤起是学来的手势，界面上不写出来就等于没有——挂
 *   技能/连接器这条链路最主要的入口一直藏着。
 *   会话内那条紧凑胶囊**不加**这半句：它只有一行、宽度还要分给附件和芯片，
 *   加上去只会被挤成省略号。两处的提醒统一由工具条那颗「/ 技能·连接器」
 *   钮兜住（ComposerDock 里的 sliderule-slash-hint），这里只是空态多给一遍。
 */
export function composerHeroPlaceholder(device: ComposerDevice): string {
  const what = device === "phone" ? "手机应用" : "业务系统";
  return `描述你想构建的${what}…（输入 / 挂技能或连接器）`;
}
