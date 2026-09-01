/**
 * 作曲家产品原型。合法域跟账本接通档对齐。
 *
 * ⚠ 2026-08-30：小游戏是原型轴，不进设备那颗钮（范围卡上选）。
 * 2026-08-31 用户圈了空态 Web/应用/平板 下拉要加「自由类型」——
 * 仍是原型轴，另起一颗。两轴混一颗发送会分不清：选了「自由」就丢了
 * Web/手机。
 */
import {
  defaultArchetype,
  parseProductArchetype,
  wiredArchetypes,
} from "./product-archetypes";

export type ComposerArchetypeOption = {
  id: string;
  label: string;
  title: string;
};

const COMPOSER_ARCHETYPE_LABELS: Record<string, string> = {
  business_app: "业务",
  content_app: "内容",
  free_app: "自由类型",
};

const COMPOSER_ARCHETYPE_TITLES: Record<string, string> = {
  business_app: "按业务 / 后台应用推演（表、角色、审批）",
  content_app: "按消费 / 内容应用推演（封面、图流、杂志）",
  free_app: "自由类型：不套后台中台，也不套杂志四页",
};

export function composerArchetypeMenu(): ComposerArchetypeOption[] {
  return wiredArchetypes().map(row => ({
    id: row.id,
    label: COMPOSER_ARCHETYPE_LABELS[row.id] || row.label,
    title: COMPOSER_ARCHETYPE_TITLES[row.id] || row.label,
  }));
}

export function composerArchetypeTriggerLabel(id: string): string {
  const row = composerArchetypeMenu().find(item => item.id === id);
  return row?.label || COMPOSER_ARCHETYPE_LABELS[id] || "业务";
}

export { defaultArchetype, parseProductArchetype };
