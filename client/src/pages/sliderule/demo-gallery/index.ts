/**
 * Pages 画廊示例种子（E18，2026-07-16）——新引擎真实推演的闭环终态。
 *
 * 每个示例 = scripts/capture-pages-demo.mjs --gallery-out 捕获的瘦身会话
 * （报告正文保留、其余产物内容截断；应用可运行所需的 perSkillEvidence
 * 完整）。静态站工作台据此渲染示例卡；点卡片激活该会话，应用照常可操作
 * （模型驱动渲染不需要后端）。
 *
 * 本模块只被 Pages 工作台懒加载（~300KB JSON 不进主包）。
 */

import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import instruments from "./instruments.json";
import scriptclub from "./scripts.json";

export type GalleryExample = {
  sessionId: string;
  goal: string;
  state: V5SessionState;
};

export const GALLERY_EXAMPLES: GalleryExample[] = [
  {
    sessionId: "pages-demo-instruments",
    goal: (instruments as { goal: string }).goal,
    state: (instruments as { state: unknown }).state as V5SessionState,
  },
  {
    sessionId: "pages-demo-scriptclub",
    goal: (scriptclub as { goal: string }).goal,
    state: (scriptclub as { state: unknown }).state as V5SessionState,
  },
];

/** 把示例状态灌进 Pages 本地会话库（幂等：已存在同 id 直接覆盖为种子版）。 */
export async function seedGalleryExamples(store: {
  save: (state: V5SessionState) => Promise<V5SessionState>;
}): Promise<GalleryExample[]> {
  for (const example of GALLERY_EXAMPLES) {
    try {
      await store.save(example.state);
    } catch {
      // 单个种子写入失败不挡画廊（卡片仍可渲染，点开走空会话兜底）
    }
  }
  return GALLERY_EXAMPLES;
}
