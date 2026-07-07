/**
 * WorkflowScreen — 16:9 流程图渲染器
 *
 * 数据优先级（诚实降级链）：
 *   1. 五系统模型 workflow 段：nodes/transitions 渲染成 Mermaid flowchart，
 *      节点审批人角色（assigneeRole）与 rbac.roles 交叉校验，未解析引用如实标红。
 *   2. SSE skill_result 携带的 mermaid（跨系统联动图，实时推演中）。
 *   3. 持久化 skillRuntimeGraph 的 workflow 跨系统边（刷新后重建）。
 *   4. 占位骨架（降透明度 + 提示），不冒充真实产物。
 */

import React, { useMemo, useState } from "react";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { EmptyScreenHint } from "./EmptyScreenHint";
import { WorkflowRuntimePanel } from "../live-runtime/WorkflowRuntimePanel";
import { WorkflowGraph, roleColor } from "./WorkflowGraph";
import {
  type FiveSystemModel,
  type SkillRuntimeGraphLike,
  workflowModelToMermaid,
  resolveRoleRef,
  edgesForSkill,
  crossSkillEdgesToMermaid,
} from "./five-system-model";

interface WorkflowScreenProps {
  publishClosure?: PublishClosureSummary | null;
  mermaidSource?: string | null;
  /** 解析出的五系统模型（含 rbac 段用于 assigneeRole 交叉引用）。 */
  model?: FiveSystemModel | null;
  /** 持久化的跨系统运行时图（刷新后无 SSE mermaid 时的真实数据源）。 */
  skillRuntimeGraph?: SkillRuntimeGraphLike | null;
  /** 试运行状态的持久化命名空间（浏览器运行时，零后端）。 */
  sessionId?: string;
  isActive?: boolean;
  className?: string;
}

