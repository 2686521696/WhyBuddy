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

export const dataModelSkill: Skill<DataModelModel> & CrossSkill<DataModelModel> = {
  id: "datamodel",
  title: "数据中台",

  // -- THE GATE (entity/field integrity + relation integrity) --------------
  validate(model: DataModelModel): ReturnType<Skill<DataModelModel>["validate"]> {
    const f: Finding[] = [];
    const entityIds = new Set(model.entities.map(e => e.id));

    for (const dup of findDuplicates(model.entities.map(e => e.id)))
      f.push({ code: "DM_DUP_ENTITY_ID", severity: "error", path: `entity=${dup}`, message: `重复的实体 id：${dup}` });

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
      });
    });

    return finalizeReport(f);
  },

  // -- THE PROJECTOR (entities as nodes, ref fields as relations) ----------
  project(model: DataModelModel): Projection {
    const nodes = model.entities.map(e => ({ id: `dm_${sanitizeId(e.id)}`, label: e.name, kind: "entity" }));
    const edges: Projection["edges"] = [];
    model.entities.forEach(e => {
      e.fields
        .filter(fl => fl.type === "ref" && fl.refEntity)
        .forEach(fl =>
          edges.push({ from: `dm_${sanitizeId(e.id)}`, to: `dm_${sanitizeId(fl.refEntity!)}`, label: fl.name, kind: "relation" }),
        );
    });
    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}[("${n.label}")]`);
    for (const e of edges) lines.push(`  ${e.from} -->|${e.label ?? ""}| ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  // -- CROSS-SKILL SURFACE (others reference entities + fields) -------------
  resolve(model: DataModelModel): ResolvableSurface {
    return {
      entity: model.entities.map(e => e.id),
      field: model.entities.flatMap(e => e.fields.map(fl => `${e.id}.${fl.key}`)),
    };
  },

  // DataModel is a provider — it references nothing external.
  crossRefs(): CrossRefEdge[] {
    return [];
  },
  refNodeId(kind: string, value: string): string | null {
    if (kind === "entity") return `dm_${sanitizeId(value)}`;
    if (kind === "field") return `dm_${sanitizeId(value.split(".")[0])}`; // point at the owning entity
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

export const leaveRequestDataModel: DataModelModel = {
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
};
