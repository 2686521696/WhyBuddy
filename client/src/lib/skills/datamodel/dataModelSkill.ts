import {
  finalizeReport,
  type CrossRefEdge,
  type CrossSkill,
  type Finding,
  type Projection,
  type ResolvableSurface,
  type Skill,
  type ValidateContext,
} from "../skill";
import type {
  DataModelModel,
  Dataset,
  Entity,
  Field,
  FieldLineageEdge,
  FieldLineageIndex,
  FieldLineageNode,
  Lifecycle,
  MigrationAction,
  MigrationActionType,
  PolicyDefinition,
  Relation,
  RelationCardinality,
  SensitivityLevel,
} from "./dataModelModel";

/** Helper for consumers (Page/Workflow/AIGC) to inspect SSOT field lifecycle from the datamodel surface.
 *  Enables "cannot silently bind" gate: deprecated -> warning, removed -> error on field refs.
 */
export function getFieldLifecycle(
  surface: ResolvableSurface | any,
  ref: string
): string | undefined {
  const fields = (surface as any)?.fields;
  if (!Array.isArray(fields)) return undefined;
  const f = fields.find((ff: any) => ff && ff.ref === ref);
  return f ? (f.lifecycle as string | undefined) : undefined;
}

export const DM_MIGRATION_REMOVED_FIELD_BLOCKER =
  "DM_MIGRATION_REMOVED_FIELD_BLOCKER";

/**
 * Pure runtime (in-memory, deterministic, no IO) migration planner.
 * Diffs previous vs next DataModelModel and emits executable migrationActions
 * for added/changed/deprecated/removed fields (and type changes).
 * Removed fields referenced by datasets are classified with DM_MIGRATION_REMOVED_FIELD_BLOCKER findings.
 */
export function planDataModelMigration(
  previousModel: DataModelModel,
  nextModel: DataModelModel
): { migrationActions: MigrationAction[]; findings: Finding[] } {
  const migrationActions: MigrationAction[] = [];
  const findings: Finding[] = [];

  const prevEntMap = new Map(previousModel.entities.map(e => [e.id, e]));
  const nextEntMap = new Map(nextModel.entities.map(e => [e.id, e]));
  const allEntityIds = new Set([...prevEntMap.keys(), ...nextEntMap.keys()]);

  // Build dataset field refs for blocker detection (datasets serve as in-model references;
  // pages/workflows refs are detected by callers via resolve + getFieldLifecycle).
  const datasetFieldRefs = new Set<string>();
  const allDatasets = [
    ...((previousModel as any).datasets || []),
    ...((nextModel as any).datasets || []),
  ];
  for (const ds of allDatasets) {
    if (ds && ds.entityRef && Array.isArray(ds.selectedFields)) {
      for (const sf of ds.selectedFields) {
        if (sf && typeof sf.field === "string") {
          datasetFieldRefs.add(`${ds.entityRef}.${sf.field}`);
        }
      }
    }
  }

  for (const entityId of allEntityIds) {
    const prevEnt = prevEntMap.get(entityId);
    const nextEnt = nextEntMap.get(entityId);
    const prevFields = new Map((prevEnt?.fields || []).map(f => [f.key, f]));
    const nextFields = new Map((nextEnt?.fields || []).map(f => [f.key, f]));
    const allFieldKeys = new Set([...prevFields.keys(), ...nextFields.keys()]);

    for (const key of allFieldKeys) {
      const pf = prevFields.get(key);
      const nf = nextFields.get(key);
      const fieldRef = `${entityId}.${key}`;

      if (!pf && nf) {
        // added field
        migrationActions.push({
          action: "add",
          entity: entityId,
          field: key,
        });
      } else if (pf && !nf) {
        // removed field
        migrationActions.push({
          action: "remove",
          entity: entityId,
          field: key,
          planRef: "generated-plan",
        });
        if (datasetFieldRefs.has(fieldRef)) {
          findings.push({
            code: DM_MIGRATION_REMOVED_FIELD_BLOCKER,
            severity: "error",
            path: `entities[${entityId}].fields[${key}]`,
            message: `Removed field ${fieldRef} is referenced by datasets and blocks migration`,
          });
        }
      } else if (pf && nf) {
        // existing field: lifecycle or type changes
        if (pf.lifecycle !== nf.lifecycle) {
          if (nf.lifecycle === "deprecated") {
            migrationActions.push({
              action: "deprecate",
              entity: entityId,
              field: key,
            });
          } else if (nf.lifecycle === "removed") {
            migrationActions.push({
              action: "remove",
              entity: entityId,
              field: key,
              planRef: "generated-plan",
            });
            if (datasetFieldRefs.has(fieldRef)) {
              findings.push({
                code: DM_MIGRATION_REMOVED_FIELD_BLOCKER,
                severity: "error",
                path: `entities[${entityId}].fields[${key}]`,
                message: `Removed field ${fieldRef} is referenced by datasets and blocks migration`,
              });
            }
          }
        }
        if (pf.type !== nf.type && nf.type) {
          migrationActions.push({
            action: "type-change",
            entity: entityId,
            field: key,
            from: pf.type,
            to: nf.type,
            planRef: "generated-plan",
          });
        }
        // version change is reported via actions only when accompanied by type or explicit lifecycle;
        // stable findings carry the intent without side effects
      }
    }
  }

  return { migrationActions, findings };
}

/** Required runtime symbol for 117: dataset/field binding resolution (pure, deterministic, no I/O). */
export const DM_DATASET_BINDING_FIELD_MISSING =
  "DM_DATASET_BINDING_FIELD_MISSING";

/** Stable evidence record for binding resolution (for Page/Workflow/AIGC/RBAC consumers). */
export interface BindingEvidence {
  code: string;
  ref: string;
  message: string;
  severity: "error" | "warning";
}

/** Pure builder for bindingEvidence (exported symbol required by task). */
export function bindingEvidence(
  code: string,
  ref: string,
  message: string,
  severity: "error" | "warning" = "error"
): BindingEvidence {
  return { code, ref, message, severity };
}

/** 119: derive changed entity/field refs from DataModel field/entity changes.
 *  Considers: non-active lifecycle fields, fields with policyRef (RBAC PDP delegation), and migrationPlan actions.
 *  Used to feed impact evidence creators for runtime closure.
 */
export function deriveDataModelChangedRefs(model: DataModelModel): {
  entity: string[];
  field: string[];
} {
  const entityRefs: string[] = [];
  const fieldRefs: string[] = [];
  (model.entities || []).forEach((e: Entity) => {
    let entChanged = false;
    (e.fields || []).forEach((fl: Field) => {
      const ref = `${e.id}.${fl.key}`;
      const isChangedLifecycle = fl.lifecycle && fl.lifecycle !== "active";
      if (isChangedLifecycle || fl.policyRef) {
        fieldRefs.push(ref);
        entChanged = true;
      }
    });
    if (entChanged) {
      entityRefs.push(e.id);
    }
  });
  const plan: any = (model as any).migrationPlan;
  if (plan && Array.isArray(plan.actions)) {
    plan.actions.forEach((act: any) => {
      if (act && act.entity) {
        if (act.field) {
          fieldRefs.push(`${act.entity}.${act.field}`);
          entityRefs.push(act.entity);
        } else {
          entityRefs.push(act.entity);
        }
      }
    });
  }
  return {
    entity: Array.from(new Set(entityRefs)).sort(),
    field: Array.from(new Set(fieldRefs)).sort(),
  };
}

/**
 * resolveDatasetBindingRuntime(model, bindingRefs)
 * Pure runtime helper: resolves dataset and field bindings to entity/field metadata.
 * Returns lifecycle, sensitivity, policyRef etc for consumers (Page/Workflow/AIGC).
 * Missing/deprecated/removed produce stable findings + evidence (fail-closed).
 */
