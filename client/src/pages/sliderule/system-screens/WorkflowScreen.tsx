/**
 * WorkflowScreen — 16:9 流程图渲染器
 *
 * 渲染 Mermaid flowchart 或 sequenceDiagram，
 * 展示 Workflow Skill 产出的业务流程。
 */

import React, { useMemo } from "react";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

interface WorkflowScreenProps {
  publishClosure?: PublishClosureSummary | null;
  mermaidSource?: string | null;
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
  isActive = false,
  className = "",
}: WorkflowScreenProps) {
  const diagram = useMemo(() => {
    if (mermaidSource) {
      const extracted = extractFlow(mermaidSource);
      if (extracted) return extracted;
    }
    return null;
  }, [mermaidSource]);

  const evidence = publishClosure?.perSkillEvidence?.["workflow"];
  const hasEvidence = evidence?.evidencePresent === true;

  return (
    <div
      className={`relative flex h-full w-full flex-col bg-white ${className}`}
      data-skill="workflow"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-violet-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Workflow
        </span>
        {hasEvidence && (
          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
            evidence ✓
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <MermaidDiagram
          chart={diagram ?? PLACEHOLDER_FLOW}
          className="h-full w-full"
        />
      </div>

      {!hasEvidence && !diagram && (
        <div className="absolute bottom-3 left-0 right-0 text-center text-[10px] text-slate-300">
          推演完成后将显示真实业务流程
        </div>
      )}
    </div>
  );
}
