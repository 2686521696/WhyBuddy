// DataModel metamodel — distilled from rbac-system-pc's data platform tables, runtime stripped:
//   data_models, data_model_fields, data_model_relations, and the dynamic dm_* tables.
// Pure data. This skill is the KEYSTONE: RBAC's data rules reference its entities, and
// Workflow/Page reference its fields — so wiring it in resolves their dangling cross-refs.

export type FieldType = "string" | "number" | "boolean" | "date" | "enum" | "ref";

/** Lifecycle for stable field/entity facts in SSOT. */
export type Lifecycle = "active" | "deprecated" | "removed";

/** Storage role: ssot for DataModel authoritative facts; olap_projection for derived/warehouse views (never SSOT). */
export type StorageRole = "ssot" | "olap_projection";

/** Sensitivity level for policy export and RBAC PDP delegation. "none" or absent = non-sensitive. */
export type SensitivityLevel = "none" | "low" | "medium" | "high" | "financial" | "pii";

export interface Field {
  key: string;
  name: string;
  type: FieldType;
  required?: boolean;
  /** enum field: allowed values. */
  enumValues?: string[];
  /** ref field: the entity id it points at (intra-skill relation, mirrors data_model_relations). */
  refEntity?: string;
  /** Stable field identity (SSOT): durable ID independent of key renames. */
  fieldId?: string;
  /** Field version for evolution. */
  version?: number;
  /** Lifecycle status. */
  lifecycle?: Lifecycle;
  /** Marks DataModel SSOT fields vs OLAP projections. Authoritative fields use "ssot". */
  storageRole?: StorageRole;
  /** Sensitivity level marking sensitive fields for export policy. */
  sensitivity?: SensitivityLevel;
  /** Policy/export ref delegated to RBAC PDP for final decision (not enforced here). */
  policyRef?: string;
  /** PDP delegation metadata: roles allowed visibility subject to PDP decision. */
  pdpVisibleTo?: string[];
}

export interface Entity {
  /** Stable id — THIS is what RBAC data rules (modelRef) and Workflow fields point at. */
  id: string;
  name: string;
  fields: Field[];
  /** Entity namespace/domain for cross-system disambiguation of same-named entities. */
  namespace?: string;
}

/** Supported relation cardinalities for entity graph integrity gate. */
export type RelationCardinality =
  | "one-to-one"
  | "one-to-many"
  | "many-to-one"
  | "many-to-many";

/** Explicit relation declaration for cardinality + inverse validation. */
export interface Relation {
  /** Relation identifier (used for inverse pairing). */
  key?: string;
  /** Source entity id. */
  fromEntity: string;
  /** Target entity id. */
  toEntity: string;
  cardinality: RelationCardinality;
  /** Human label or role name for the directed relation. */
  name?: string;
  /** Key of the inverse relation (must point back for match). */
  inverse?: string;
  /** Permit self-relations (fromEntity === toEntity); default false blocks them. */
  allowSelf?: boolean;
}

/** Migration action kinds per task: add, rename, deprecate, remove, type-change. */
export type MigrationActionType = "add" | "rename" | "deprecate" | "remove" | "type-change";

/** Single declared migration action with optional evidence ref. */
export interface MigrationAction {
  action: MigrationActionType;
  entity: string;
  field?: string;
  /** Previous key (rename) or previous type (type-change). */
  from?: string;
  /** Target key (rename) or target type (type-change). */
  to?: string;
  /** Explicit evidence (ticket/approval id) — required for destructive actions. */
  planRef?: string;
  description?: string;
}

/** Container for declared migration intent (runtime-less metadata only). */
export interface MigrationPlan {
  id?: string;
  /** Target model version this plan advances. */
  version?: number;
  actions: MigrationAction[];
}

/** Selected field within a dataset binding (validated against entity's fields). */
export interface DatasetSelectedField {
  /** field key on the bound entity */
  field: string;
  /** optional output alias for this selection (consumer field mapping) */
  alias?: string;
}

/** Declarative parameter for dataset query (no runtime semantics). */
export interface DatasetParameter {
  key: string;
  type?: FieldType;
  required?: boolean;
}

/** Dataset binding model: declares a query surface over an entity with field selections,
 *  parameters and output aliases. Enables Page/Workflow/AIGC/AppBundle to consume
 *  dataset+field mappings in a validated, resolvable way.
 */
export interface Dataset {
  id: string;
  name?: string;
  /** Entity id this dataset is bound to / queries. */
  entityRef: string;
  /** Selected fields; each must exist as key on the referenced entity. */
  selectedFields: DatasetSelectedField[];
  /** Parameter declarations for the dataset (pure metadata). */
  parameters?: DatasetParameter[];
  /** Output alias map: alias -> field key (for projected outputs / mapping). */
  outputAliases?: Record<string, string>;
}

/** Policy definition at a data granularity level (model/row/field/export). Serves as verifiable PDP policy input; decisionScope must resolve in RBAC PDP surface. */
export interface PolicyDefinition {
  /** Stable identifier for this policy input (used for projection/resolve and cross-skill refs). */
  id: string;
  /** Granularity level of the data policy. */
  level: "model" | "row" | "field" | "export";
  /** The RBAC PDP decision scope this definition points to for allow/deny resolution (delegated; e.g. "RBAC_DECISION_ALLOW"). */
  decisionScope: string;
  /** Optional label for diagram/docs. */
  name?: string;
}

export interface DataModelModel {
  entities: Entity[];
  /** Explicit relations (V2) supporting cardinality, inverse refs, and self-relation control.
   *  Ref fields remain for 114 compat; relations provide the cardinality gate surface.
   */
  relations?: Relation[];
  /** Optional migration plan expressing add/rename/deprecate/remove/type-change intent.
   *  Destructive (remove/type-change) require planRef; high-risk (deprecate/rename) warn without it.
   */
  migrationPlan?: MigrationPlan;
  /** V2 dataset bindings: dataset query + entity refs + selected field refs + parameter refs + output aliases.
   *  Dataset fields are validated against the bound entity's fields.
   */
  datasets?: Dataset[];
  /** PDP policy inputs defined by DataModel at model/row/field/export granularity.
   *  DataModel declares the policy definitions (as inputs); all allow/deny decisions are delegated to RBAC PDP's decisionScope.
   *  No local decisions are made inside DataModel.
   */
  policyDefinitions?: PolicyDefinition[];
}

/** Pure runtime field lineage index (V2 117): nodes + edges derived from entities/fields + datasets + policies + migrations + relations.
 *  Used for impact analysis and binding checks. Deterministic in-memory only.
 */
export interface FieldLineageNode {
  id: string;
  kind: "entity" | "field" | "dataset" | "policy" | "migration" | "relation";
  ref: string;
}

export interface FieldLineageEdge {
  from: string;
  to: string;
  kind: string;
  label?: string;
}

export interface FieldLineageIndex {
  nodes: FieldLineageNode[];
  edges: FieldLineageEdge[];
  /** canonical "entity.field" refs present in this model */
  fieldRefs: string[];
}
