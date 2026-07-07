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
import { WorkflowRuntimePanel } from "../live-runtime/WorkflowRuntimePanel";
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

const PLACEHOLDER_FLOW = `flowchart TD
  A([提交采购申请]) --> B{金额判断}
  B -->|≤5万| C[部门经理审批]
  B -->|>5万| D[财务负责人审批]
  C --> E{审批决定}
  D --> E
  E -->|批准| F[生成采购单]
  E -->|拒绝| G([退回申请人])
  F --> H[财务确认付款]
  H --> I([流程结束])`;

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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Diagram */}
        <div className={`min-h-0 min-w-0 flex-1 overflow-auto p-3 ${sourceKind === "placeholder" ? "opacity-40" : ""}`}>
          <MermaidDiagram chart={diagram ?? PLACEHOLDER_FLOW} className="h-full w-full" />
        </div>

        {/* Node/assignee table — only when the structured model is present */}
        {sourceKind === "model" && nodes.length > 0 && (
          <div className="w-64 shrink-0 overflow-auto border-l border-[#EFEBE2]">
            <div className="sticky top-0 z-10 bg-[#F5F1EA] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
              节点 → 审批人角色（RBAC）
            </div>
            <ul className="divide-y divide-[#EFEBE2]" data-testid="workflow-node-roles">
              {roleResolutions.map(({ node, role }) => (
                <li key={node.id} className="px-3 py-2 text-xs">
                  <div className="font-medium text-stone-800">{node.name || node.id}</div>
                  <div className="mt-1">
                    {role.ref ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                          role.resolved
                            ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200"
                            : "bg-red-50 text-red-600 ring-1 ring-red-200"
                        }`}
                      >
                        {role.resolved ? "✓" : "✗"} {role.label}
                      </span>
                    ) : (
                      <span className="text-[10px] text-stone-300">无审批人</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      )}

      {sourceKind === "placeholder" && (
        <div className="absolute bottom-3 left-0 right-0 text-center text-[10px] text-stone-400">
          占位示意（非本话题数据）· 推演完成后将显示真实业务流程
        </div>
      )}
    </div>
  );
}
