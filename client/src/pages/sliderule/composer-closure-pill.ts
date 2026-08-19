/**
 * 输入条顶行的闭环胶囊文案。
 *
 * 标准答案在 AppBundleScreen 模块头：这是 GitHub Checks / Cursor Problems
 * 那一类——主文案报「过没过」，缺证据必须红，不许用 6/6 分数或进度条
 * 把 blocked 画成快成功了。分数只进 title，悬停还能核对。
 */
export function formatComposerClosurePill(pc: {
  blocked: boolean;
  evidencePresentCount: number;
  skillCount: number;
}): { label: string; blocked: boolean; title: string } {
  const n = `${pc.evidencePresentCount}/${pc.skillCount}`;
  if (pc.blocked) {
    return { label: "未收口", blocked: true, title: `证据 ${n}` };
  }
  return { label: "已收口", blocked: false, title: `证据 ${n}` };
}