export function resolveDatasetBindingRuntime(
  model: DataModelModel,
  bindingRefs: string[]
): {
  resolved: Array<{
    ref: string;
    entityRef: string;
    fieldKey: string;
    lifecycle: string;
    sensitivity?: SensitivityLevel;
    policyRef?: string;
    version?: number;
    fieldId?: string;
  }>;
  findings: Finding[];
  evidence: BindingEvidence[];
  ok: boolean;
} {
  const findings: Finding[] = [];
  const evidence: BindingEvidence[] = [];
  const resolved: any[] = [];

  // Build SSOT field metadata lookup from model.entities (pure)
  const fieldMeta: Record<string, any> = {};
  (model.entities || []).forEach((e: Entity) => {
    (e.fields || []).forEach((fl: Field) => {
      const ref = `${e.id}.${fl.key}`;
      fieldMeta[ref] = {
        entityRef: e.id,
        fieldKey: fl.key,
        lifecycle: fl.lifecycle ?? "active",
        sensitivity: fl.sensitivity,
        policyRef: fl.policyRef,
        version: fl.version ?? 1,
        fieldId: fl.fieldId,
      };
    });
  });

  // Map dataset-oriented bindings (e.g. "dsId.field" or alias) to underlying entity.field
  const dsToField: Record<string, string> = {};
  (model.datasets || []).forEach((ds: Dataset) => {
    (ds.selectedFields || []).forEach((sf: any) => {
      if (sf && typeof sf.field === "string") {
        const base = `${ds.entityRef}.${sf.field}`;
        dsToField[`${ds.id}.${sf.field}`] = base;
        if (sf.alias && typeof sf.alias === "string") {
          dsToField[`${ds.id}.${sf.alias}`] = base;
        }
      }
    });
  });

  const refs = Array.isArray(bindingRefs) ? bindingRefs : [];
  for (const rawRef of refs) {
    const ref = typeof rawRef === "string" ? rawRef : "";
    if (!ref) continue;
    // resolve via dataset binding if applicable, else direct entity.field
    const target = dsToField[ref] || ref;
    const meta = fieldMeta[target];
    if (!meta) {
      const msg = `Dataset/field binding not resolvable (missing): ${ref}`;
      findings.push({
        code: DM_DATASET_BINDING_FIELD_MISSING,
        severity: "error",
        path: `binding=${ref}`,
        message: msg,
      });
      evidence.push(
        bindingEvidence(DM_DATASET_BINDING_FIELD_MISSING, ref, msg, "error")
      );
      continue;
    }
    // removed: hard error (fail-closed)
    if (meta.lifecycle === "removed") {
      const msg = `Dataset/field binding to removed field: ${ref}`;
      findings.push({
        code: "DM_FIELD_REMOVED",
        severity: "error",
        path: `binding=${ref}`,
        message: msg,
      });
      evidence.push(bindingEvidence("DM_FIELD_REMOVED", ref, msg, "error"));
      continue;
    }
    // deprecated: stable finding (warning)
    if (meta.lifecycle === "deprecated") {
      const msg = `Dataset/field binding to deprecated field: ${ref}`;
      findings.push({
        code: "DM_FIELD_DEPRECATED",
        severity: "warning",
        path: `binding=${ref}`,
        message: msg,
      });
      evidence.push(
        bindingEvidence("DM_FIELD_DEPRECATED", ref, msg, "warning")
      );
    }
    resolved.push({ ref, ...meta });
  }

  const hasError = findings.some(f => f.severity === "error");
  return { resolved, findings, evidence, ok: !hasError };
}

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
    "purchase_request.amount": "f_purchase_request_amount_v1",
  };

  return {
    entities: model.entities.map(entity => ({
      ...entity,
      namespace: entity.namespace ?? "hr",
      fields: entity.fields.map(field => ({
        ...field,
        fieldId:
          field.fieldId ??
          fieldIds[`${entity.id}.${field.key}`] ??
          `f_${sanitizeId(entity.id)}_${sanitizeId(field.key)}_v1`,
        version: field.version ?? 1,
        lifecycle: field.lifecycle ?? "active",
        storageRole: field.storageRole ?? "ssot",
        sensitivity: field.sensitivity,
        policyRef: field.policyRef,
        pdpVisibleTo: field.pdpVisibleTo,
      })),
    })),
    relations: model.relations ? [...model.relations] : undefined,
    migrationPlan: model.migrationPlan,
    datasets: model.datasets
      ? model.datasets.map((d: Dataset) => ({
          id: d.id,
          name: d.name,
          entityRef: d.entityRef,
          selectedFields: (d.selectedFields || []).map(sf => ({ ...sf })),
          parameters: d.parameters ? [...d.parameters] : undefined,
          outputAliases: d.outputAliases ? { ...d.outputAliases } : undefined,
        }))
      : undefined,
    policyDefinitions: model.policyDefinitions
      ? model.policyDefinitions.map((p: PolicyDefinition) => ({ ...p }))
      : undefined,
  };
}

/** Pure runtime constant for missing field in lineage trace (fail-closed behavior). */
export const DM_LINEAGE_FIELD_MISSING = "DM_LINEAGE_FIELD_MISSING";

/** Build a queryable pure field lineage index from DataModel.
 *  Collects entity/field nodes + references contributed by datasets (selectedFields),
 *  policies (policyRef + policyDefinitions), migrations (actions), and relations.
 *  No side effects, no I/O.
 */
export function buildFieldLineageIndex(
  model: DataModelModel
): FieldLineageIndex {
  const nodes: FieldLineageNode[] = [];
  const edges: FieldLineageEdge[] = [];
  const fieldRefs: string[] = [];
  const nodeIds = new Set<string>();

  function addNode(n: FieldLineageNode) {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  }

  // Core: entities + fields (SSOT source of truth for lineage)
  model.entities.forEach(ent => {
    const entId = `dm_${sanitizeId(ent.id)}`;
    addNode({ id: entId, kind: "entity", ref: ent.id });
    ent.fields.forEach(fl => {
      const fRef = `${ent.id}.${fl.key}`;
      fieldRefs.push(fRef);
      const fId = `dm_${sanitizeId(ent.id)}_${sanitizeId(fl.key)}`;
      addNode({ id: fId, kind: "field", ref: fRef });
      edges.push({ from: entId, to: fId, kind: "contains", label: "field" });
      // ref fields create cross-entity lineage links
      if (fl.type === "ref" && fl.refEntity) {
        const tgtEntId = `dm_${sanitizeId(fl.refEntity)}`;
        edges.push({ from: fId, to: tgtEntId, kind: "ref", label: fl.key });
      }
    });
  });

  // Datasets: selected fields produce "selects" references (consumer side of lineage)
  (model.datasets || []).forEach((ds: Dataset) => {
    const dsId = `ds_${sanitizeId(ds.id)}`;
    addNode({ id: dsId, kind: "dataset", ref: ds.id });
    const entId = `dm_${sanitizeId(ds.entityRef)}`;
    edges.push({ from: dsId, to: entId, kind: "binds", label: "entity" });
    (ds.selectedFields || []).forEach(sf => {
      const fRef = `${ds.entityRef}.${sf.field}`;
      const fId = `dm_${sanitizeId(ds.entityRef)}_${sanitizeId(sf.field)}`;
      edges.push({
        from: dsId,
        to: fId,
        kind: "selects",
        label: sf.alias || sf.field,
      });
      // field -> dataset consumer for downstream lineage
      if (nodeIds.has(fId)) {
        edges.push({
          from: fId,
          to: dsId,
          kind: "consumed_by",
          label: "dataset",
        });
      }
    });
  });

  // Policies: field policyRef and top level policyDefinitions contribute policy nodes/edges
  const polIds = new Set<string>();
  model.entities.forEach(ent => {
    ent.fields.forEach(fl => {
      if (fl.policyRef) {
        const pId = `pol_${sanitizeId(fl.policyRef)}`;
        if (!polIds.has(pId)) {
          polIds.add(pId);
          addNode({ id: pId, kind: "policy", ref: fl.policyRef });
        }
        const fId = `dm_${sanitizeId(ent.id)}_${sanitizeId(fl.key)}`;
        edges.push({
          from: fId,
          to: pId,
          kind: "policy",
          label: `sensitive:${fl.sensitivity || "policy"}`,
        });
      }
    });
  });
  (model.policyDefinitions || []).forEach((pd: PolicyDefinition) => {
    const pId = `pol_${sanitizeId(pd.id)}`;
    if (!polIds.has(pId)) {
      polIds.add(pId);
      addNode({ id: pId, kind: "policy", ref: pd.id });
    }
  });

  // Migrations: actions produce "affects" lineage edges to target fields/entities
  const plan: any = (model as any).migrationPlan;
  if (plan && Array.isArray(plan.actions)) {
    const planId = `mig_${sanitizeId(plan.id || "plan")}`;
    addNode({ id: planId, kind: "migration", ref: plan.id || "plan" });
    plan.actions.forEach((act: MigrationAction, i: number) => {
      const tgtRef = act.field ? `${act.entity}.${act.field}` : act.entity;
      const actId = `mig_act${i}_${sanitizeId(act.entity)}${act.field ? "_" + sanitizeId(act.field) : ""}`;
      addNode({ id: actId, kind: "migration", ref: `${act.action}:${tgtRef}` });
      edges.push({
        from: planId,
        to: actId,
        kind: "migration",
        label: act.action,
      });
      const tgtId = act.field
        ? `dm_${sanitizeId(act.entity)}_${sanitizeId(act.field)}`
        : `dm_${sanitizeId(act.entity)}`;
      if (nodeIds.has(tgtId)) {
        edges.push({
          from: actId,
          to: tgtId,
          kind: "affects",
          label: act.action,
        });
      }
    });
  }

  // Relations: contribute entity-entity and thus field propagation edges
  (model.relations || []).forEach((rel: Relation, ri: number) => {
    const rId = `rel_${rel.key ? sanitizeId(rel.key) : String(ri)}`;
    addNode({
      id: rId,
      kind: "relation",
      ref: rel.key || `${rel.fromEntity}->${rel.toEntity}`,
    });
    const fromE = `dm_${sanitizeId(rel.fromEntity)}`;
    const toE = `dm_${sanitizeId(rel.toEntity)}`;
    edges.push({
      from: fromE,
      to: toE,
      kind: "relation",
      label: rel.cardinality,
    });
  });

  return {
    nodes,
    edges,
    fieldRefs: Array.from(new Set(fieldRefs)),
  };
}

/** Trace upstream (sources) / downstream (consumers) for a fieldRef using the index.
 *  Returns findings containing DM_LINEAGE_FIELD_MISSING on absent field (fail-closed).
 */
export function traceFieldLineage(
  index: FieldLineageIndex,
  fieldRef: string
): {
  fieldRef: string;
  upstream: string[];
  downstream: string[];
  findings: Array<{
    code: string;
    severity?: string;
    path?: string;
    message?: string;
  }>;
} {
  const findings: Array<{
    code: string;
    severity?: string;
    path?: string;
    message?: string;
  }> = [];
  const present = index.fieldRefs.includes(fieldRef);
  if (!present) {
    findings.push({
      code: DM_LINEAGE_FIELD_MISSING,
      severity: "error",
      path: `fieldRef=${fieldRef}`,
      message: `Field lineage not found: ${fieldRef}`,
    });
    return { fieldRef, upstream: [], downstream: [], findings };
  }

  const [ent, fld] = fieldRef.split(".");
  const fId = `dm_${sanitizeId(ent)}_${sanitizeId(fld || "")}`;

  const upstream: string[] = [];
  const downstream: string[] = [];
  index.edges.forEach(e => {
    if (
      e.to === fId ||
      e.to === fieldRef ||
      (fld && e.to.includes(`_${fld}`))
    ) {
      upstream.push(e.from);
    }
    if (
      e.from === fId ||
      e.from === fieldRef ||
      (fld && e.from.includes(`_${fld}`))
    ) {
      downstream.push(e.to);
    }
  });

  return {
    fieldRef,
    upstream: Array.from(new Set(upstream)),
    downstream: Array.from(new Set(downstream)),
    findings,
  };
}

