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
  /** 具体参照（DESIGN.md 官方 PHILOSOPHY：具体参照 > 形容词堆）。 */
  reference?: string;
  /** 负向约束。官方 PHILOSOPHY：What you leave out defines the character。 */
  donts?: string[];
};

const TABLE = table as { defaultId: string; systems: DesignSystem[] };

export const DESIGN_SYSTEMS: readonly DesignSystem[] = TABLE.systems;
export const DEFAULT_DESIGN_SYSTEM_ID = TABLE.defaultId;

const DESIGN_SYSTEM_KEY = "sliderule:design-system";

export function findDesignSystem(id: string | null | undefined): DesignSystem {
  // 自建的排在前面：同 id 时自建赢（用户改过的那份才是他要的）
  const hit = allDesignSystems().find(s => s.id === id);
  // 认不出就回落默认，不抛错：清单收窄之后老 localStorage 里的 id 会读不到，
  // 那时该静默换回默认色，不该让作曲家整个炸掉。
  return hit ?? DESIGN_SYSTEMS.find(s => s.id === DEFAULT_DESIGN_SYSTEM_ID)!;
}

/**
 * ⚠ 三态，不是两态（2026-08-25 用户裁决）：
 *
 *     null   用户还没选     → 作曲家上显示一个调色板**图标**
 *     "xxx"  用户选了某一套 → 显示那套的**多色色块**
 *
 * 「没选」和「选了默认那套」必须能分开。改动前只有两态（读不到就当选了默认），
 * 图标态压根表达不出来。也因此 loadDesignSystemId 返回 `string | null` 而不是
 * 兜底成默认 id —— 兜底会把"没选"永远变成"选了"。
 *
 * 未选时推演侧照旧走全站 brandSeed（后端 override 传 null 即回落），所以这个
 * 三态只影响 UI 表达，不改变没选用户的生成结果。
 */
export function loadDesignSystemId(): string | null {
  try {
    const raw = localStorage.getItem(DESIGN_SYSTEM_KEY);
    if (!raw) return null;
    return allDesignSystems().some(s => s.id === raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveDesignSystemId(id: string): void {
  try {
    localStorage.setItem(DESIGN_SYSTEM_KEY, findDesignSystem(id).id);
  } catch {
    /* 存储不可用 → 本次会话内仍按内存态生效 */
  }
}

// --- 自建设计系统（2026-08-25）------------------------------------------------

const CUSTOM_KEY = "sliderule:design-systems-custom";

/**
 * 用户自建的设计系统。存 localStorage：跟 preferred-device / 机型偏好同一套
 * `sliderule:` 前缀，不进后端。
 *
 * ⚠ 自建的排在预设**前面**（Stitch 的「我的设计体系」也在「Stitch 预设」上方）：
 * 自己建的那套才是常用的，埋在十几个预设下面等于没建。
 */
export function loadCustomDesignSystems(): DesignSystem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (s): s is DesignSystem =>
        !!s &&
        typeof s.id === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(s.seed || "")
    );
  } catch {
    return [];
  }
}

/**
 * 把一份设计系统变成"我的"。
 *
 * ⚠ 2026-08-25 真机 bug 的根因就在这一步。此前面板的「应用」直接
 *   `saveCustomDesignSystem(sys)`，而 sys.id 还是**预设自己的 id**
 *   （比如 `miantuan`）。于是自建表和预设表各有一条同 id，清单把两份都铺出来
 *   ——列表里出现两条「面团·品牌」，而且 `on = sys.id === appliedId` 让两条
 *   同时打勾。
 *
 *   规矩：**以预设为基础另存必须换新 id**；已经是自建的再存则保持 id
 *   （否则每存一次就克隆一份，存三次出三条）。
 */
export function deriveCustomFrom(sys: DesignSystem): DesignSystem {
  if (isCustomDesignSystem(sys.id)) return sys;
  const isPreset = DESIGN_SYSTEMS.some(s => s.id === sys.id);
  if (!isPreset) return sys;
  return {
    ...sys,
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: `${sys.label} 副本`,
  };
}

export function saveCustomDesignSystem(sys: DesignSystem): void {
  // 预设永远不进自建表：撞 id 的那条脏数据就是这么来的。
  if (DESIGN_SYSTEMS.some(s => s.id === sys.id)) return;
  try {
    const list = loadCustomDesignSystems().filter(s => s.id !== sys.id);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify([sys, ...list]));
  } catch {
    /* 存储不可用 → 本次会话内仍按内存态生效 */
  }
}

export function deleteCustomDesignSystem(id: string): void {
  try {
    localStorage.setItem(
      CUSTOM_KEY,
      JSON.stringify(loadCustomDesignSystems().filter(s => s.id !== id))
    );
  } catch {
    /* ignore */
  }
}

/**
 * 自建在前、预设在后。查找与列表都走它，别在别处各拼各的。
 *
 * ⚠ 按 id 去重（自建赢）：这是兜底。根因在 deriveCustomFrom 已经堵住，
 *   但老版本存下来的脏数据仍会带着预设 id 躺在 localStorage 里——不去重的话
 *   那些用户升级上来照样看到两条。
 */
export function allDesignSystems(): DesignSystem[] {
  const out: DesignSystem[] = [];
  const seen = new Set<string>();
  for (const s of [...loadCustomDesignSystems(), ...DESIGN_SYSTEMS]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

export function isCustomDesignSystem(id: string): boolean {
  return loadCustomDesignSystems().some(s => s.id === id);
}

export function newCustomDesignSystem(): DesignSystem {
  const base = findDesignSystem(DEFAULT_DESIGN_SYSTEM_ID);
  return {
    ...base,
    id: `custom-${Date.now().toString(36)}`,
    label: "我的设计体系",
    description: "自建设计系统",
    reference: base.reference,
    donts: [...(base.donts ?? [])],
  };
}
