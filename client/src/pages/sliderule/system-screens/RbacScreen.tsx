/**
 * RbacScreen — 角色权限树 + 数据规则表
 *
 * 数据优先级（诚实降级链）：
 *   1. 五系统模型 rbac 段：roles/permissions/menus 真实渲染——每个角色的
 *      权限与菜单从 menus[].roleRefs/permissionRefs 反推；permissionRefs
 *      未在 permissions 清单声明的如实标红（与 gate 的 fail-closed 一致）。
 *   2. rawContent 文本解析（SSE 路径的角色定义文本）。
 *   3. 占位骨架（降透明度 + 明示），不冒充真实产物。
 */

import React, { useMemo } from "react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import type { FiveSystemModel } from "./five-system-model";

interface RbacScreenProps {
  publishClosure?: PublishClosureSummary | null;
  /** Raw text content from RBAC capability result */
  rawContent?: string | null;
  /** 解析出的五系统模型（rbac 段：roles/permissions/menus）。 */
  model?: FiveSystemModel | null;
  isActive?: boolean;
  className?: string;
}

interface RoleEntry {
  role: string;
  permissions: string[];
  menus: string[];
  dataRules?: string;
}

const PLACEHOLDER_ROLES: RoleEntry[] = [
  { role: "申请人", permissions: ["采购单:创建", "采购单:查看(自己)"], menus: ["我的申请", "采购单列表"], dataRules: "仅可见本人发起的单据" },
  { role: "部门经理", permissions: ["采购单:审批", "采购单:查看(本部门)"], menus: ["待审批", "历史审批"], dataRules: "可见本部门所有单据" },
  { role: "财务负责人", permissions: ["采购单:审批", "付款:确认", "采购单:查看(全部)"], menus: ["待审批", "付款管理", "报表"], dataRules: "可见全量单据" },
  { role: "系统管理员", permissions: ["用户:管理", "角色:配置", "系统:配置"], menus: ["用户管理", "角色管理", "系统设置"], dataRules: "全量访问" },
];

function parseRolesFromContent(content: string): RoleEntry[] | null {
  // Try to find role definitions in the content
  const lines = content.split("\n").filter(Boolean);
  const roles: RoleEntry[] = [];
  let current: Partial<RoleEntry> | null = null;

  for (const line of lines) {
    const roleMatch = line.match(/^#+\s*角色[：:]\s*(.+)$|^Role[：:]\s*(.+)$/i);
    if (roleMatch) {
      if (current?.role) roles.push(current as RoleEntry);
      current = { role: (roleMatch[1] || roleMatch[2]).trim(), permissions: [], menus: [] };
      continue;
    }
    if (current && line.match(/权限[：:]/i)) {
      const perms = line.replace(/.*权限[：:]/, "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      current.permissions = perms;
    }
    if (current && line.match(/菜单[：:]/i)) {
      const menus = line.replace(/.*菜单[：:]/, "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      current.menus = menus;
    }
    if (current && line.match(/数据规则[：:]/i)) {
      current.dataRules = line.replace(/.*数据规则[：:]/, "").trim();
    }
  }
  if (current?.role) roles.push(current as RoleEntry);
  return roles.length >= 2 ? roles : null;
}

/** model.rbac → 角色行：权限/菜单从 menus 的 roleRefs/permissionRefs 反推。 */
function rolesFromModel(rbac: FiveSystemModel["rbac"] | null | undefined): RoleEntry[] | null {
  const roleIds = rbac?.roles ?? [];
  if (roleIds.length === 0) return null;
  const menus = rbac?.menus ?? [];
  return roleIds.map((role) => {
    const roleMenus = menus.filter((m) => (m.roleRefs ?? []).includes(role));
    const permissions = [...new Set(roleMenus.flatMap((m) => m.permissionRefs ?? []))];
    return {
      role,
      permissions,
      menus: roleMenus.map((m) => m.label || m.id || "").filter(Boolean),
    };
  });
}

export function RbacScreen({
  publishClosure,
  rawContent,
  model,
  isActive = false,
  className = "",
}: RbacScreenProps) {
  const modelRoles = useMemo(() => rolesFromModel(model?.rbac), [model?.rbac]);
  // 未在 rbac.permissions 清单声明的 permissionRef 如实标红（不静默吞掉）。
  const declaredPermissions = useMemo(
    () => new Set(model?.rbac?.permissions ?? []),
    [model?.rbac?.permissions]
  );
  const roles = useMemo(() => {
    if (modelRoles) return modelRoles;
    if (rawContent) {
      const parsed = parseRolesFromContent(rawContent);
      if (parsed) return parsed;
    }
    return PLACEHOLDER_ROLES;
  }, [modelRoles, rawContent]);

  const evidence = publishClosure?.perSkillEvidence?.["rbac"];
  const isPlaceholder = !modelRoles && (!rawContent || !parseRolesFromContent(rawContent));
  const hasModel = !!modelRoles;

  return (
    <div
      className={`relative flex h-full w-full flex-col bg-white ${className}`}
      data-skill="rbac"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#EFEBE2] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-orange-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">RBAC</span>
        <span className="text-xs text-stone-400">
          {hasModel
            ? `${modelRoles!.length} 角色 · ${model?.rbac?.permissions?.length ?? 0} 权限 · ${model?.rbac?.menus?.length ?? 0} 菜单`
            : "角色 → 权限 · 菜单 · 数据规则"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-[#F5F1EA]">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-stone-600">角色</th>
              <th className="px-4 py-2 text-left font-semibold text-stone-600">权限</th>
              <th className="px-4 py-2 text-left font-semibold text-stone-600">菜单</th>
              <th className="px-4 py-2 text-left font-semibold text-stone-600">数据规则</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EFEBE2]">
            {roles.map((entry) => (
              <tr
                key={entry.role}
                className={`transition-colors hover:bg-[#F5F1EA] ${isPlaceholder ? "opacity-40" : ""}`}
              >
                <td className="px-4 py-2.5 font-medium text-stone-800">{entry.role}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {entry.permissions.length > 0 ? (
                      entry.permissions.map((p) => {
                        const undeclared = hasModel && !declaredPermissions.has(p);
                        return (
                          <span
                            key={p}
                            className={
                              undeclared
                                ? "rounded bg-red-50 px-1.5 py-0.5 text-red-600 ring-1 ring-red-200"
                                : "rounded bg-blue-50 px-1.5 py-0.5 text-blue-700"
                            }
                            title={undeclared ? `权限未在 rbac.permissions 清单声明：${p}` : p}
                          >
                            {undeclared ? "✗ " : ""}
                            {p}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-[10px] text-stone-300">未挂权限</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {entry.menus.map((m) => (
                      <span key={m} className="rounded bg-[#F0EDE5] px-1.5 py-0.5 text-stone-600">
                        {m}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-stone-500">{entry.dataRules ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {isPlaceholder && (
          <div className="mt-4 text-center text-[10px] text-stone-400">
            占位示意（非本话题数据）· 推演完成后将显示真实权限矩阵
          </div>
        )}
      </div>
    </div>
  );
}