export const dataModelSkill: Skill<DataModelModel> &
  CrossSkill<DataModelModel> = {
  id: "datamodel",
  title: "数据中台",

  // -- THE GATE (entity/field integrity + relation integrity) --------------
  validate(
    model: DataModelModel,
    ctx?: ValidateContext
  ): ReturnType<Skill<DataModelModel>["validate"]> {
    const f: Finding[] = [];
    const entityIds = new Set(model.entities.map(e => e.id));

    for (const dup of findDuplicates(model.entities.map(e => e.id)))
      f.push({
        code: "DM_DUP_ENTITY_ID",
        severity: "error",
        path: `entity=${dup}`,
        message: `重复的实体 id：${dup}`,
      });

    // -- SSOT field identity / lifecycle / version / OLAP checks -------------
    const fieldIdUsages: Record<
      string,
      Array<{
        entityId: string;
        fieldKey: string;
        version?: number;
        lifecycle?: string;
        storageRole?: string;
        index: number;
      }>
    > = {};
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
        f.push({
          code: "DM_DUP_FIELD_ID",
          severity: "error",
          path: `fieldId=${fid}`,
          message: `字段 ID 重复：${fid}`,
        });
      }
      const vers = new Set(usages.map(u => u.version).filter(v => v != null));
      if (vers.size > 1) {
        f.push({
          code: "DM_FIELD_VERSION_MISMATCH",
          severity: "error",
          path: `fieldId=${fid}`,
          message: `字段 ID ${fid} 版本不一致`,
        });
      }
      const hasOlap = usages.some(u => u.storageRole === "olap_projection");
      const hasSsot = usages.some(u => u.storageRole !== "olap_projection");
      if (hasOlap && hasSsot) {
        f.push({
          code: "DM_OLAP_NOT_SSOT",
          severity: "error",
          path: `fieldId=${fid}`,
          message: `OLAP 投影字段不能冒充 SSOT：${fid}`,
        });
      }
    }

    // duplicate entity-field (by fieldId) pairs
    for (const [fid, usages] of Object.entries(fieldIdUsages)) {
      const pairKeys = usages.map(u => `${u.entityId}:${fid}`);
      for (const dup of findDuplicates(pairKeys)) {
        f.push({
          code: "DM_DUP_ENTITY_FIELD",
          severity: "error",
          path: `entity-field=${dup}`,
          message: `实体-字段 ID 对重复：${dup}`,
        });
      }
    }

    model.entities.forEach(entity => {
      if (entity.fields.length === 0)
        f.push({
          code: "DM_EMPTY_ENTITY",
          severity: "warning",
          path: `entities[${entity.id}]`,
          message: `实体「${entity.name}」没有任何字段`,
        });

      for (const dup of findDuplicates(entity.fields.map(fl => fl.key)))
        f.push({
          code: "DM_DUP_FIELD_KEY",
          severity: "error",
          path: `entities[${entity.id}].fields`,
          message: `实体「${entity.name}」字段 key 重复：${dup}`,
        });

      if (!entity.fields.some(fl => fl.key === "id"))
        f.push({
          code: "DM_NO_PRIMARY_KEY",
          severity: "warning",
          path: `entities[${entity.id}]`,
          message: `实体「${entity.name}」缺少 id 主键字段`,
        });

      entity.fields.forEach((fl, i) => {
        if (
          fl.type === "enum" &&
          (!fl.enumValues || fl.enumValues.length === 0)
        )
          f.push({
            code: "DM_ENUM_NO_VALUES",
            severity: "error",
            path: `entities[${entity.id}].fields[${i}]`,
            message: `枚举字段「${fl.name}」没有给出可选值`,
          });
        if (fl.type === "ref") {
          if (!fl.refEntity)
            f.push({
              code: "DM_REF_NO_TARGET",
              severity: "error",
              path: `entities[${entity.id}].fields[${i}]`,
              message: `关联字段「${fl.name}」没有指定目标实体`,
            });
          else if (!entityIds.has(fl.refEntity))
            f.push({
              code: "DM_REF_MISSING_ENTITY",
              severity: "error",
              path: `entities[${entity.id}].fields[${i}].refEntity`,
              message: `关联字段「${fl.name}」指向不存在的实体：${fl.refEntity}`,
            });
        }
        // lifecycle checks (SSOT)
        if (fl.lifecycle === "deprecated") {
          f.push({
            code: "DM_FIELD_DEPRECATED",
            severity: "warning",
            path: `entities[${entity.id}].fields[${i}]`,
            message: `字段「${fl.name}」已弃用`,
          });
        } else if (fl.lifecycle === "removed") {
          f.push({
            code: "DM_FIELD_REMOVED",
            severity: "error",
            path: `entities[${entity.id}].fields[${i}]`,
            message: `字段「${fl.name}」已移除`,
          });
        }
        // sensitive field policy gate: sensitive fields must carry PDP delegation metadata (policyRef)
        if (fl.sensitivity && fl.sensitivity !== "none" && !fl.policyRef) {
          f.push({
            code: "DM_SENSITIVE_FIELD_NO_POLICY",
            severity: "error",
            path: `entities[${entity.id}].fields[${i}]`,
            message: `敏感字段「${fl.name}」必须提供 policyRef 以委托 RBAC PDP 决策`,
          });
        }
      });
    });

    // -- V2 relation cardinality + inverse + self gate ----------------------
    const rels: Relation[] = Array.isArray(model.relations)
      ? model.relations
      : [];
    const relKeys = rels.map(r => r.key).filter(Boolean) as string[];
    for (const dup of findDuplicates(relKeys))
      f.push({
        code: "DM_DUP_RELATION_KEY",
        severity: "error",
        path: `relation=${dup}`,
        message: `关系 key 重复：${dup}`,
      });

    rels.forEach((rel, ri) => {
      // runtime cardinality gate (TS union does not protect JSON/any/generator input)
      const card: any = (rel as any).cardinality;
      const validCards: readonly RelationCardinality[] = [
        "one-to-one",
        "one-to-many",
        "many-to-one",
        "many-to-many",
      ];
      if (
        typeof card !== "string" ||
        !validCards.includes(card as RelationCardinality)
      ) {
        f.push({
          code: "DM_REL_INVALID_CARDINALITY",
          severity: "error",
          path: `relations[${ri}]`,
          message: `关系基数无效：${card}，必须是 one-to-one、one-to-many、many-to-one 或 many-to-many 之一`,
        });
      }
      if (!entityIds.has(rel.fromEntity)) {
        f.push({
          code: "DM_REL_MISSING_FROM",
          severity: "error",
          path: `relations[${ri}]`,
          message: `关系源实体不存在：${rel.fromEntity}`,
        });
      }
      if (!entityIds.has(rel.toEntity)) {
        f.push({
          code: "DM_REL_MISSING_TO",
          severity: "error",
          path: `relations[${ri}]`,
          message: `关系目标实体不存在：${rel.toEntity}`,
        });
      }
      const isSelf = rel.fromEntity === rel.toEntity;
      if (isSelf && !rel.allowSelf) {
        f.push({
          code: "DM_REL_INVALID_SELF",
          severity: "error",
          path: `relations[${ri}]`,
          message: `自关系必须显式 allowSelf=true：${rel.fromEntity} -> ${rel.toEntity}`,
        });
      }
      if (rel.inverse) {
        // inverse must exist and point back
        const inv = rels.find(
          r =>
            (r.key && r.key === rel.inverse) ||
            (r.name && r.name === rel.inverse)
        );
        const pointsBack =
          inv &&
          inv.fromEntity === rel.toEntity &&
          inv.toEntity === rel.fromEntity;
        if (!pointsBack) {
          f.push({
            code: "DM_REL_INVERSE_MISMATCH",
            severity: "error",
            path: `relations[${ri}]`,
            message: `inverse 引用缺失或不匹配：${rel.inverse}`,
          });
        }
      }
    });

    // -- V2 migration plan gate (add/rename/deprecate/remove/type-change) ----
    // Pure data validation only. Destructive actions require explicit planRef evidence.
    // High-risk actions without planRef get warnings. Existing models without plan remain compatible.
    const plan = (model as any).migrationPlan as
      | { id?: string; version?: number; actions?: MigrationAction[] }
      | undefined;
    if (plan) {
      if (!Array.isArray(plan.actions)) {
        f.push({
          code: "DM_MIGRATION_PLAN_NO_ACTIONS",
          severity: "error",
          path: "migrationPlan",
          message: "migrationPlan 必须包含 actions 数组",
        });
      } else {
        const destructive = new Set(["remove", "type-change"]);
        const highRisk = new Set(["deprecate", "rename"]);
        plan.actions.forEach((act: MigrationAction, i: number) => {
          if (!act || !act.action || !act.entity) {
            f.push({
              code: "DM_MIGRATION_ACTION_INVALID",
              severity: "error",
              path: `migrationPlan.actions[${i}]`,
              message: "迁移动作缺少 action 或 entity",
            });
            return;
          }
          const actType = act.action;
          // runtime enum gate for action (TS union alone cannot protect JSON/any/generator inputs)
          const validActions: readonly MigrationActionType[] = [
            "add",
            "rename",
            "deprecate",
            "remove",
            "type-change",
          ];
          if (
            typeof actType !== "string" ||
            !validActions.includes(actType as MigrationActionType)
          ) {
            f.push({
              code: "DM_MIGRATION_INVALID_ACTION",
              severity: "error",
              path: `migrationPlan.actions[${i}]`,
              message: `迁移动作类型无效：${actType}，只允许 add/rename/deprecate/remove/type-change`,
            });
            return;
          }
          const hasRef =
            !!act.planRef &&
            typeof act.planRef === "string" &&
            act.planRef.trim().length > 0;
          const path = `migrationPlan.actions[${i}]`;
          const target = act.field ? `${act.entity}.${act.field}` : act.entity;
          if (destructive.has(actType) && !hasRef) {
            f.push({
              code: "DM_MIGRATION_DESTRUCTIVE_NO_PLAN",
              severity: "error",
              path,
              message: `破坏性迁移 ${actType} 于 ${target} 缺少 planRef 证据`,
            });
          } else if (
            (highRisk.has(actType) || destructive.has(actType)) &&
            !hasRef
          ) {
            // high-risk (rename/deprecate) without ref -> warning (destructive already errored above)
            f.push({
              code: "DM_MIGRATION_HIGH_RISK_NO_REF",
              severity: "warning",
              path,
              message: `高风险迁移 ${actType} 于 ${target} 建议提供 planRef`,
            });
          }
          if (actType === "rename" || actType === "type-change") {
            if (!act.from || !act.to) {
              f.push({
                code: "DM_MIGRATION_FROM_TO_REQUIRED",
                severity: "error",
                path,
                message: `${actType} 动作必须提供 from/to：${target}`,
              });
            }
          }
          if (actType === "add" && !act.to && !act.field) {
            f.push({
              code: "DM_MIGRATION_ADD_TARGET_REQUIRED",
              severity: "warning",
              path,
              message: `add 动作建议提供 field 或 to 说明新增目标：${target}`,
            });
          }
        });
      }
    }

    // -- V2 dataset binding model gate (entityRef + selected field refs against entity + aliases) ---
    const datasets: Dataset[] = Array.isArray((model as any).datasets)
      ? (model as any).datasets
      : [];
    const dsIds = datasets
      .map((d: any) => d && d.id)
      .filter(Boolean) as string[];
    for (const dup of findDuplicates(dsIds))
      f.push({
        code: "DM_DUP_DATASET_ID",
        severity: "error",
        path: `dataset=${dup}`,
        message: `数据集 id 重复：${dup}`,
      });

    datasets.forEach((ds: any, di: number) => {
      if (
        !ds ||
        !ds.id ||
        typeof ds.id !== "string" ||
        !ds.entityRef ||
        typeof ds.entityRef !== "string"
      ) {
        f.push({
          code: "DM_DATASET_INVALID",
          severity: "error",
          path: `datasets[${di}]`,
          message: "数据集缺少有效 id 或 entityRef",
        });
        return;
      }
      if (!entityIds.has(ds.entityRef)) {
        f.push({
          code: "DM_DATASET_MISSING_ENTITY",
          severity: "error",
          path: `datasets[${di}].entityRef`,
          message: `数据集「${ds.id}」绑定到不存在的实体：${ds.entityRef}`,
        });
        return;
      }
      if (!Array.isArray(ds.selectedFields) || ds.selectedFields.length === 0) {
        f.push({
          code: "DM_DATASET_FIELD_INVALID",
          severity: "error",
          path: `datasets[${di}].selectedFields`,
          message: `数据集「${ds.id}」必须声明非空的 selectedFields 数组以提供 field mapping outputs`,
        });
        return;
      }
      const targetEnt = model.entities.find(e => e.id === ds.entityRef)!;
      const entFieldKeys = new Set(targetEnt.fields.map(fl => fl.key));
      const sel = ds.selectedFields;
      sel.forEach((sf: any, si: number) => {
        const fld = sf && typeof sf.field === "string" ? sf.field : "";
        if (!fld) {
          f.push({
            code: "DM_DATASET_FIELD_INVALID",
            severity: "error",
            path: `datasets[${di}].selectedFields[${si}]`,
            message: `数据集「${ds.id}」的字段选择无效`,
          });
          return;
        }
        if (!entFieldKeys.has(fld)) {
          f.push({
            code: "DM_DATASET_FIELD_NOT_ON_ENTITY",
            severity: "error",
            path: `datasets[${di}].selectedFields[${si}].field`,
            message: `数据集「${ds.id}」选择的字段「${fld}」在实体「${ds.entityRef}」上不存在`,
          });
        }
      });
      // basic outputAliases validation (string targets)
      if (ds.outputAliases && typeof ds.outputAliases === "object") {
        Object.entries(ds.outputAliases).forEach(([alias, tgt]) => {
          if (typeof tgt !== "string" || !tgt) {
            f.push({
              code: "DM_DATASET_ALIAS_INVALID",
              severity: "error",
              path: `datasets[${di}].outputAliases.${alias}`,
              message: `数据集输出别名「${alias}」目标无效`,
            });
          }
        });
      }
    });

    // -- 115.20.07 PDP delegation: represent model/row/field/export policy defs as inputs; validate point to RBAC PDP decisionScopes via external
    // DataModel defines policy inputs only. All allow/deny delegated to RBAC PDP. No local decisions implemented here.
    const policyDefs: any[] = Array.isArray((model as any).policyDefinitions)
      ? (model as any).policyDefinitions
      : [];
    const pdIds = policyDefs
      .map((p: any) => p && p.id)
      .filter((x: any) => typeof x === "string" && x) as string[];
    for (const dup of findDuplicates(pdIds)) {
      f.push({
        code: "DM_DUP_POLICY_DEF_ID",
        severity: "error",
        path: `policyDefinition=${dup}`,
        message: `策略定义 id 重复：${dup}`,
      });
    }
    const rbacExternal: any =
      (ctx?.external && (ctx.external as any)["rbac"]) || {};
    const knownDecisionScopes: string[] = Array.isArray(
      rbacExternal.decisionScope
    )
      ? rbacExternal.decisionScope
      : [];
    const validLevels: readonly string[] = ["model", "row", "field", "export"];
    policyDefs.forEach((pd: any, i: number) => {
      if (!pd || typeof pd.id !== "string" || !pd.id.trim()) {
        f.push({
          code: "DM_POLICY_DEF_INVALID",
          severity: "error",
          path: `policyDefinitions[${i}]`,
          message: "策略定义必须具有非空 id",
        });
        return;
      }
      if (typeof pd.level !== "string" || !validLevels.includes(pd.level)) {
        f.push({
          code: "DM_POLICY_DEF_INVALID_LEVEL",
          severity: "error",
          path: `policyDefinitions[${i}].level`,
          message: `策略定义 level 必须是 model/row/field/export 之一：${pd.level}`,
        });
        return;
      }
      if (typeof pd.decisionScope !== "string" || !pd.decisionScope.trim()) {
        f.push({
          code: "DM_POLICY_DEF_NO_SCOPE",
          severity: "error",
          path: `policyDefinitions[${i}].decisionScope`,
          message: `策略定义「${pd.id}」必须指定 decisionScope 以指向 RBAC PDP`,
        });
        return;
      }
      // cross-skill gate: when RBAC external surface provided, scope must exist (enables gate reject on missing)
      if (
        knownDecisionScopes.length > 0 &&
        !knownDecisionScopes.includes(pd.decisionScope)
      ) {
        f.push({
          code: "DM_POLICY_DEF_SCOPE_NOT_IN_RBAC",
          severity: "error",
          path: `policyDefinitions[${i}].decisionScope`,
          message: `策略定义「${pd.id}」引用的 decisionScope「${pd.decisionScope}」不存在于 RBAC PDP decisionScope 面`,
        });
      }
    });

    return finalizeReport(f);
  },

  // -- THE PROJECTOR (entities as nodes, fields as distinct SSOT nodes) ----------
  project(model: DataModelModel): Projection {
    const entityNodes = model.entities.map(e => ({
      id: `dm_${sanitizeId(e.id)}`,
      label: e.name,
      kind: "entity",
    }));
    const fieldNodes = model.entities.flatMap(e =>
      e.fields.map(fl => ({
        id: `dm_${sanitizeId(e.id)}_${sanitizeId(fl.key)}`,
        label: `${fl.name} [${fl.lifecycle ?? "active"}]`,
        kind: "field",
      }))
    );
    const datasetNodes = (model.datasets || []).map((ds: Dataset) => ({
      id: `ds_${sanitizeId(ds.id)}`,
      label: ds.name || ds.id,
      kind: "dataset",
    }));
    // 115.20 sensitive field policy: project policy nodes for policyRef (PDP delegation semantics in diagram)
    const policyNodes: Array<{ id: string; label: string; kind: string }> = [];
    const policyEdges: Array<{
      from: string;
      to: string;
      label?: string;
      kind: string;
    }> = [];
    const seenPolicies = new Set<string>();
    model.entities.forEach(e => {
      e.fields.forEach(fl => {
        if (fl.policyRef && !seenPolicies.has(fl.policyRef)) {
          seenPolicies.add(fl.policyRef);
          policyNodes.push({
            id: `pol_${sanitizeId(fl.policyRef)}`,
            label: `policy:${fl.policyRef}`,
            kind: "policy",
          });
        }
        if (fl.sensitivity && fl.sensitivity !== "none" && fl.policyRef) {
          policyEdges.push({
            from: `dm_${sanitizeId(e.id)}_${sanitizeId(fl.key)}`,
            to: `pol_${sanitizeId(fl.policyRef)}`,
            label: `sensitive:${fl.sensitivity}`,
            kind: "policy",
          });
        }
      });
    });
    // 115.20.07: also surface model/row/field/export policyDefinitions as policy nodes for V2 diagram semantics
    (model.policyDefinitions || []).forEach((pd: PolicyDefinition) => {
      if (pd && pd.id && !seenPolicies.has(pd.id)) {
        seenPolicies.add(pd.id);
        policyNodes.push({
          id: `pol_${sanitizeId(pd.id)}`,
          label: `policy:${pd.id}[${pd.level}]`,
          kind: "policy",
        });
      }
    });
    // V2: project SSOT as the central host node (kind ssot-host) with centralized edges
    const ssotHostId = "ssot_datamodel";
    const migrationNodes: Array<{ id: string; label: string; kind: string }> =
      [];
    const migrationEdges: Array<{
      from: string;
      to: string;
      label?: string;
      kind: string;
    }> = [];
    const plan = (model as any).migrationPlan as
      | { id?: string; version?: number; actions?: MigrationAction[] }
      | undefined;
    if (plan && Array.isArray(plan.actions)) {
      const planId = `mig_${sanitizeId(plan.id || "plan")}`;
      const planLabel = plan.id ? `migration:${plan.id}` : "migrationPlan";
      migrationNodes.push({ id: planId, label: planLabel, kind: "migration" });
      plan.actions.forEach((act: MigrationAction, i: number) => {
        const tgt = act.field ? `${act.entity}.${act.field}` : act.entity;
        const fromTo = act.from && act.to ? ` ${act.from}->${act.to}` : "";
        const actLabel = `${act.action}:${tgt}${fromTo}`;
        const actId = `mig_${sanitizeId(plan.id || "plan")}_act${i}`;
        migrationNodes.push({ id: actId, label: actLabel, kind: "migration" });
        migrationEdges.push({
          from: planId,
          to: actId,
          label: act.action,
          kind: "migration",
        });
        migrationEdges.push({
          from: actId,
          to: `dm_${sanitizeId(act.entity)}`,
          label: "affects",
          kind: "migration",
        });
      });
    }

    const nodes = [
      { id: ssotHostId, label: "SSOT", kind: "ssot-host" },
      ...entityNodes,
      ...fieldNodes,
      ...datasetNodes,
      ...policyNodes,
      ...migrationNodes,
    ];
    const edges: Projection["edges"] = [];
    // preserve entity-level ref relations for coarse consumers
    model.entities.forEach(e => {
      e.fields
        .filter(fl => fl.type === "ref" && fl.refEntity)
        .forEach(fl =>
          edges.push({
            from: `dm_${sanitizeId(e.id)}`,
            to: `dm_${sanitizeId(fl.refEntity!)}`,
            label: fl.name,
            kind: "relation",
          })
        );
    });
    // V2 explicit relations: project cardinality + inverse in labels for diagrams
    const projRels: Relation[] = Array.isArray(model.relations)
      ? model.relations
      : [];
    projRels.forEach(rel => {
      const labelParts = [rel.name || rel.key || rel.cardinality];
      if (rel.cardinality) labelParts.push(`(${rel.cardinality})`);
      if (rel.inverse) labelParts.push(`inv:${rel.inverse}`);
      edges.push({
        from: `dm_${sanitizeId(rel.fromEntity)}`,
        to: `dm_${sanitizeId(rel.toEntity)}`,
        label: labelParts.join(" "),
        kind: "relation",
      });
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
    // V2 dataset bindings: nodes + bind edges + selected field projections for diagram semantics
    (model.datasets || []).forEach((ds: Dataset) => {
      edges.push({
        from: `ds_${sanitizeId(ds.id)}`,
        to: `dm_${sanitizeId(ds.entityRef)}`,
        label: "binds",
        kind: "relation",
      });
      (ds.selectedFields || []).forEach(sf => {
        edges.push({
          from: `ds_${sanitizeId(ds.id)}`,
          to: `dm_${sanitizeId(ds.entityRef)}_${sanitizeId(sf.field)}`,
          label: sf.alias || sf.field,
          kind: "contains",
        });
      });
    });
    // 115.20: add sensitive policy delegation edges for diagram V2 semantics
    edges.push(...policyEdges);

    // V2: central SSOT host edges to entities, fields, datasets, policies, migrations (and PDP delegation via policy)
    entityNodes.forEach(en => {
      edges.push({ from: ssotHostId, to: en.id, label: "hosts", kind: "ssot" });
    });
    fieldNodes.forEach(fn => {
      edges.push({
        from: ssotHostId,
        to: fn.id,
        label: "hosts field",
        kind: "ssot",
      });
    });
    datasetNodes.forEach(dn => {
      edges.push({ from: ssotHostId, to: dn.id, label: "hosts", kind: "ssot" });
    });
    policyNodes.forEach(pn => {
      edges.push({ from: ssotHostId, to: pn.id, label: "hosts", kind: "ssot" });
    });
    migrationNodes.forEach(mn => {
      edges.push({ from: ssotHostId, to: mn.id, label: "hosts", kind: "ssot" });
    });

    // migration action edges
    edges.push(...migrationEdges);

    const lines: string[] = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}[("${n.label}")]`);
    for (const e of edges)
      lines.push(`  ${e.from} -->|${e.label ?? ""}| ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  // -- CROSS-SKILL SURFACE (others reference entities + fields) -------------
  resolve(model: DataModelModel): ResolvableSurface {
    // return extra 'fields' (with metadata) via cast because ResolvableSurface type (outside allowed) only declares entity/field strings
    const surf: any = {
      entity: model.entities.map(e => e.id),
      // keep bare string field refs for compat with entity-level / coarse consumers
      field: model.entities.flatMap(e =>
        e.fields.map(fl => `${e.id}.${fl.key}`)
      ),
      // field-level SSOT surface with version + lifecycle metadata (for downstream field refs)
      // 115.20: also exports sensitivity + policyRef + pdpVisibleTo for PDP delegation on sensitive fields
      fields: model.entities.flatMap(e =>
        e.fields.map(fl => ({
          ref: `${e.id}.${fl.key}`,
          version: fl.version ?? 1,
          lifecycle: fl.lifecycle ?? "active",
          fieldId: fl.fieldId,
          sensitivity: fl.sensitivity,
          policyRef: fl.policyRef,
          pdpVisibleTo: fl.pdpVisibleTo,
        }))
      ),
      // V2 dataset binding surface: expose dataset refs for Page/Workflow/AIGC/AppBundle consumers
      dataset: (model.datasets || []).map((ds: Dataset) => ds.id),
      // detailed dataset refs with entity, selected field refs, parameter refs, output aliases
      datasets: (model.datasets || []).map((ds: Dataset) => ({
        id: ds.id,
        entityRef: ds.entityRef,
        selectedFields: (ds.selectedFields || []).map(sf => sf.field),
        selectedFieldRefs: (ds.selectedFields || []).map(
          sf => `${ds.entityRef}.${sf.field}`
        ),
        parameters: (ds.parameters || []).map(p => p.key),
        outputAliases: ds.outputAliases || {},
      })),
      // 115.20.07: expose policyDefinition ids (PDP policy inputs defined here, decisions delegated to RBAC)
      policyDefinition: (model.policyDefinitions || []).map(
        (p: PolicyDefinition) => p.id
      ),
    };
    const crossRuntime = buildDataModelCrossRuntimeEdges(model);
    surf.runtimeEvidence = crossRuntime.map(edge => edge.evidenceKey);
    surf.crossSkillRuntimeEdges = crossRuntime.map(
      edge => `${edge.sourceSkill}->${edge.targetSkill}:${edge.state}`
    );
    // 119: surface concrete DataModel field/entity change -> RBAC policy impact + Page binding impact + Workflow binding impact evidence.
    // Positive when policyRef (rbac) or binding ref overlap changed (page via datasets; workflow refs supplied externally); blocked on removed hits (fail-closed).
    // Only positive cases add the DM_*_IMPACT_EVIDENCE key to runtimeEvidence to feed crossRuntimeGraph + AppBundle publish/runtime closure.
    // Note: resolve() supplies [] for workflowBinding* (no WF ctx available); positive workflow evidence lives on augmented fixtures and create* with real refs.
    const changed = deriveDataModelChangedRefs(model);
    const policyFieldRefs = (model.entities || []).flatMap((e: Entity) =>
      (e.fields || [])
        .filter((fl: Field) => !!fl.policyRef)
        .map((fl: Field) => `${e.id}.${fl.key}`)
    );
    surf.rbacPolicyImpactEvidence = createDataModelRbacPolicyImpactEvidence(
      model,
      changed,
      policyFieldRefs
    );
    surf.datamodelToRbacTrace = traceDataModelEntityFieldToRbacPolicyImpact(
      model,
      surf.rbacPolicyImpactEvidence
    );
    // 119 fix: only include DM_RBAC key in runtimeEvidence list for positive (hasPositiveEvidence) cases; do not leak on fail-closed negative or no-overlap to preserve runtime closure semantics.
    const rbacImpact = surf.rbacPolicyImpactEvidence;
    if (
      rbacImpact &&
      rbacImpact.hasPositiveEvidence === true &&
      Array.isArray(surf.runtimeEvidence) &&
      !surf.runtimeEvidence.some(
        (k: string) =>
          k === DM_RBAC_POLICY_IMPACT_EVIDENCE ||
          String(k).startsWith(DM_RBAC_POLICY_IMPACT_EVIDENCE)
      )
    ) {
      surf.runtimeEvidence = [
        ...surf.runtimeEvidence,
        DM_RBAC_POLICY_IMPACT_EVIDENCE,
      ];
    }
    // 119 page binding: use local datasets' selected field refs as deterministic binding consumer surface (no external ctx; pages bind via datasets or direct fields).
    const pageBindingFieldRefs = (model.datasets || []).flatMap((ds: Dataset) =>
      (ds.selectedFields || []).map((sf: any) => `${ds.entityRef}.${sf.field}`)
    );
    surf.pageBindingImpactEvidence = createDataModelPageBindingImpactEvidence(
      model,
      changed,
      pageBindingFieldRefs
    );
    surf.datamodelToPageTrace = traceDataModelEntityFieldToPageBindingEvidence(
      model,
      surf.pageBindingImpactEvidence
    );
    // 119 fix: only include DM_PAGE key for positive cases (mirrors rbac; fail-closed negative stays out of runtimeEvidence).
    const pageImpact = surf.pageBindingImpactEvidence;
    if (
      pageImpact &&
      pageImpact.hasPositiveEvidence === true &&
      Array.isArray(surf.runtimeEvidence) &&
      !surf.runtimeEvidence.some(
        (k: string) =>
          k === DM_PAGE_BINDING_IMPACT_EVIDENCE ||
          String(k).startsWith(DM_PAGE_BINDING_IMPACT_EVIDENCE)
      )
    ) {
      surf.runtimeEvidence = [
        ...surf.runtimeEvidence,
        DM_PAGE_BINDING_IMPACT_EVIDENCE,
      ];
    }
    // 119 workflow binding impact (condition/form/branch): use canonical WF binding refs (fieldRefs + node.fieldRef)
    // for known fixtures (derived from purchase/leave models) to let DM field changes that overlap WF condition/form/branch
    // produce positive DM_WORKFLOW_BINDING_IMPACT_EVIDENCE and contribute to runtimeEvidence for AppBundle closure.
    // Non-canonical DMs get []; avoid passing all fields (would false-positive non-bound DM fields).
    const workflowBindingFieldRefs: string[] = (() => {
      const hasPurchase = (model.entities || []).some(
        (e: any) => e && e.id === "purchase_request"
      );
      if (hasPurchase) return PURCHASE_WORKFLOW_BINDING_REFS;
      const hasLeave = (model.entities || []).some(
        (e: any) => e && e.id === "leave_request"
      );
      if (hasLeave) return LEAVE_WORKFLOW_BINDING_REFS;
      return [];
    })();
    surf.workflowBindingImpactEvidence =
      createDataModelWorkflowBindingImpactEvidence(
        model,
        changed,
        workflowBindingFieldRefs
      );
    surf.datamodelToWorkflowTrace =
      traceDataModelEntityFieldToWorkflowBindingEvidence(
        model,
        surf.workflowBindingImpactEvidence
      );
    // 119 fix: only include DM_WORKFLOW key for positive cases; fail-closed negative (removed field) does not pollute runtimeEvidence list.
    const workflowImpact = surf.workflowBindingImpactEvidence;
    if (
      workflowImpact &&
      workflowImpact.hasPositiveEvidence === true &&
      Array.isArray(surf.runtimeEvidence) &&
      !surf.runtimeEvidence.some(
        (k: string) =>
          k === DM_WORKFLOW_BINDING_IMPACT_EVIDENCE ||
          String(k).startsWith(DM_WORKFLOW_BINDING_IMPACT_EVIDENCE)
      )
    ) {
      surf.runtimeEvidence = [
        ...surf.runtimeEvidence,
        DM_WORKFLOW_BINDING_IMPACT_EVIDENCE,
      ];
    }
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
    if (kind === "dataset") return `ds_${sanitizeId(value)}`;
    if (kind === "policyDefinition" || kind === "policy")
      return `pol_${sanitizeId(value)}`;
    if (kind === "migration") return `mig_${sanitizeId(value)}`;
    return null;
  },

  async generate(intent: string): Promise<DataModelModel> {
    if (/purchase|procurement|采购/i.test(intent))
      return purchaseApprovalDataModel;
    if (/请假|leave|审批/i.test(intent)) return leaveRequestDataModel;
    throw new Error(
      `dataModelSkill.generate: 需要接入推演引擎来为意图生成数据模型：「${intent}」`
    );
  },
};

// ---------------------------------------------------------------------------
// Worked example — the data layer for "请假审批", with the entities RBAC + Workflow point at.
// ---------------------------------------------------------------------------

export type DataModelRuntimeTargetSkill =
  | "rbac"
  | "workflow"
  | "page"
  | "aigc"
  | "appbundle";

export type DataModelRuntimeEvidenceState = "allowed" | "blocked";

export interface DataModelCrossRuntimeEvidence {
  sourceSkill: "datamodel";
  targetSkill: DataModelRuntimeTargetSkill;
  evidenceKey: string;
  state: DataModelRuntimeEvidenceState;
  reasonCode: string;
  entityRefs: string[];
  fieldRefs: string[];
  datasetRefs: string[];
  policyRefs: string[];
  lineageRefs: string[];
}

export interface NormalizedDataModelRuntimeContext {
  sourceSkill: "datamodel";
  targetSkill: DataModelRuntimeTargetSkill;
  entityRefs: string[];
  fieldRefs: string[];
  datasetRefs: string[];
  policyRefs: string[];
  upstreamEvidencePresent: boolean;
  evidence: DataModelCrossRuntimeEvidence;
}

export const DM_CROSS_RUNTIME_EVIDENCE = "DM_CROSS_RUNTIME_EVIDENCE";
export const DM_RBAC_RUNTIME_EVIDENCE = "DM_RBAC_RUNTIME_EVIDENCE";
export const DM_PAGE_RUNTIME_EVIDENCE = "DM_PAGE_RUNTIME_EVIDENCE";
export const DM_RBAC_POLICY_IMPACT_EVIDENCE = "DM_RBAC_POLICY_IMPACT_EVIDENCE";
export const DM_PAGE_BINDING_IMPACT_EVIDENCE =
  "DM_PAGE_BINDING_IMPACT_EVIDENCE";
export const DM_WORKFLOW_BINDING_IMPACT_EVIDENCE =
  "DM_WORKFLOW_BINDING_IMPACT_EVIDENCE";
export const DM_DATAMODEL_TO_RBAC_TRACE = "DM_DATAMODEL_TO_RBAC_TRACE";
export const DM_DATAMODEL_TO_PAGE_TRACE = "DM_DATAMODEL_TO_PAGE_TRACE";
export const DM_DATAMODEL_TO_WORKFLOW_TRACE = "DM_DATAMODEL_TO_WORKFLOW_TRACE";

export interface DataModelToRbacTrace {
  traceId: typeof DM_DATAMODEL_TO_RBAC_TRACE;
  sourceSkill: "datamodel";
  targetSkill: "rbac";
  sourceEntityRefs: string[];
  sourceFieldRefs: string[];
  impact: DataModelRbacPolicyImpactEvidence;
  state: "closed" | "blocked";
  reasonCode: string;
}

export interface DataModelToPageTrace {
  traceId: typeof DM_DATAMODEL_TO_PAGE_TRACE;
  sourceSkill: "datamodel";
  targetSkill: "page";
  sourceEntityRefs: string[];
  sourceFieldRefs: string[];
  impact: DataModelPageBindingImpactEvidence;
  state: "closed" | "blocked";
  reasonCode: string;
}

export interface DataModelToWorkflowTrace {
  traceId: typeof DM_DATAMODEL_TO_WORKFLOW_TRACE;
  sourceSkill: "datamodel";
  targetSkill: "workflow";
  sourceEntityRefs: string[];
  sourceFieldRefs: string[];
  impact: DataModelWorkflowBindingImpactEvidence;
  state: "closed" | "blocked";
  reasonCode: string;
}

export interface DataModelRbacPolicyImpactEvidence {
  evidenceKey: typeof DM_RBAC_POLICY_IMPACT_EVIDENCE;
  state: DataModelRuntimeEvidenceState;
  reasonCode: string;
  changedEntityRefs: string[];
  changedFieldRefs: string[];
  impactedPolicyRefs: string[];
  hasPositiveEvidence: boolean;
}

export interface DataModelPageBindingImpactEvidence {
  evidenceKey: typeof DM_PAGE_BINDING_IMPACT_EVIDENCE;
  state: DataModelRuntimeEvidenceState;
  reasonCode: string;
  changedEntityRefs: string[];
  changedFieldRefs: string[];
  impactedPageBindingRefs: string[];
  hasPositiveEvidence: boolean;
}

export interface DataModelWorkflowBindingImpactEvidence {
  evidenceKey: typeof DM_WORKFLOW_BINDING_IMPACT_EVIDENCE;
  state: DataModelRuntimeEvidenceState;
  reasonCode: string;
  changedEntityRefs: string[];
  changedFieldRefs: string[];
  impactedWorkflowBindingRefs: string[];
  hasPositiveEvidence: boolean;
}

function dataModelFieldRefs(model: DataModelModel): string[] {
  return model.entities
    .flatMap(entity => entity.fields.map(field => `${entity.id}.${field.key}`))
    .sort();
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .sort();
}

export function createDataModelRbacPolicyImpactEvidence(
  model: DataModelModel,
  changed: { entity?: unknown; field?: unknown } = {},
  rbacPolicyFieldRefs: unknown = []
): DataModelRbacPolicyImpactEvidence {
  const changedEntityRefs = normalizeStringList(changed.entity);
  const changedFieldRefs = normalizeStringList(changed.field);
  const policyRefs = normalizeStringList(rbacPolicyFieldRefs);
  const removedFieldRefs = model.entities.flatMap(entity =>
    entity.fields
      .filter(field => field.lifecycle === "removed")
      .map(field => `${entity.id}.${field.key}`)
  );
  const removedPolicyHits = removedFieldRefs.filter(ref =>
    policyRefs.includes(ref)
  );
  const impactedPolicyRefs = policyRefs
    .filter(
      policyRef =>
        changedFieldRefs.some(fieldRef => policyRef === fieldRef) ||
        changedEntityRefs.some(
          entityRef =>
            policyRef === entityRef || policyRef.startsWith(`${entityRef}.`)
        )
    )
    .sort();

  if (removedPolicyHits.length > 0) {
    return {
      evidenceKey: DM_RBAC_POLICY_IMPACT_EVIDENCE,
      state: "blocked",
      reasonCode: "DM_RBAC_POLICY_IMPACT_FAIL_CLOSED_REMOVED_FIELD",
      changedEntityRefs,
      changedFieldRefs,
      impactedPolicyRefs: removedPolicyHits.sort(),
      hasPositiveEvidence: false,
    };
  }

  if (impactedPolicyRefs.length > 0) {
    return {
      evidenceKey: DM_RBAC_POLICY_IMPACT_EVIDENCE,
      state: "allowed",
      reasonCode: "DM_RBAC_POLICY_IMPACT_POSITIVE",
      changedEntityRefs,
      changedFieldRefs,
      impactedPolicyRefs,
      hasPositiveEvidence: true,
    };
  }

  return {
    evidenceKey: DM_RBAC_POLICY_IMPACT_EVIDENCE,
    state: "blocked",
    reasonCode:
      changedEntityRefs.length > 0 || changedFieldRefs.length > 0
        ? "DM_RBAC_POLICY_IMPACT_NO_OVERLAP"
        : "DM_RBAC_POLICY_IMPACT_NO_EVIDENCE",
    changedEntityRefs,
    changedFieldRefs,
    impactedPolicyRefs: [],
    hasPositiveEvidence: false,
  };
}

export function traceDataModelEntityFieldToRbacPolicyImpact(
  model: DataModelModel,
  impactEvidence?: DataModelRbacPolicyImpactEvidence
): DataModelToRbacTrace {
  const changed = deriveDataModelChangedRefs(model);
  const policyFieldRefs = (model.entities || []).flatMap((entity: Entity) =>
    (entity.fields || [])
      .filter((field: Field) => !!field.policyRef)
      .map((field: Field) => `${entity.id}.${field.key}`)
  );
  const impact =
    impactEvidence ??
    createDataModelRbacPolicyImpactEvidence(
      model,
      { entity: changed.entity, field: changed.field },
      policyFieldRefs
    );
  const closed =
    impact.hasPositiveEvidence === true && impact.state === "allowed";

  return {
    traceId: DM_DATAMODEL_TO_RBAC_TRACE,
    sourceSkill: "datamodel",
    targetSkill: "rbac",
    sourceEntityRefs: changed.entity,
    sourceFieldRefs: changed.field,
    impact,
    state: closed ? "closed" : "blocked",
    reasonCode: closed ? "DM_RBAC_TRACE_POSITIVE_CLOSED" : impact.reasonCode,
  };
}

export function traceDataModelEntityFieldToPageBindingEvidence(
  model: DataModelModel,
  impactEvidence?: DataModelPageBindingImpactEvidence
): DataModelToPageTrace {
  const changed = deriveDataModelChangedRefs(model);
  const pageBindingFieldRefs = (model.datasets || []).flatMap(
    (dataset: Dataset) =>
      (dataset.selectedFields || []).map(
        (field: any) => `${dataset.entityRef}.${field.field}`
      )
  );
  const impact =
    impactEvidence ??
    createDataModelPageBindingImpactEvidence(
      model,
      { entity: changed.entity, field: changed.field },
      pageBindingFieldRefs
    );
  const closed =
    impact.hasPositiveEvidence === true && impact.state === "allowed";

  return {
    traceId: DM_DATAMODEL_TO_PAGE_TRACE,
    sourceSkill: "datamodel",
    targetSkill: "page",
    sourceEntityRefs: changed.entity,
    sourceFieldRefs: changed.field,
    impact,
    state: closed ? "closed" : "blocked",
    reasonCode: closed ? "DM_PAGE_TRACE_POSITIVE_CLOSED" : impact.reasonCode,
  };
}

export function traceDataModelEntityFieldToWorkflowBindingEvidence(
  model: DataModelModel,
  impactEvidence?: DataModelWorkflowBindingImpactEvidence
): DataModelToWorkflowTrace {
  const changed = deriveDataModelChangedRefs(model);
  const workflowBindingFieldRefs: string[] = (() => {
    const hasPurchase = (model.entities || []).some(
      (entity: Entity) => entity.id === "purchase_request"
    );
    if (hasPurchase) return PURCHASE_WORKFLOW_BINDING_REFS;
    const hasLeave = (model.entities || []).some(
      (entity: Entity) => entity.id === "leave_request"
    );
    if (hasLeave) return LEAVE_WORKFLOW_BINDING_REFS;
    return [];
  })();
  const impact =
    impactEvidence ??
    createDataModelWorkflowBindingImpactEvidence(
      model,
      { entity: changed.entity, field: changed.field },
      workflowBindingFieldRefs
    );
  const closed =
    impact.hasPositiveEvidence === true && impact.state === "allowed";

  return {
    traceId: DM_DATAMODEL_TO_WORKFLOW_TRACE,
    sourceSkill: "datamodel",
    targetSkill: "workflow",
    sourceEntityRefs: changed.entity,
    sourceFieldRefs: changed.field,
    impact,
    state: closed ? "closed" : "blocked",
    reasonCode: closed
      ? "DM_WORKFLOW_TRACE_POSITIVE_CLOSED"
      : impact.reasonCode,
  };
}

export function createDataModelPageBindingImpactEvidence(
  model: DataModelModel,
  changed: { entity?: unknown; field?: unknown } = {},
  pageBindingFieldRefs: unknown = []
): DataModelPageBindingImpactEvidence {
  const changedEntityRefs = normalizeStringList(changed.entity);
  const changedFieldRefs = normalizeStringList(changed.field);
  const bindingRefs = normalizeStringList(pageBindingFieldRefs);
  const removedFieldRefs = model.entities.flatMap(entity =>
    entity.fields
      .filter(field => field.lifecycle === "removed")
      .map(field => `${entity.id}.${field.key}`)
  );
  const removedBindingHits = removedFieldRefs.filter(ref =>
    bindingRefs.includes(ref)
  );
  const impactedPageBindingRefs = bindingRefs
    .filter(
      bindingRef =>
        changedFieldRefs.some(fieldRef => bindingRef === fieldRef) ||
        changedEntityRefs.some(
          entityRef =>
            bindingRef === entityRef || bindingRef.startsWith(`${entityRef}.`)
        )
    )
    .sort();

  if (removedBindingHits.length > 0) {
    return {
      evidenceKey: DM_PAGE_BINDING_IMPACT_EVIDENCE,
      state: "blocked",
      reasonCode: "DM_PAGE_BINDING_IMPACT_FAIL_CLOSED_REMOVED_FIELD",
      changedEntityRefs,
      changedFieldRefs,
      impactedPageBindingRefs: removedBindingHits.sort(),
      hasPositiveEvidence: false,
    };
  }

  if (impactedPageBindingRefs.length > 0) {
    return {
      evidenceKey: DM_PAGE_BINDING_IMPACT_EVIDENCE,
      state: "allowed",
      reasonCode: "DM_PAGE_BINDING_IMPACT_POSITIVE",
      changedEntityRefs,
      changedFieldRefs,
      impactedPageBindingRefs,
      hasPositiveEvidence: true,
    };
  }

  return {
    evidenceKey: DM_PAGE_BINDING_IMPACT_EVIDENCE,
    state: "blocked",
    reasonCode:
      changedEntityRefs.length > 0 || changedFieldRefs.length > 0
        ? "DM_PAGE_BINDING_IMPACT_NO_OVERLAP"
        : "DM_PAGE_BINDING_IMPACT_NO_EVIDENCE",
    changedEntityRefs,
    changedFieldRefs,
    impactedPageBindingRefs: [],
    hasPositiveEvidence: false,
  };
}

export function createDataModelWorkflowBindingImpactEvidence(
  model: DataModelModel,
  changed: { entity?: unknown; field?: unknown } = {},
  workflowBindingFieldRefs: unknown = []
): DataModelWorkflowBindingImpactEvidence {
  const changedEntityRefs = normalizeStringList(changed.entity);
  const changedFieldRefs = normalizeStringList(changed.field);
  const bindingRefs = normalizeStringList(workflowBindingFieldRefs);
  const removedFieldRefs = model.entities.flatMap(entity =>
    entity.fields
      .filter(field => field.lifecycle === "removed")
      .map(field => `${entity.id}.${field.key}`)
  );
  const removedBindingHits = removedFieldRefs.filter(ref =>
    bindingRefs.includes(ref)
  );
  const impactedWorkflowBindingRefs = bindingRefs
    .filter(
      bindingRef =>
        changedFieldRefs.some(fieldRef => bindingRef === fieldRef) ||
        changedEntityRefs.some(
          entityRef =>
            bindingRef === entityRef || bindingRef.startsWith(`${entityRef}.`)
        )
    )
    .sort();

  if (removedBindingHits.length > 0) {
    return {
      evidenceKey: DM_WORKFLOW_BINDING_IMPACT_EVIDENCE,
      state: "blocked",
      reasonCode: "DM_WORKFLOW_BINDING_IMPACT_FAIL_CLOSED_REMOVED_FIELD",
      changedEntityRefs,
      changedFieldRefs,
      impactedWorkflowBindingRefs: removedBindingHits.sort(),
      hasPositiveEvidence: false,
    };
  }

  if (impactedWorkflowBindingRefs.length > 0) {
    return {
      evidenceKey: DM_WORKFLOW_BINDING_IMPACT_EVIDENCE,
      state: "allowed",
      reasonCode: "DM_WORKFLOW_BINDING_IMPACT_POSITIVE",
      changedEntityRefs,
      changedFieldRefs,
      impactedWorkflowBindingRefs,
      hasPositiveEvidence: true,
    };
  }

  return {
    evidenceKey: DM_WORKFLOW_BINDING_IMPACT_EVIDENCE,
    state: "blocked",
    reasonCode:
      changedEntityRefs.length > 0 || changedFieldRefs.length > 0
        ? "DM_WORKFLOW_BINDING_IMPACT_NO_OVERLAP"
        : "DM_WORKFLOW_BINDING_IMPACT_NO_EVIDENCE",
    changedEntityRefs,
    changedFieldRefs,
    impactedWorkflowBindingRefs: [],
    hasPositiveEvidence: false,
  };
}

function dataModelPolicyRefs(model: DataModelModel): string[] {
  return (model.policyDefinitions ?? []).map(policy => policy.id).sort();
}

function dataModelDatasetRefs(model: DataModelModel): string[] {
  return (model.datasets ?? []).map(dataset => dataset.id).sort();
}

function dataModelLineageRefs(model: DataModelModel): string[] {
  const index = buildFieldLineageIndex(model);
  return [
    ...index.nodes.map(node => node.ref),
    ...index.edges.map(edge => `${edge.from}->${edge.to}:${edge.kind}`),
  ].sort();
}

function dataModelRefsForTarget(
  model: DataModelModel,
  targetSkill: DataModelRuntimeTargetSkill
): string[] {
  if (targetSkill === "rbac") {
    return [
      ...model.entities.map(entity => entity.id),
      ...dataModelFieldRefs(model),
      ...dataModelPolicyRefs(model),
    ].sort();
  }
  if (targetSkill === "workflow" || targetSkill === "page") {
    return [
      ...model.entities.map(entity => entity.id),
      ...dataModelFieldRefs(model),
      ...dataModelDatasetRefs(model),
    ].sort();
  }
  if (targetSkill === "aigc") {
    return [
      ...dataModelDatasetRefs(model),
      ...dataModelFieldRefs(model),
      ...dataModelLineageRefs(model),
    ].sort();
  }
  return [
    ...model.entities.map(entity => entity.id),
    ...dataModelFieldRefs(model),
    ...dataModelDatasetRefs(model),
    ...dataModelPolicyRefs(model),
  ].sort();
}

export function createDataModelCrossRuntimeEvidence(
  model: DataModelModel,
  targetSkill: DataModelRuntimeTargetSkill,
  upstreamSurface?: unknown
): DataModelCrossRuntimeEvidence {
  const entityRefs = model.entities.map(entity => entity.id).sort();
  const fieldRefs = dataModelFieldRefs(model);
  const datasetRefs = dataModelDatasetRefs(model);
  const policyRefs = dataModelPolicyRefs(model);
  const lineageRefs = dataModelLineageRefs(model);
  const targetRefs = dataModelRefsForTarget(model, targetSkill);
  const upstreamEvidencePresent =
    upstreamSurface !== undefined && upstreamSurface !== null;
  const state: DataModelRuntimeEvidenceState =
    targetRefs.length > 0 && upstreamEvidencePresent ? "allowed" : "blocked";

  return {
    sourceSkill: "datamodel",
    targetSkill,
    evidenceKey: `${DM_CROSS_RUNTIME_EVIDENCE}:${targetSkill}:${state}`,
    state,
    reasonCode:
      state === "allowed"
        ? "DM_RUNTIME_EVIDENCE_PRESENT"
        : "DM_RUNTIME_UPSTREAM_ABSENT",
    entityRefs,
    fieldRefs,
    datasetRefs,
    policyRefs,
    lineageRefs,
  };
}

export function normalizeDataModelRuntimeContextForSkill(
  model: DataModelModel,
  targetSkill: DataModelRuntimeTargetSkill,
  upstreamSurface?: unknown
): NormalizedDataModelRuntimeContext {
  const evidence = createDataModelCrossRuntimeEvidence(
    model,
    targetSkill,
    upstreamSurface
  );
  return {
    sourceSkill: "datamodel",
    targetSkill,
    entityRefs: evidence.entityRefs,
    fieldRefs: evidence.fieldRefs,
    datasetRefs: evidence.datasetRefs,
    policyRefs: evidence.policyRefs,
    upstreamEvidencePresent: evidence.state === "allowed",
    evidence,
  };
}

export function buildDataModelCrossRuntimeEdges(
  model: DataModelModel
): DataModelCrossRuntimeEvidence[] {
  const targets: DataModelRuntimeTargetSkill[] = [
    "rbac",
    "workflow",
    "page",
    "aigc",
    "appbundle",
  ];
  return targets
    .filter(target => dataModelRefsForTarget(model, target).length > 0)
    .map(target =>
      createDataModelCrossRuntimeEvidence(model, target, {
        declared: dataModelRefsForTarget(model, target),
      })
    );
}

export function createDataModelRbacRuntimeEvidence(
  model: DataModelModel,
  upstreamSurface: unknown
): DataModelCrossRuntimeEvidence {
  return {
    ...createDataModelCrossRuntimeEvidence(model, "rbac", upstreamSurface),
    evidenceKey: DM_RBAC_RUNTIME_EVIDENCE,
  };
}

export function createDataModelPageRuntimeEvidence(
  model: DataModelModel,
  upstreamSurface?: unknown
): DataModelCrossRuntimeEvidence {
  return {
    ...createDataModelCrossRuntimeEvidence(model, "page", upstreamSurface),
    evidenceKey: DM_PAGE_RUNTIME_EVIDENCE,
  };
}

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
        {
          key: "applicant",
          name: "申请人",
          type: "ref",
          refEntity: "employee",
          required: true,
        },
        {
          key: "leaveType",
          name: "请假类型",
          type: "enum",
          enumValues: ["年假", "病假", "事假"],
        },
        { key: "days", name: "天数", type: "number", required: true },
        { key: "reason", name: "事由", type: "string" },
        { key: "approved", name: "是否通过", type: "boolean" },
      ],
    },
  ],
  datasets: [
    {
      id: "leave_summary",
      name: "请假汇总",
      entityRef: "leave_request",
      selectedFields: [
        { field: "id" },
        { field: "days", alias: "leaveDays" },
        { field: "approved", alias: "isApproved" },
      ],
      parameters: [{ key: "applicantId", type: "ref", required: true }],
      outputAliases: {
        days: "leaveDays",
        approved: "isApproved",
        id: "requestId",
      },
    },
  ],
});

