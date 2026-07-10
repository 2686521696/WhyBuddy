/**
 * tour-script — Work 模式剧本层（纯函数）：五系统 model → 分幕巡演脚本。
 *
 * 确定性推导，无 LLM、无副作用：
 *   - 演员表 cast：RBAC 角色 → 已采购角色模型（characterKey 按序分配）；
 *   - 工位 stations：page 段页面（巡演的走位目标）；
 *   - 幕 steps：集结 → 建单（第一个真有 create 权限的角色在其页面
 *     真写一行数据 + 起流程实例）→ 审批链（沿 workflow 主链路节点推进，
 *     节点 assigneeRole 出演）→ 权限审计（每角色演示一处真实拦截）→ 收幕。
 *
 * 每一步都声明"要真调哪个运行时动作"——执行层（tour-driver）负责真跑，
 * 演出层只订阅事件。事件词汇表 GameEvent 兼容（Agentshire 器官可换皮）。
 */

import type { FiveSystemModel } from "../system-screens/five-system-model";
import type { AppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import {
  deriveRoleAccess,
  pageAccessForRole,
  type PageAccess,
} from "../live-runtime/rbac-preview";

/**
 * 角色池：Agentshire 同款 Kenney 卡通小人（CC0，自带 32 动画剪辑），
 * 资产在 client/public/agentshire-assets/models/characters/。
 * 男女交替分配，与家具/房间同一画风（四期器官移植裁决）。
 */
export const CHARACTER_POOL = [
  "char-female-a",
  "char-male-a",
  "char-female-b",
  "char-male-b",
  "char-female-c",
  "char-male-c",
  "char-female-d",
  "char-male-d",
  "char-female-e",
  "char-male-e",
  "char-female-f",
  "char-male-f",
] as const;

export interface TourActor {
  npcId: string;
  roleId: string;
  /** GLB 文件名（不含扩展名） */
  characterKey: string;
}

export interface TourStation {
  stationId: string;
  pageId: string;
  title: string;
  entityId: string | null;
  /** 所属部门区（来自 RBAC menus——schema 里真实的"台"，非造出来的分组） */
  zoneId: string;
}

export interface TourZone {
  zoneId: string;
  label: string;
}

/**
 * 部门分区（诚实推导）：RBAC menus 就是这套系统真实的"部门/台"
 * （工单台/审核台…）。页面按 actionPermissions 与菜单 permissionRefs 的
 * 交集归属到第一个命中的菜单；公共页（无权限声明）归「公共区」。
 */
export function deriveTourZones(
  model: FiveSystemModel,
  pages: Array<{ id: string; actions: string[] }>
): { zones: TourZone[]; zoneByPageId: Map<string, string> } {
  const menus = model.rbac?.menus ?? [];
  const zones: TourZone[] = [];
  const zoneByPageId = new Map<string, string>();
  const used = new Set<string>();
  let publicUsed = false;

  for (const page of pages) {
    const actions = page.actions ?? [];
    const menu =
      actions.length > 0
        ? menus.find(m =>
            (m.permissionRefs ?? []).some(p => actions.includes(p))
          )
        : undefined;
    if (menu) {
      const zoneId = `zone-${menu.id || menu.label || "menu"}`;
      zoneByPageId.set(page.id, zoneId);
      if (!used.has(zoneId)) {
        used.add(zoneId);
        zones.push({ zoneId, label: menu.label || menu.id || "部门" });
      }
    } else {
      zoneByPageId.set(page.id, "zone-public");
      publicUsed = true;
    }
  }
  if (publicUsed) zones.push({ zoneId: "zone-public", label: "公共区" });
  return { zones, zoneByPageId };
}

export type TourStep =
  | { kind: "spawn"; npcId: string }
  | { kind: "walk"; npcId: string; stationId: string; narration: string }
  | {
      kind: "create_row";
      npcId: string;
      stationId: string;
      entityId: string;
      narration: string;
    }
  | {
      kind: "start_instance";
      npcId: string;
      stationId: string;
      title: string;
      narration: string;
    }
  | {
      kind: "advance";
      npcId: string;
      stationId: string;
      nodeName: string;
      narration: string;
    }
  | {
      kind: "denied_demo";
      npcId: string;
      stationId: string;
      deniedActions: string[];
      narration: string;
    }
  | { kind: "finale"; narration: string };

export interface TourScript {
  cast: TourActor[];
  stations: TourStation[];
  /** 部门区（RBAC menus 推导，演出层据此铺地板分区） */
  zones: TourZone[];
  steps: TourStep[];
  /** 全量权限审计（报告用）：角色 × 不可见页面 */
  denials: Array<{ roleId: string; pageId: string; deniedActions: string[] }>;
}

function npcIdFor(roleId: string, index: number): string {
  return `npc-${index}-${roleId}`;
}

/** 页面 → 工位 id（walk 目标；演出层据此摆桌子） */
function stationIdFor(pageId: string): string {
  return `station-${pageId}`;
}

export function buildTourScript(
  model: FiveSystemModel | null | undefined,
  schema: AppRuntimeSchema | null | undefined
): TourScript | null {
  const roles = schema?.roles ?? [];
  const pages = schema?.pages ?? [];
  if (!model || !schema || roles.length === 0 || pages.length === 0)
    return null;

  const cast: TourActor[] = roles.map((roleId, i) => ({
    npcId: npcIdFor(roleId, i),
    roleId,
    characterKey: CHARACTER_POOL[i % CHARACTER_POOL.length],
  }));
  const actorByRole = new Map(cast.map(a => [a.roleId, a] as const));

  const { zones, zoneByPageId } = deriveTourZones(model, pages);
  const stations: TourStation[] = pages.map(p => ({
    stationId: stationIdFor(p.id),
    pageId: p.id,
    title: p.title,
    entityId: p.entityId,
    zoneId: zoneByPageId.get(p.id) ?? "zone-public",
  }));

  // 每角色的页面访问判定（与运行应用同一纯函数——巡演即测试）
  const accessByRole = new Map<string, PageAccess[]>();
  for (const access of deriveRoleAccess(model)) {
    accessByRole.set(access.role, pageAccessForRole(pages, access));
  }

  const steps: TourStep[] = [];

  // ── 第一幕 · 集结 ─────────────────────────────────────────────
  for (const actor of cast) steps.push({ kind: "spawn", npcId: actor.npcId });

  // ── 第二幕 · 建单（真数据落库）────────────────────────────────
  // 找第一个「角色真有 create 权限 + 页面有主实体」的组合。
  let creator: TourActor | null = null;
  let creationStation: TourStation | null = null;
  outer: for (const actor of cast) {
    const pageAccess = accessByRole.get(actor.roleId) ?? [];
    for (const pa of pageAccess) {
      const station = stations.find(s => s.pageId === pa.pageId);
      if (pa.visible && pa.canCreate && station?.entityId) {
        creator = actor;
        creationStation = station;
        break outer;
      }
    }
  }
  if (creator && creationStation?.entityId) {
    steps.push({
      kind: "walk",
      npcId: creator.npcId,
      stationId: creationStation.stationId,
      narration: `${creator.roleId} 走向「${creationStation.title}」`,
    });
    steps.push({
      kind: "create_row",
      npcId: creator.npcId,
      stationId: creationStation.stationId,
      entityId: creationStation.entityId,
      narration: `${creator.roleId} 在「${creationStation.title}」录入一条业务数据`,
    });
    steps.push({
      kind: "start_instance",
      npcId: creator.npcId,
      stationId: creationStation.stationId,
      title: `巡演单 · ${creationStation.title}`,
      narration: `${creator.roleId} 发起流程`,
    });
  }

  // ── 第三幕 · 审批链（沿 workflow 主链路推进真实例）──────────────
  // 从起始节点沿 transitions 走单条路径（分支取第一条）；每个节点由
  // assigneeRole 出演（无角色 → 第一个演员代跑）。
  const nodes = model.workflow?.nodes ?? [];
  const transitions = model.workflow?.transitions ?? [];
  if (nodes.length > 0 && creator) {
    const hasInbound = new Set(transitions.map(t => t.to));
    let currentId: string | null =
      nodes.find(n => !hasInbound.has(n.id))?.id ?? nodes[0]?.id ?? null;
    const visited = new Set<string>();
    // 工作流工位：优先 appbundle 绑定的页面，否则用建单页
    const wfPageRef = (model.appbundle?.pageBindings ?? []).find(
      b => b.workflowRef
    )?.pageRef;
    const wfStation =
      stations.find(s => s.pageId === wfPageRef) ??
      creationStation ??
      stations[0];
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodes.find(n => n.id === currentId);
      if (!node) break;
      const actor =
        (node.assigneeRole && actorByRole.get(node.assigneeRole)) || creator;
      const nodeName = node.name || node.id;
      steps.push({
        kind: "walk",
        npcId: actor.npcId,
        stationId: wfStation.stationId,
        narration: `${actor.roleId} 前往「${nodeName}」节点`,
      });
      steps.push({
        kind: "advance",
        npcId: actor.npcId,
        stationId: wfStation.stationId,
        nodeName,
        narration: `${actor.roleId} 处理「${nodeName}」`,
      });
      currentId = transitions.find(t => t.from === currentId)?.to ?? null;
    }
  }

  // ── 第四幕 · 权限审计（真实拦截可视化）────────────────────────
  // 全量拦截入报告；演出上每角色最多演示一处（避免拖戏）。
  const denials: TourScript["denials"] = [];
  for (const actor of cast) {
    const pageAccess = accessByRole.get(actor.roleId) ?? [];
    let demoed = false;
    for (const pa of pageAccess) {
      if (pa.visible) continue;
      denials.push({
        roleId: actor.roleId,
        pageId: pa.pageId,
        deniedActions: pa.deniedActions,
      });
      const station = stations.find(s => s.pageId === pa.pageId);
      if (!demoed && station) {
        demoed = true;
        steps.push({
          kind: "walk",
          npcId: actor.npcId,
          stationId: station.stationId,
          narration: `${actor.roleId} 尝试进入「${station.title}」`,
        });
        steps.push({
          kind: "denied_demo",
          npcId: actor.npcId,
          stationId: station.stationId,
          deniedActions: pa.deniedActions,
          narration: `RBAC 拦截：${actor.roleId} 无权访问「${station.title}」`,
        });
      }
    }
  }

  // ── 终幕 ──────────────────────────────────────────────────────
  steps.push({
    kind: "finale",
    narration: "巡演完成——数据与流程留痕可在应用/数据表中查验",
  });

  return { cast, stations, zones, steps, denials };
}
