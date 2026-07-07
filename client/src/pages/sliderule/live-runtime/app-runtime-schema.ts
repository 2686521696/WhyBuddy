/**
 * app-runtime-schema — "应用运行 option"：五系统模型 → 一份可直接渲染成
 * 完整后台系统的 JSON schema（el-form-renderer / el-data-table 哲学：
 * 菜单、表格列、表单项全部 JSON 化，渲染器照 schema 出真系统长相）。
 *
 * 纯函数模块：模型进、schema 出，无副作用，便于单测。
 */

import { guessRefEntityId, type FiveSystemModel, type FiveSystemField } from "../system-screens/five-system-model";

export interface AppFormFieldSchema {
  id: string;
  label: string;
  /** string | number | date | datetime | enum | ref | text（未知类型回退 string） */
  type: string;
  /** ref 字段指向的实体 id（type==="ref" 时给出，供渲染器做下拉） */
  refEntityId?: string;
}

/** 页面可用的 AI 动作：outputField 落在本页主实体的 AIGC 能力。 */
export interface AppAiActionSchema {
  capId: string;
  label: string;
  /** 能力声明的输入引用（"entity.field"；同实体的从当前行预填） */
  inputFields: string[];
  /** 输出写回的字段（本页主实体的字段 id） */
  outputFieldId: string;
  /** 输出字段展示名 */
  outputLabel: string;
}

export interface AppPageSchema {
  id: string;
  title: string;
  /** 本页主实体（fieldBindings 中出现最多的实体）；无绑定时 null → 渲染器显示空页 */
  entityId: string | null;
  /** 数据表列（主实体字段） */
  columns: AppFormFieldSchema[];
  /** 新建/编辑表单项（页面绑定的字段；不足时回退主实体全字段） */
  formFields: AppFormFieldSchema[];
  /** 详情抽屉字段（主实体全字段，不截断） */
  detailFields: AppFormFieldSchema[];
  /** 操作权限标签（来自 page.actionPermissions，如 "life_goal:create"） */
  actions: string[];
  /** 本页是否挂了审批流（appbundle.pageBindings 里 pageRef→workflowRef） */
  workflowLinked: boolean;
  /** 详情抽屉里的 AI 生成动作（无绑定能力时为空数组） */
  aiActions: AppAiActionSchema[];
}

export interface AppStatCardSchema {
  id: string;
  label: string;
  /**
   * 取值来源（渲染器对着运行时状态求值）：
   *   "entity:<id>"（该实体行数）| "instances:running" | "instances:total" | "roles"
   */
  source: string;
  suffix: string;
}

export interface AppChartSchema {
  id: string;
  /** bar（横向条形，单色 · 各类目一个度量）| donut（状态分布环图） */
  type: "bar" | "donut";
  label: string;
  /** "entities:rowcount"（各实体行数）| "instances:status"（审批状态分布） */
  source: string;
}

/** 工作台（首页仪表盘）也 JSON 化：统计卡/图表声明，渲染器照 schema 出 Pro 风格首页。 */
export interface AppHomeSchema {
  id: "home";
  title: string;
  stats: AppStatCardSchema[];
  charts: AppChartSchema[];
}

export interface AppRuntimeSchema {
  appName: string;
  roles: string[];
  home: AppHomeSchema;
  menus: Array<{ id: string; label: string; pageId: string }>;
  pages: AppPageSchema[];
}

function toFieldSchema(field: FiveSystemField): AppFormFieldSchema {
  const type = String(field.type || "string").toLowerCase();
  const schema: AppFormFieldSchema = {
    id: field.id,
    label: field.name || field.id,
    type,
  };
  return schema;
}

/** "entity.field" 绑定串中出现最多的实体 = 页面主实体。 */
function dominantEntityId(fieldBindings: string[] | undefined): string | null {
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

/**
 * AI 动作的试跑输入：同实体的 inputFields 从当前行取值预填，
 * 跨实体引用如实留空（不猜、不横跨行拼数据）。
 */
export function buildAiActionInputs(
  action: AppAiActionSchema,
  entityId: string,
  rowValues: Record<string, unknown>
): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const ref of action.inputFields) {
    const dot = ref.indexOf(".");
    if (dot <= 0) continue;
    const refEntity = ref.slice(0, dot);
    const refField = ref.slice(dot + 1);
    const v = refEntity === entityId ? rowValues[refField] : undefined;
    inputs[ref] = v === undefined || v === null ? "" : String(v);
  }
  return inputs;
}