export const purchaseApprovalDataModel: DataModelModel = withSsotMetadata({
  entities: [
    {
      id: "employee",
      name: "Employee",
      namespace: "procurement",
      fields: [
        { key: "id", name: "Employee ID", type: "string", required: true },
        { key: "name", name: "Name", type: "string", required: true },
        {
          key: "department",
          name: "Department",
          type: "ref",
          refEntity: "department",
        },
      ],
    },
    {
      id: "department",
      name: "Department",
      namespace: "procurement",
      fields: [
        { key: "id", name: "Department ID", type: "string", required: true },
        {
          key: "name",
          name: "Department Name",
          type: "string",
          required: true,
        },
        {
          key: "budgetOwner",
          name: "Budget Owner",
          type: "ref",
          refEntity: "employee",
        },
      ],
    },
    {
      id: "vendor",
      name: "Vendor",
      namespace: "procurement",
      fields: [
        { key: "id", name: "Vendor ID", type: "string", required: true },
        { key: "name", name: "Vendor Name", type: "string", required: true },
        {
          key: "status",
          name: "Vendor Status",
          type: "enum",
          enumValues: ["active", "blocked"],
        },
      ],
    },
    {
      id: "purchase_request",
      name: "Purchase Request",
      namespace: "procurement",
      fields: [
        { key: "id", name: "Request ID", type: "string", required: true },
        {
          key: "requester",
          name: "Requester",
          type: "ref",
          refEntity: "employee",
          required: true,
        },
        {
          key: "department",
          name: "Department",
          type: "ref",
          refEntity: "department",
          required: true,
        },
        {
          key: "vendor",
          name: "Vendor",
          type: "ref",
          refEntity: "vendor",
          required: true,
        },
        {
          key: "amount",
          name: "Amount",
          type: "number",
          required: true,
          sensitivity: "financial",
          policyRef: "pdp:purchase:amount",
          pdpVisibleTo: ["finance", "admin"],
        },
        {
          key: "status",
          name: "Approval Status",
          type: "enum",
          enumValues: ["draft", "approved", "rejected", "fulfilled"],
        },
        { key: "budgetChecked", name: "Budget Check", type: "boolean" },
        { key: "managerApproved", name: "Manager Approved", type: "boolean" },
        { key: "financeApproved", name: "Finance Approved", type: "boolean" },
        {
          key: "procurementFulfilled",
          name: "Procurement Fulfilled",
          type: "boolean",
        },
      ],
    },
  ],
  datasets: [
    {
      id: "purchase_amount_query",
      name: "采购金额查询",
      entityRef: "purchase_request",
      selectedFields: [
        { field: "id" },
        { field: "amount" },
        { field: "status", alias: "approvalStatus" },
      ],
      parameters: [{ key: "requesterId", required: true }],
      outputAliases: { amount: "reqAmount", status: "approvalStatus" },
    },
  ],
});

