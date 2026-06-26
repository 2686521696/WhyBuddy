import {
  finalizeReport,
  type CrossRefEdge,
  type CrossSkill,
  type Finding,
  type Projection,
  type ResolvableSurface,
  type Skill,
} from "../skill";
import type { DataModelModel } from "./dataModelModel";

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

function withSsotMetadata(model: DataModelModel): DataModelModel {
  const fieldIds: Record<string, string> = {
    "employee.id": "f_emp_id_v1",
    "employee.name": "f_emp_name_v1",
    "employee.dept": "f_emp_dept_v1",
    "leave_request.id": "f_leave_id_v1",
    "leave_request.applicant": "f_leave_applicant_v1",
    "leave_request.leaveType": "f_leave_type_v1",
    "leave_request.days": "f_leave_days_v1",
    "leave_request.reason": "f_leave_reason_v1",
    "leave_request.approved": "f_leave_approved_v1",
  };

  return {
    entities: model.entities.map(entity => ({
      ...entity,
      namespace: entity.namespace ?? "hr",
      fields: entity.fields.map(field => ({
        ...field,
        fieldId: field.fieldId ?? fieldIds[`${entity.id}.${field.key}`] ?? `f_${sanitizeId(entity.id)}_${sanitizeId(field.key)}_v1`,
        version: field.version ?? 1,
        lifecycle: field.lifecycle ?? "active",
        storageRole: field.storageRole ?? "ssot",
      })),
    })),
  };
}

