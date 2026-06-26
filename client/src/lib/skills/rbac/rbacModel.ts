// RBAC metamodel — distilled from rbac-system-pc's real tables, with the runtime stripped off:
//   roles, permissions, menus, departments, positions, users,
//   role_permissions, role_menus, user_roles, position_roles, user_departments,
//   data_rules / data_scope_configs / role_data_rules.
// Pure data. No ORM, no MySQL, no Redis. This is the "能力抽象化" layer.

export type MenuType = "directory" | "menu" | "button";

/** Row-level data scope, mirrors data_scope_configs.scope_type. */
export type DataScope = "all" | "self" | "dept" | "dept_and_sub" | "custom";

export interface Permission {
  /** Unique code, e.g. "leave:approve". The atom roles are granted. */
  code: string;
  name: string;
  resource: string; // e.g. "leave_request"
  action: string; // e.g. "approve"
}

export interface Menu {
  id: string;
  parentId: string | null;
  name: string;
  type: MenuType;
  /** menu/button entries are guarded by this permission; directories usually are not. */
  permissionCode?: string | null;
}

export interface Role {
  /** Stable id — THIS is what other skills reference (workflow assignee, page visibility, data rule). */
  id: string;
  name: string;
  code: string;
  isSystem?: boolean;
  permissionCodes: string[];
  menuIds: string[];
  /** V2 PDP role inheritance: permissions are the union of own + inherited. */
  inheritsRoleIds?: string[];
}

export interface Department {
  id: string;
  name: string;
  parentId: string | null;
  leaderUserId?: string | null;
}

export interface Position {
  id: string;
  name: string;
  roleIds: string[]; // position_roles
}

export interface User {
  id: string;
  name: string;
  roleIds: string[]; // user_roles
  departmentId?: string | null;
  positionId?: string | null;
}

export interface DataRule {
  id: string;
  name: string;
  /** CROSS-SKILL reference: an entity id owned by the DataModel skill, e.g. "leave_request". */
  modelRef: string;
  scope: DataScope;
  roleIds: string[]; // role_data_rules
}

/** Separation-of-Duties constraint (PDP kernel ◆ SoD): a set of permission codes no single
 *  role may hold together, e.g. 不能既"发起"又"审批"同一业务。 */
export interface SodConstraint {
  name: string;
  /** permission codes that are mutually exclusive within one role */
  mutuallyExclusive: string[];
}

/** V2 SoD rule (role-based separation-of-duty for PDP). */
export interface SoDRule {
  id: string;
  name: string;
  /** roles that are mutually exclusive for the same subject (no single principal holds >1) */
  exclusiveRoleIds: string[];
  severity: "error" | "warning";
}

/** Typed policy request/context for PDP decisions (V2). */
export interface PolicyContext {
  /** subject role refs (and optional finer subject) */
  subject: {
    roleIds: string[];
    userId?: string;
  };
  action: string;
  resourceType: string;
  resourceId?: string;
  tenantId?: string;
  scope?: string;
}

/** PDP decision result. Default is deny (fail-closed) when proof of allow is absent. */
export interface PolicyDecision {
  allow: boolean;
  code: string; // RBAC_DECISION_ALLOW | RBAC_DECISION_FAIL_CLOSED
  reason: string;
  expandedRoles?: string[];
  matchedPermission?: string;
}

export interface RbacModel {
  roles: Role[];
  permissions: Permission[];
  menus: Menu[];
  departments: Department[];
  positions: Position[];
  users: User[];
  dataRules: DataRule[];
  /** optional design-time SoD constraints enforced by the validator. */
  sodConstraints?: SodConstraint[];
  /** V2 PDP SoD rules (role based). */
  sodRules?: SoDRule[];
  /** fail-closed policy posture: true means default-deny for unauthenticated or unruled decisions. */
  failClosed?: boolean;
}