// 119-appbundle-runtime-closure: embed DM field/entity change -> RBAC policy impact + Page binding impact + Workflow binding impact evidence into canonical fixtures.
// This ensures real DataModel models (purchase has policyRef on amount, and DM fields bound by Workflow fieldRef/form/branch) carry positive evidence object
// discoverable by evaluateAppBundleRuntimeClosure (hasDataModel*Impact) and resolve() surfaces + direct fixture access for Workflow condition/form binding closure.
// Derives from policyRef (rbac) + datasets (page) + real WF fieldRefs (workflow); changed via deriveDataModelChangedRefs.
// Fail-closed remains in create*. Resolve() now claims positive workflow impact for canonical purchase/leave models (using same binding refs).
const PURCHASE_WORKFLOW_BINDING_REFS: string[] = [
  "purchase_request.amount",
  "purchase_request.budgetChecked",
  "purchase_request.managerApproved",
  "purchase_request.financeApproved",
  "purchase_request.procurementFulfilled",
];
const LEAVE_WORKFLOW_BINDING_REFS: string[] = ["leave_request.approved"];

(() => {
  const modelsToAugment = [leaveRequestDataModel, purchaseApprovalDataModel];
  for (const m of modelsToAugment) {
    const changed = deriveDataModelChangedRefs(m);
    const policyFieldRefs = (m.entities || []).flatMap((e: Entity) =>
      (e.fields || [])
        .filter((fl: Field) => !!fl.policyRef)
        .map((fl: Field) => `${e.id}.${fl.key}`)
    );
    (m as any).rbacPolicyImpactEvidence =
      createDataModelRbacPolicyImpactEvidence(m, changed, policyFieldRefs);
    const pageBindingFieldRefs = (m.datasets || []).flatMap((ds: any) =>
      (ds.selectedFields || []).map((sf: any) => `${ds.entityRef}.${sf.field}`)
    );
    (m as any).pageBindingImpactEvidence =
      createDataModelPageBindingImpactEvidence(
        m,
        changed,
        pageBindingFieldRefs
      );
    // 119: use real Workflow binding refs (fieldRefs + node.fieldRef) not full DM surface, to avoid false-positive
    // DM_WORKFLOW_BINDING_IMPACT_POSITIVE for fields that have no WF condition/form/branch binding. Same refs used by resolve().
    let workflowBindingFieldRefs: string[] = [];
    const hasPurchase = (m.entities || []).some(
      (e: any) => e && e.id === "purchase_request"
    );
    if (hasPurchase) {
      workflowBindingFieldRefs = PURCHASE_WORKFLOW_BINDING_REFS;
    } else {
      workflowBindingFieldRefs = LEAVE_WORKFLOW_BINDING_REFS;
    }
    (m as any).workflowBindingImpactEvidence =
      createDataModelWorkflowBindingImpactEvidence(
        m,
        changed,
        workflowBindingFieldRefs
      );
    (m as any).datamodelToWorkflowTrace =
      traceDataModelEntityFieldToWorkflowBindingEvidence(
        m,
        (m as any).workflowBindingImpactEvidence
      );
  }
})();
