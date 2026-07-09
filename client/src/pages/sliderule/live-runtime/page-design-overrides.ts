/**
 * page-design-overrides — 页面设计器一期：本地设计覆盖层（纯函数 + localStorage）。
 *
 * 范式对标用户 MIT 项目 web-designer 的属性面板（右栏改属性、即改即渲染）；
 * 一期编辑对象锁定在五系统模型 page 段的既有语义上：
 *   - 页面标题（name）
 *   - 表格列（从主实体字段中挑选，替代默认前 6 个）
 *   - 表单字段（从主实体字段中挑选）
 *   - 图表声明（增/删/改：type/dimension/metric——与生成契约同构，
 *     字段选择器只提供真实存在的 ref → 结构上不可能造出悬挂引用）
 *
 * 设计覆盖不改写推演产出的模型本体（perSkillEvidence 是 Python 权威），
 * 而是渲染前叠加的本地层：与运行时行数据同一哲学（会话级 localStorage），
 * UI 如实标注"本地设计 · N 处修改"，一键重置回推演原貌。
 * 拖拽画布 / 组件面板（ComponentSchema 树）属设计器二期。
 */

import type { FiveSystemModel, PageChartSpec } from "../system-screens/five-system-model";

/** 单页的设计覆盖（字段全部可选——只存用户改过的） */
export interface PageDesignOverride {
  title?: string;
  /** 表格列字段 id（主实体内）；undefined = 用默认推导 */
  columnFieldIds?: string[];
  /** 表单字段 id（主实体内）；undefined = 用默认推导 */
  formFieldIds?: string[];
  /** 图表声明整组替换（与 page.charts 同构）；undefined = 用模型声明 */
  charts?: PageChartSpec[];
}

export type PageDesignOverrides = Record<string, PageDesignOverride>;

const KEY_PREFIX = "sliderule:page-design:";

export function loadPageDesignOverrides(sessionId: string): PageDesignOverrides {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId);
    const parsed = raw ? (JSON.parse(raw) as PageDesignOverrides) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function savePageDesignOverrides(sessionId: string, overrides: PageDesignOverrides): void {
  try {
    localStorage.setItem(KEY_PREFIX + sessionId, JSON.stringify(overrides));
  } catch {
    /* 存储不可用时静默降级为不持久化（内存态仍生效） */
  }
}

export function clearPageDesignOverrides(sessionId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + sessionId);
  } catch {
    /* noop */
  }
}

/** 覆盖条数（如实标注"本地设计 · N 处修改"用） */
export function countOverrideEdits(overrides: PageDesignOverrides): number {
  let n = 0;
  for (const o of Object.values(overrides)) {
    if (o.title !== undefined) n += 1;
    if (o.columnFieldIds !== undefined) n += 1;
    if (o.formFieldIds !== undefined) n += 1;
    if (o.charts !== undefined) n += 1;
  }
  return n;
}

/**
 * 渲染前叠加：把设计覆盖应用到模型 page 段（纯函数，不改入参）。
 * - title → page.name
 * - columnFieldIds/formFieldIds → 重写 fieldBindings（"entity.field" ref，
 *   只保留真实存在的字段——防旧覆盖在模型迭代后变悬挂）
 * - charts → 整组替换（同样按字段存在性过滤）
 */
export function applyPageDesignOverrides(
  model: FiveSystemModel,
  overrides: PageDesignOverrides
): FiveSystemModel {
  const pages = model.page?.pages;
  if (!pages || Object.keys(overrides).length === 0) return model;

  const fieldExists = (ref: string): boolean => {
    const dot = ref.indexOf(".");
    if (dot <= 0) return false;
    const entity = (model.datamodel?.entities ?? []).find((e) => e.id === ref.slice(0, dot));
    return Boolean(entity?.fields?.some((f) => f.id === ref.slice(dot + 1)));
  };

  return {
    ...model,
    page: {
      ...model.page,
      pages: pages.map((page) => {
        const o = page.id ? overrides[page.id] : undefined;
        if (!o) return page;
        const next = { ...page };
        if (o.title !== undefined && o.title.trim()) next.name = o.title.trim();

        // 列/表单覆盖 → 主实体字段 ref 进 fieldBindings（保序，过滤失效字段）
        const dominantEntity = dominantEntityIdOf(page.fieldBindings);
        if (dominantEntity && (o.columnFieldIds !== undefined || o.formFieldIds !== undefined)) {
          const picked = [
            ...(o.columnFieldIds ?? []),
            ...(o.formFieldIds ?? []).filter((id) => !(o.columnFieldIds ?? []).includes(id)),
          ]
            .map((fieldId) => `${dominantEntity}.${fieldId}`)
            .filter(fieldExists);
          if (picked.length > 0) next.fieldBindings = picked;
        }

        if (o.charts !== undefined) {
          next.charts = o.charts.filter(
            (c) =>
              fieldExists(String(c.dimension ?? "")) &&
              (String(c.metric ?? "count") === "count" ||
                fieldExists(String(c.metric ?? "").replace(/^sum:/, "")))
          );
        }
        return next;
      }),
    },
  };
}

/** 与 app-runtime-schema.dominantEntityId 同一规则（此处独立实现避免循环依赖）。 */
export function dominantEntityIdOf(fieldBindings: string[] | undefined): string | null {
  const counts = new Map<string, number>();
  for (const binding of fieldBindings ?? []) {
    const dot = binding.indexOf(".");
    if (dot <= 0) continue;
    const entityId = binding.slice(0, dot);
    counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
