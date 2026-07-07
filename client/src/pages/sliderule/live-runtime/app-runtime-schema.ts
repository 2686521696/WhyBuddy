/**
 * app-runtime-schema — "应用运行 option"：五系统模型 → 一份可直接渲染成
 * 完整后台系统的 JSON schema（el-form-renderer / el-data-table 哲学：
 * 菜单、表格列、表单项全部 JSON 化，渲染器照 schema 出真系统长相）。
 *
 * 纯函数模块：模型进、schema 出，无副作用，便于单测。
 */

import type { FiveSystemModel, FiveSystemField } from "../system-screens/five-system-model";

export interface AppFormFieldSchema {
  id: string;
  label: string;
  /** string | number | date | datetime | enum | ref | text（未知类型回退 string） */
  type: string;
  /** ref 字段指向的实体 id（type==="ref" 时给出，供渲染器做下拉） */
  refEntityId?: string;
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
  /** 操作权限标签（来自 page.actionPermissions，如 "life_goal:create"） */
  actions: string[];
  /** 本页是否挂了审批流（appbundle.pageBindings 里 pageRef→workflowRef） */
  workflowLinked: boolean;
}

export interface AppRuntimeSchema {
  appName: string;
  roles: string[];
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

  const pageSchemas: AppPageSchema[] = pages.map((page, index) => {
    const id = page.id || `page-${index + 1}`;
    const entityId = dominantEntityId(page.fieldBindings);
    const entity = entityId ? entityById.get(entityId) : undefined;
    const allFields = (entity?.fields ?? []).map(toFieldSchema);

    // ref 字段解析目标实体（"xxx_ref"/type ref → 猜同名实体），供下拉渲染。
    for (const f of allFields) {
      if (f.type === "ref") {
        const guess = f.id.replace(/_ref$/, "").replace(/_id$/, "");
        if (entityById.has(guess)) f.refEntityId = guess;
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
      formFields: boundFields.length > 0 ? boundFields : allFields,
      actions: (page.actionPermissions ?? []).map(String),
      workflowLinked: workflowLinkedPages.has(id) || workflowLinkedPages.has(page.id ?? ""),
    };
  });

  return {
    appName,
    roles: model?.rbac?.roles ?? [],
    menus: pageSchemas.map((p) => ({ id: `menu-${p.id}`, label: p.title, pageId: p.id })),
    pages: pageSchemas,
  };
}
