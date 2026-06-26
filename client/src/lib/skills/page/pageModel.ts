// Page metamodel - distilled from the page designer layer. It stays runtime-less:
// no renderer, no database, only component binding + visibility + linkage rules.

export type ComponentType = "input" | "select" | "number" | "date" | "switch" | "table" | "button" | "text";

export type TriggerEvent = "onChange" | "onClick" | "onLoad";

export type LinkageAction = "setOptions" | "setVisible" | "setDisabled" | "setValue";

export interface PageComponent {
  id: string;
  type: ComponentType;
  label: string;
  /** Cross-skill DataModel field ref, e.g. leave_request.days. Kept for backward compatibility; prefer bindingSchema in V2. */
  field?: string;
  /** Cross-skill RBAC role refs controlling visibility. Kept for backward compatibility; prefer permissionRender in V2. */
  visibleToRoles?: string[];
  /** V2 PEP binding to DataModel SSOT. Page renders the field but does not own the data truth. */
  bindingSchema?: BindingSchema;
  /** V2 PEP permission delegation to RBAC PDP for visibility or action enablement. */
  permissionRender?: PermissionRender;
  /** Component version metadata for traceable page snapshots. */
  componentVersion?: string;
}

export interface LinkageRule {
  id: string;
  source: { component: string; event: TriggerEvent };
  target: { component: string; action: LinkageAction };
}

export interface BindingSchema {
  entity: string;
  /** DataModel SSOT field ref, e.g. leave_request.days. */
  field: string;
}

export interface PermissionRender {
  /** RBAC PDP role refs mapped from legacy visibleToRoles. */
  roleRefs: string[];
  /** Optional RBAC PDP permission refs for component actions. */
  permissionRefs?: string[];
}

export interface PageModel {
  id: string;
  name: string;
  /** Cross-skill DataModel entity ref. */
  entity: string;
  components: PageComponent[];
  linkageRules: LinkageRule[];
  /** V2 PEP trace span for the local rendering/linkage execution graph. */
  traceSpan?: string;
  /** Page-level component schema version for reproducible snapshots. */
  componentVersion?: string;
}
