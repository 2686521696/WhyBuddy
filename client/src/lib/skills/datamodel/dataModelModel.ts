// DataModel metamodel — distilled from rbac-system-pc's data platform tables, runtime stripped:
//   data_models, data_model_fields, data_model_relations, and the dynamic dm_* tables.
// Pure data. This skill is the KEYSTONE: RBAC's data rules reference its entities, and
// Workflow/Page reference its fields — so wiring it in resolves their dangling cross-refs.

export type FieldType = "string" | "number" | "boolean" | "date" | "enum" | "ref";

/** Lifecycle for stable field/entity facts in SSOT. */
export type Lifecycle = "active" | "deprecated" | "removed";

/** Storage role: ssot for DataModel authoritative facts; olap_projection for derived/warehouse views (never SSOT). */
export type StorageRole = "ssot" | "olap_projection";

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
}

export interface Entity {
  /** Stable id — THIS is what RBAC data rules (modelRef) and Workflow fields point at. */
  id: string;
  name: string;
  fields: Field[];
  /** Entity namespace/domain for cross-system disambiguation of same-named entities. */
  namespace?: string;
}

export interface DataModelModel {
  entities: Entity[];
}