function extractFlow(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const bare = text.match(/(flowchart|graph|sequenceDiagram)([\s\S]*?)(?=\n\n|\n[A-Z#]|$)/i);
  if (bare) return bare[0].trim();
  return null;
}

export function WorkflowScreen({
  publishClosure,
  mermaidSource,
  model,
  skillRuntimeGraph,
  sessionId = "sliderule-v51-product",
  isActive = false,
  className = "",
}: WorkflowScreenProps) {
  const workflow = model?.workflow;
  const nodes = workflow?.nodes ?? [];
  const transitions = workflow?.transitions ?? [];
  // 试运行（浏览器运行时）：模型在场才可用——像 ECharts 一样把 workflow 段
  // 渲染成可操作的审批状态机（发起/通过/驳回/分支/日志，零后端）。
  const [screenMode, setScreenMode] = useState<"diagram" | "runtime">("diagram");

  const modelDiagram = useMemo(() => workflowModelToMermaid(workflow), [workflow]);

  const sseDiagram = useMemo(() => {
    if (!mermaidSource) return null;
    return extractFlow(mermaidSource);
  }, [mermaidSource]);

  const graphEdges = useMemo(
    () => edgesForSkill(skillRuntimeGraph, "workflow"),
    [skillRuntimeGraph]
  );
  const graphDiagram = useMemo(
    () => (graphEdges.length > 0 ? crossSkillEdgesToMermaid("workflow", graphEdges) : null),
    [graphEdges]
  );

  // 降级链：模型 → SSE mermaid → 持久化跨系统边 → 占位
  const diagram = modelDiagram ?? sseDiagram ?? graphDiagram;
  const sourceKind: "model" | "sse" | "graph" | "placeholder" = modelDiagram
    ? "model"
    : sseDiagram
    ? "sse"
    : graphDiagram
    ? "graph"
    : "placeholder";

  const roleResolutions = useMemo(
    () => nodes.map((node) => ({ node, role: resolveRoleRef(node.assigneeRole, model) })),
    [nodes, model]
  );
  const unresolvedRoleCount = roleResolutions.filter(
    (r) => r.role.ref && !r.role.resolved
  ).length;

  // 图例条数据：按角色聚合（color 与图上节点色条一致）
  const roleLegend = useMemo(() => {
    const declaredRoles = model?.rbac?.roles ?? [];
    const byRole = new Map<string, { role: string; resolved: boolean; count: number; color: string }>();
    for (const { role } of roleResolutions) {
      if (!role.ref) continue;
      const entry = byRole.get(role.ref) ?? {
        role: role.ref,
        resolved: role.resolved,
        count: 0,
        color: roleColor(role.ref, declaredRoles),
      };
      entry.count += 1;
      byRole.set(role.ref, entry);
    }
    return [...byRole.values()];
  }, [roleResolutions, model?.rbac?.roles]);

  const evidence = publishClosure?.perSkillEvidence?.["workflow"];

  return (
    <div
      className={`relative flex h-full w-full flex-col bg-white ${className}`}
      data-skill="workflow"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#EFEBE2] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-violet-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Workflow
        </span>
        {sourceKind === "model" && (
          <span className="text-xs text-stone-400">
            {nodes.length} 节点 · {transitions.length} 转移
          </span>
        )}
        {sourceKind === "sse" && (
          <span className="text-xs text-stone-400">跨系统联动 · 实时</span>
        )}
        {sourceKind === "graph" && (
          <span className="text-xs text-stone-400">跨系统联动 · 已持久化</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {unresolvedRoleCount > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 ring-1 ring-red-200">
              {unresolvedRoleCount} 个角色未在 RBAC 定义
            </span>
          )}
          {sourceKind === "model" && nodes.length > 0 && (
            <div
              className="flex items-center gap-0.5 rounded-full bg-[#F0EDE5] p-0.5 ring-1 ring-[#E7E2D9]/80"
              data-testid="workflow-mode-toggle"
            >
              {([
                { id: "diagram" as const, label: "流程图" },
                { id: "runtime" as const, label: "试运行" },
              ]).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`workflow-mode-${id}`}
                  onClick={() => setScreenMode(id)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    screenMode === id
                      ? "bg-white text-stone-800 shadow-sm"
                      : "text-stone-500 hover:text-stone-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      {screenMode === "runtime" && sourceKind === "model" && model ? (
        <WorkflowRuntimePanel model={model} sessionId={sessionId} />
      ) : (
      <>
        {/* 角色图例条 — 取代早期的节点角色侧表（与节点卡信息重复且占 1/4 画布）。
            色点与图上节点色条一致；未在 RBAC 声明的角色照旧 ✗ 标红（fail-closed）。 */}
        {sourceKind === "model" && roleLegend.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1.5 border-b border-[#EFEBE2] bg-[#FBF9F4] px-4 py-1.5"
            data-testid="workflow-node-roles"
          >
            <span className="text-[10px] text-stone-400">审批人角色</span>
            {roleLegend.map((entry) => (
              <span
                key={entry.role}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ring-1 ${
                  entry.resolved
                    ? "bg-white text-stone-600 ring-[#E7E2D9]"
                    : "bg-red-50 text-red-600 ring-red-200"
                }`}
                title={
                  entry.resolved
                    ? `${entry.count} 个节点由 ${entry.role} 审批`
                    : `角色未在 RBAC 定义：${entry.role}`
                }
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: entry.resolved ? entry.color : "#ff4d4f" }}
                />
                {`${entry.resolved ? "✓" : "✗"} ${entry.role}`}
                <span className={entry.resolved ? "text-stone-400" : "text-red-400"}>×{entry.count}</span>
              </span>
            ))}
            <span className="ml-auto hidden text-[10px] text-stone-300 sm:inline">
              虚线 = 回退/驳回 · 珊瑚高亮 = 实例当前位置
            </span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {sourceKind === "placeholder" ? (
            <EmptyScreenHint title="业务流程图" desc="节点、转移与审批人角色，来自五系统模型 workflow 段" />
          ) : sourceKind === "model" && model ? (
            // 结构化模型在手 → 活图（角色着色 + 试运行实例实时高亮）
            <div className="min-h-0 min-w-0 flex-1">
              <WorkflowGraph model={model} sessionId={sessionId} />
            </div>
          ) : (
            <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
              <MermaidDiagram chart={diagram ?? ""} className="h-full w-full" />
            </div>
          )}
        </div>
      </>
      )}

    </div>
  );
}
