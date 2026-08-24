/**
 * 设计系统：一次推演用哪一套视觉。
 *
 * ## 它管什么、不管什么
 *
 * **管**：种子色、字体、圆角、明暗。种子色经 `identity-palette.ts`（MCU / HCT）
 * 派生出真正渲染的 12 个字段，同一个种子色在 Python 侧拼进生成提示词、并产出
 * DESIGN.md 喂给模型。
 *
 * **不管**：应用做成什么样（那是 `device` + 用户那句话决定的）。换设计系统只换
 * 皮，不该触发重新生成业务结构。
 *
 * ## 为什么表放在 Python 的 data 目录
 *
 * 与 `identity_theme_presets.json` 同一套路：前后端**同读一份**。那个文件的
 * brandSeed 注释里写过为什么必须同源——
 *
 *   > 两边各写一份的话，提示词说的颜色和实际渲染的颜色会悄悄分叉，
 *   > 而这种分叉只有肉眼比对才看得出来。
 *
 * DESIGN.md 正好是这个陷阱的完美形状（一份给模型看、一份真正渲染），所以它
 * **不许手写**，只能由 `scripts/generate-design-md.mjs` 从这张表生成。
 *
 * ## 默认那套必须等于旧的 brandSeed
 *
 * `miantuan` 的 seed 与 identity_theme_presets.json 的 brandSeed 同值。这不是
 * 巧合是约束：不然这次改动会把所有存量应用的颜色换掉，而没有任何人要求过。
 * 判据钉在 __tests__/design-system.test.ts。
 */
import table from "@design-systems";

export type DesignSystemRadius = "none" | "sm" | "md" | "lg";

export type DesignSystem = {
  id: string;
  label: string;
  description: string;
  /** 种子色，6 位十六进制。派生规则见 identity-palette.ts。 */
  seed: string;
  headlineFont: string;
  bodyFont: string;
  radius: DesignSystemRadius;
  dark: boolean;
};

const TABLE = table as { defaultId: string; systems: DesignSystem[] };

export const DESIGN_SYSTEMS: readonly DesignSystem[] = TABLE.systems;
export const DEFAULT_DESIGN_SYSTEM_ID = TABLE.defaultId;

const DESIGN_SYSTEM_KEY = "sliderule:design-system";

export function findDesignSystem(id: string | null | undefined): DesignSystem {
  const hit = DESIGN_SYSTEMS.find(s => s.id === id);
  // 认不出就回落默认，不抛错：清单收窄之后老 localStorage 里的 id 会读不到，
  // 那时该静默换回默认色，不该让作曲家整个炸掉。
  return hit ?? DESIGN_SYSTEMS.find(s => s.id === DEFAULT_DESIGN_SYSTEM_ID)!;
}

export function loadDesignSystemId(): string {
  try {
    return findDesignSystem(localStorage.getItem(DESIGN_SYSTEM_KEY)).id;
  } catch {
    return DEFAULT_DESIGN_SYSTEM_ID;
  }
}

export function saveDesignSystemId(id: string): void {
  try {
    localStorage.setItem(DESIGN_SYSTEM_KEY, findDesignSystem(id).id);
  } catch {
    /* 存储不可用 → 本次会话内仍按内存态生效 */
  }
}
