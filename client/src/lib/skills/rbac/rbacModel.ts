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

export interface RbacModel {
  roles: Role[];
  permissions: Permission[];
  menus: Menu[];
  departments: Department[];
  positions: Position[];
  users: User[];
  dataRules: DataRule[];
}