export function deriveAppRuntimeSchema(
  model: FiveSystemModel | null | undefined,
  appName = "推演应用"
): AppRuntimeSchema | null {
  const pages = model?.page?.pages ?? [];
  const entities = model?.datamodel?.entities ?? [];
  if (pages.length === 0 || entities.length === 0) return null;

  const entityById = new Map(entities.map((e) => [e.id, e] as const));
  const workflowLinkedPages = new Set(
    (model?.appbundle?.pageBindings ?? [])
      .filter((b) => b.workflowRef)
      .map((b) => b.pageRef)
  );

  // AIGC 能力按 outputField 所属实体归组：outputField="entity.field" 且
  // 字段真实存在才算数（悬空引用不进运行应用——各屏已负责标红）。
  const aiActionsByEntity = new Map<string, AppAiActionSchema[]>();
  for (const [i, cap] of (model?.aigc?.capabilities ?? []).entries()) {
    const out = cap.outputField ?? "";
    const dot = out.indexOf(".");
    if (dot <= 0) continue;
    const entityId = out.slice(0, dot);
    const fieldId = out.slice(dot + 1);
    const field = entityById.get(entityId)?.fields?.find((f) => f.id === fieldId);
    if (!field) continue;
    const list = aiActionsByEntity.get(entityId) ?? [];
    list.push({
      capId: cap.id || `cap-${i}`,
      label: cap.name || cap.id || `能力 ${i + 1}`,
      inputFields: (cap.inputFields ?? []).map(String),
      outputFieldId: fieldId,
      outputLabel: field.name || fieldId,
    });
    aiActionsByEntity.set(entityId, list);
  }

  const pageSchemas: AppPageSchema[] = pages.map((page, index) => {
    const id = page.id || `page-${index + 1}`;
    const entityId = dominantEntityId(page.fieldBindings);
    const entity = entityId ? entityById.get(entityId) : undefined;
    const allFields = (entity?.fields ?? []).map(toFieldSchema);

    // ref 字段解析目标实体（"xxx_ref"/type ref → 词干唯一匹配），供下拉渲染。
    for (const f of allFields) {
      if (f.type === "ref" || /_ref$/.test(f.id)) {
        const guess = guessRefEntityId(f.id, entityById.keys());
        if (guess && guess !== entityId) f.refEntityId = guess;
      }
    }

    // 表单项 = 页面绑定到主实体的字段；一个都对不上时回退实体全字段。
    const boundFieldIds = new Set(
      (page.fieldBindings ?? [])
        .filter((b) => entityId && b.startsWith(`${entityId}.`))
        .map((b) => b.slice((entityId as string).length + 1))
    );
    const boundFields = allFields.filter((f) => boundFieldIds.has(f.id));

    return {
      id,
      title: page.name || id,
      entityId: entity ? entityId : null,
      columns: allFields.slice(0, 6),
      detailFields: allFields,
      formFields: boundFields.length > 0 ? boundFields : allFields,
      actions: (page.actionPermissions ?? []).map(String),
      workflowLinked: workflowLinkedPages.has(id) || workflowLinkedPages.has(page.id ?? ""),
      aiActions: entityId ? aiActionsByEntity.get(entityId) ?? [] : [],
    };
  });

  // 工作台统计卡：前两个实体行数 + 审批实例两项，凑不足 4 张时补角色数。
  const stats: AppStatCardSchema[] = entities.slice(0, 2).map((e) => ({
    id: `stat-entity-${e.id}`,
    label: `${e.name || e.id}`,
    source: `entity:${e.id}`,
    suffix: "条",
  }));
  stats.push(
    { id: "stat-running", label: "进行中审批", source: "instances:running", suffix: "件" },
    { id: "stat-total", label: "累计流程实例", source: "instances:total", suffix: "件" }
  );
  if (stats.length < 4) {
    stats.push({ id: "stat-roles", label: "系统角色", source: "roles", suffix: "个" });
  }

  const home: AppHomeSchema = {
    id: "home",
    title: "工作台",
    stats: stats.slice(0, 4),
    charts: [
      { id: "chart-entities", type: "bar", label: "各实体数据量", source: "entities:rowcount" },
      { id: "chart-instances", type: "donut", label: "审批状态分布", source: "instances:status" },
    ],
  };

  return {
    appName,
    roles: model?.rbac?.roles ?? [],
    home,
    menus: [
      { id: "menu-home", label: home.title, pageId: home.id },
      ...pageSchemas.map((p) => ({ id: `menu-${p.id}`, label: p.title, pageId: p.id })),
    ],
    pages: pageSchemas,
  };
}