export const dataModelSkill: Skill<DataModelModel> & CrossSkill<DataModelModel> = {
  id: "datamodel",
  title: "数据中台",

  // -- THE GATE (entity/field integrity + relation integrity) --------------
  validate(model: DataModelModel): ReturnType<Skill<DataModelModel>["validate"]> {
    const f: Finding[] = [];
    const entityIds = new Set(model.entities.map(e => e.id));

    for (const dup of findDuplicates(model.entities.map(e => e.id)))
      f.push({ code: "DM_DUP_ENTITY_ID", severity: "error", path: `entity=${dup}`, message: `重复的实体 id：${dup}` });

    // -- SSOT field identity / lifecycle / version / OLAP checks -------------
    const fieldIdUsages: Record<string, Array<{entityId: string; fieldKey: string; version?: number; lifecycle?: string; storageRole?: string; index: number}>> = {};
    model.entities.forEach((entity, ei) => {
      entity.fields.forEach((fl, fi) => {
        if (fl.fieldId) {
          if (!fieldIdUsages[fl.fieldId]) fieldIdUsages[fl.fieldId] = [];
          fieldIdUsages[fl.fieldId].push({
            entityId: entity.id,
            fieldKey: fl.key,
            version: fl.version,
            lifecycle: fl.lifecycle,
            storageRole: fl.storageRole,
            index: fi,
          });
        }
      });
    });

    for (const [fid, usages] of Object.entries(fieldIdUsages)) {
      if (usages.length > 1) {
        f.push({ code: "DM_DUP_FIELD_ID", severity: "error", path: `fieldId=${fid}`, message: `字段 ID 重复：${fid}` });
      }
      const vers = new Set(usages.map(u => u.version).filter(v => v != null));
      if (vers.size > 1) {
        f.push({ code: "DM_FIELD_VERSION_MISMATCH", severity: "error", path: `fieldId=${fid}`, message: `字段 ID ${fid} 版本不一致` });
      }
      const hasOlap = usages.some(u => u.storageRole === "olap_projection");
      const hasSsot = usages.some(u => u.storageRole !== "olap_projection");
      if (hasOlap && hasSsot) {
        f.push({ code: "DM_OLAP_NOT_SSOT", severity: "error", path: `fieldId=${fid}`, message: `OLAP 投影字段不能冒充 SSOT：${fid}` });
      }
    }

    // duplicate entity-field (by fieldId) pairs
    for (const [fid, usages] of Object.entries(fieldIdUsages)) {
      const pairKeys = usages.map(u => `${u.entityId}:${fid}`);
      for (const dup of findDuplicates(pairKeys)) {
        f.push({ code: "DM_DUP_ENTITY_FIELD", severity: "error", path: `entity-field=${dup}`, message: `实体-字段 ID 对重复：${dup}` });
      }
    }

    model.entities.forEach(entity => {
      if (entity.fields.length === 0)
        f.push({ code: "DM_EMPTY_ENTITY", severity: "warning", path: `entities[${entity.id}]`, message: `实体「${entity.name}」没有任何字段` });

      for (const dup of findDuplicates(entity.fields.map(fl => fl.key)))
        f.push({ code: "DM_DUP_FIELD_KEY", severity: "error", path: `entities[${entity.id}].fields`, message: `实体「${entity.name}」字段 key 重复：${dup}` });

      if (!entity.fields.some(fl => fl.key === "id"))
        f.push({ code: "DM_NO_PRIMARY_KEY", severity: "warning", path: `entities[${entity.id}]`, message: `实体「${entity.name}」缺少 id 主键字段` });

      entity.fields.forEach((fl, i) => {
        if (fl.type === "enum" && (!fl.enumValues || fl.enumValues.length === 0))
          f.push({ code: "DM_ENUM_NO_VALUES", severity: "error", path: `entities[${entity.id}].fields[${i}]`, message: `枚举字段「${fl.name}」没有给出可选值` });
        if (fl.type === "ref") {
          if (!fl.refEntity)
            f.push({ code: "DM_REF_NO_TARGET", severity: "error", path: `entities[${entity.id}].fields[${i}]`, message: `关联字段「${fl.name}」没有指定目标实体` });
          else if (!entityIds.has(fl.refEntity))
            f.push({ code: "DM_REF_MISSING_ENTITY", severity: "error", path: `entities[${entity.id}].fields[${i}].refEntity`, message: `关联字段「${fl.name}」指向不存在的实体：${fl.refEntity}` });
        }
        // lifecycle checks (SSOT)
        if (fl.lifecycle === "deprecated") {
          f.push({ code: "DM_FIELD_DEPRECATED", severity: "warning", path: `entities[${entity.id}].fields[${i}]`, message: `字段「${fl.name}」已弃用` });
        } else if (fl.lifecycle === "removed") {
          f.push({ code: "DM_FIELD_REMOVED", severity: "error", path: `entities[${entity.id}].fields[${i}]`, message: `字段「${fl.name}」已移除` });
        }
      });
    });

    return finalizeReport(f);
  },

  // -- THE PROJECTOR (entities as nodes, fields as distinct SSOT nodes) ----------
  project(model: DataModelModel): Projection {
    const entityNodes = model.entities.map(e => ({ id: `dm_${sanitizeId(e.id)}`, label: e.name, kind: "entity" }));
    const fieldNodes = model.entities.flatMap(e =>
      e.fields.map(fl => ({
        id: `dm_${sanitizeId(e.id)}_${sanitizeId(fl.key)}`,
        label: fl.name,
        kind: "field",
      }))
    );
    const nodes = [...entityNodes, ...fieldNodes];
    const edges: Projection["edges"] = [];
    // preserve entity-level ref relations for coarse consumers
    model.entities.forEach(e => {
      e.fields
        .filter(fl => fl.type === "ref" && fl.refEntity)
        .forEach(fl =>
          edges.push({ from: `dm_${sanitizeId(e.id)}`, to: `dm_${sanitizeId(fl.refEntity!)}`, label: fl.name, kind: "relation" }),
        );
    });
    // ownership edges so diagrams clearly connect entities to their SSOT fields
    model.entities.forEach(e => {
      e.fields.forEach(fl => {
        edges.push({
          from: `dm_${sanitizeId(e.id)}`,
          to: `dm_${sanitizeId(e.id)}_${sanitizeId(fl.key)}`,
          label: "field",
          kind: "contains",
        });
      });
    });
    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}[("${n.label}")]`);
    for (const e of edges) lines.push(`  ${e.from} -->|${e.label ?? ""}| ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  // -- CROSS-SKILL SURFACE (others reference entities + fields) -------------
  resolve(model: DataModelModel): ResolvableSurface {
    // return extra 'fields' (with metadata) via cast because ResolvableSurface type (outside allowed) only declares entity/field strings
    const surf: any = {
      entity: model.entities.map(e => e.id),
      // keep bare string field refs for compat with entity-level / coarse consumers
      field: model.entities.flatMap(e => e.fields.map(fl => `${e.id}.${fl.key}`)),
      // field-level SSOT surface with version + lifecycle metadata (for downstream field refs)
      fields: model.entities.flatMap(e =>
        e.fields.map(fl => ({
          ref: `${e.id}.${fl.key}`,
          version: fl.version ?? 1,
          lifecycle: fl.lifecycle ?? "active",
          fieldId: fl.fieldId,
        }))
      ),
    };
    return surf;
  },

  // DataModel is a provider — it references nothing external.
  crossRefs(): CrossRefEdge[] {
    return [];
  },
  refNodeId(kind: string, value: string): string | null {
    if (kind === "entity") return `dm_${sanitizeId(value)}`;
    if (kind === "field") {
      // support "entity.field" and "entity.field@vN" (or equiv); map to distinct field node
      const base = value.split("@")[0];
      const [ent, fld] = base.split(".");
      if (ent && fld) return `dm_${sanitizeId(ent)}_${sanitizeId(fld)}`;
      return null;
    }
    return null;
  },

  async generate(intent: string): Promise<DataModelModel> {
    if (/请假|leave|审批/i.test(intent)) return leaveRequestDataModel;
    throw new Error(`dataModelSkill.generate: 需要接入推演引擎来为意图生成数据模型：「${intent}」`);
  },
};

// ---------------------------------------------------------------------------
// Worked example — the data layer for "请假审批", with the entities RBAC + Workflow point at.
// ---------------------------------------------------------------------------

export const leaveRequestDataModel: DataModelModel = withSsotMetadata({
  entities: [
    {
      id: "employee",
      name: "员工",
      fields: [
        { key: "id", name: "工号", type: "string", required: true },
        { key: "name", name: "姓名", type: "string", required: true },
        { key: "dept", name: "部门", type: "string" },
      ],
    },
    {
      id: "leave_request",
      name: "请假单",
      fields: [
        { key: "id", name: "单号", type: "string", required: true },
        { key: "applicant", name: "申请人", type: "ref", refEntity: "employee", required: true },
        { key: "leaveType", name: "请假类型", type: "enum", enumValues: ["年假", "病假", "事假"] },
        { key: "days", name: "天数", type: "number", required: true },
        { key: "reason", name: "事由", type: "string" },
        { key: "approved", name: "是否通过", type: "boolean" },
      ],
    },
  ],
});
