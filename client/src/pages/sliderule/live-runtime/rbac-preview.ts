/**
 * rbac-preview — 角色 → 权限 → 页面可见性/操作权的推导（浏览器运行时 M2）。
 *
 * 语义与 RbacScreen 的权限矩阵同源：角色的权限集 = rbac.menus 中
 * roleRefs 含该角色的菜单的 permissionRefs 并集。页面访问规则：
 *   - 页面未声明 actionPermissions → 公共页，所有角色可见
 *   - 声明了 → 角色持有其中至少一个才可见（fail-closed：一律不可见时如实展示锁定）
 *   - 「新建」按钮 → 页面声明了 *:create 动作时，角色必须持有其一；未声明则不设卡
 *
 * 纯函数模块：模型/schema 进、访问判定出，无副作用，便于单测。
 */

import type { FiveSystemModel } from "../system-screens/five-system-model";
import type { AppPageSchema } from "./app-runtime-schema";

export interface RoleAccess {
  role: string;
  /** roleRefs 含该角色的菜单的 permissionRefs 并集 */
  permissions: string[];
  /** 该角色可见的 rbac 菜单标签（证据侧口径，供预览展示） */
  menuLabels: string[];
}

export function deriveRoleAccess(
  model: FiveSystemModel | null | undefined
): RoleAccess[] {
  const roles = model?.rbac?.roles ?? [];
  const menus = model?.rbac?.menus ?? [];
  return roles.map(role => {
    const roleMenus = menus.filter(m => (m.roleRefs ?? []).includes(role));
    return {
      role,
      permissions: [...new Set(roleMenus.flatMap(m => m.permissionRefs ?? []))],
      menuLabels: roleMenus.map(m => m.label || m.id || "").filter(Boolean),
    };
  });
}

export interface PageAccess {
  pageId: string;
  title: string;
  /** 公共页（未声明 actionPermissions）恒可见；否则需持有至少一个声明动作 */
  visible: boolean;
  /** 页面声明了 *:create 时须持有其一；未声明 create 动作则不设卡 */
  canCreate: boolean;
  /** 卡「新建」的具体权限（未声明 create 动作时为 null） */
  createPermission: string | null;
  grantedActions: string[];
  deniedActions: string[];
}

export function pageAccessForRole(
  pages: AppPageSchema[],
  access: RoleAccess | undefined
): PageAccess[] {
  const held = new Set(access?.permissions ?? []);
  return pages.map(page => {
    const actions = page.actions ?? [];
    const granted = actions.filter(a => held.has(a));
    const denied = actions.filter(a => !held.has(a));
    const createActions = actions.filter(a => /:create$/.test(a));
    const createHeld = createActions.find(a => held.has(a)) ?? null;
    return {
      pageId: page.id,
      title: page.title,
      visible: actions.length === 0 || granted.length > 0,
      canCreate: createActions.length === 0 || createHeld !== null,
      createPermission: createActions[0] ?? null,
      grantedActions: granted,
      deniedActions: denied,
    };
  });
}

export function accessForRole(
  model: FiveSystemModel | null | undefined,
  role: string | undefined
): RoleAccess | undefined {
  if (!role) return undefined;
  return deriveRoleAccess(model).find(r => r.role === role);
}
