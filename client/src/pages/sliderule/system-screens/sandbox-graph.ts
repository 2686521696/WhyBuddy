/**
 * sandbox-graph — 全局大沙盘的派生层（2026-08-14 晚）。
 *
 * 「整张网是一份 schema，所以它可以被整体看见、整体校验——接线通不通，
 * 一眼就知道。」木偶（HTML 页）和三只手（数据模型/权限/工作流）都接完了，
 * 这里把网**画出来**要用的账本机械推出来，零 LLM、零新状态。
 *
 * 在 deriveSystemLinkageGraph（联动图）基础上补三样：
 *
 *   1. 页→实体画**全部**真实引用——联动图只画"主导实体"（fieldBindings 数
 *      得最多的那个），防的是架构图糊成毛线团；沙盘要的恰恰是每根线都在。
 *   2. **角色→页面**边——权限那只手此前在图上根本没连到页面（只有流程
 *      节点→角色一根）。判据跟 rbac-preview 的 PageAccess 同一口径：页面
 *      声明的 actionPermissions 与角色（经菜单）持有的权限有交集才算可进。
 *      公共页（未声明权限）不画——那是"人人可进"，画出来是 角色×页面
 *      的全连接，信息量为零还糊图。
 *   3. **断线体检**——"接线通不通"不能只靠人眼扫：没人读的实体、没有手
 *      可伸的角色、零数据孔的页面、输出悬空的 AIGC 能力，逐个点名。
 *      只报机械可判的，不猜；工作流节点间的连通性归流程屏（transitions
 *      不在本图上，不冤枉人）。
 *
 * 结构闸（v5_model_gate）查的是"引用有没有悬空"；体检查的是反面——
 * "东西在不在网里"。空数组里没有引用、自然没有悬空，闸不会说话，
 * 所以孤岛只有这里报得出来。
 */

import {
  deriveSystemLinkageGraph,
  type FiveSystemModel,
  type LinkageGroup,
  type LinkageSystem,
} from "./five-system-model";
import { deriveRoleAccess } from "../live-runtime/rbac-preview";

export type SandboxEdgeKind =
  | "page-entity"
  | "page-workflow"
  | "node-role"
  | "role-page"
  | "aigc-entity"
  | "aigc-role";

export interface SandboxEdge {
  from: string;
  to: string;
  kind: SandboxEdgeKind;
}

/** 断线体检条目：key 指向图上的成员节点，reason 是给人看的原话。 */
export interface SandboxProblem {
  key: string;
  system: LinkageSystem;
  name: string;
  reason: string;
}

export interface SandboxGraph {
  groups: LinkageGroup[];
  edges: SandboxEdge[];
  problems: SandboxProblem[];
}

export function deriveSandboxGraph(
  model: FiveSystemModel | null | undefined
): SandboxGraph | null {
  const base = deriveSystemLinkageGraph(model);
  if (!base) return null;

  const present = new Set(base.groups.flatMap((g) => g.items.map((i) => i.key)));
  const edges: SandboxEdge[] = [...(base.edges as SandboxEdge[])];
  const seen = new Set(edges.map((e) => `${e.from}->${e.to}:${e.kind}`));
  const push = (from: string, to: string, kind: SandboxEdgeKind) => {
    if (!present.has(from) || !present.has(to)) return; // 悬空成员不画线（与联动图同一纪律）
    const sig = `${from}->${to}:${kind}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    edges.push({ from, to, kind });
  };

  const pages = model?.page?.pages ?? [];

  // 1) 页→实体：fieldBindings 里出现过的每个实体都画（去重靠 push）。
  //    联动图的"主导实体"边已在 base 里，这里补齐其余引用。
  for (const [i, p] of pages.entries()) {
    const pid = p.id || `page-${i}`;
    for (const b of p.fieldBindings ?? []) {
      const dot = b.indexOf(".");
      if (dot > 0) push(`page:${pid}`, `datamodel:${b.slice(0, dot)}`, "page-entity");
    }
  }

  // 2) 角色→页面：与 rbac-preview.pageAccessForRole 的可见性同一判据
  //    （页面声明的动作权限 ∩ 角色经菜单持有的权限非空）。
  const access = deriveRoleAccess(model);
  for (const [i, p] of pages.entries()) {
    const pid = p.id || `page-${i}`;
    const declared = p.actionPermissions ?? [];
    if (declared.length === 0) continue; // 公共页不画：人人可进=没有信息
    for (const a of access) {
      if (a.permissions.some((perm) => declared.includes(perm))) {
        push(`rbac:${a.role}`, `page:${pid}`, "role-page");
      }
    }
  }

  // 3) 断线体检：按成员逐个查度数（只报机械可判的孤岛）。
  const problems: SandboxProblem[] = [];
  const touchesAsTarget = (key: string, kinds: SandboxEdgeKind[]) =>
    edges.some((e) => e.to === key && kinds.includes(e.kind));
  const touchesAsSource = (key: string, kinds: SandboxEdgeKind[]) =>
    edges.some((e) => e.from === key && kinds.includes(e.kind));
  const degree = (key: string) => edges.some((e) => e.from === key || e.to === key);

  for (const g of base.groups) {
    for (const item of g.items) {
      switch (g.system) {
        case "datamodel":
          if (!touchesAsTarget(item.key, ["page-entity", "aigc-entity"])) {
            problems.push({
              key: item.key, system: g.system, name: item.name,
              reason: "没有任何页面读它、也没有 AIGC 写它——这张表是孤岛",
            });
          }
          break;
        case "page":
          if (!touchesAsSource(item.key, ["page-entity"])) {
            problems.push({
              key: item.key, system: g.system, name: item.name,
              reason: "一个实体都没绑——这一页没有数据孔，界面是空的",
            });
          }
          break;
        case "rbac":
          if (!degree(item.key)) {
            problems.push({
              key: item.key, system: g.system, name: item.name,
              reason: "没有连到任何页面/审批点/AIGC——这个角色在应用里没有手",
            });
          }
          break;
        case "aigc":
          if (!touchesAsSource(item.key, ["aigc-entity"])) {
            problems.push({
              key: item.key, system: g.system, name: item.name,
              reason: "输出字段没有落在任何实体上——生成的东西无处安放",
            });
          }
          break;
        case "workflow":
          // 节点间连通性（transitions）不在本图上，归流程屏判，这里不冤枉。
          break;
      }
    }
  }

  return { groups: base.groups, edges, problems };
}
