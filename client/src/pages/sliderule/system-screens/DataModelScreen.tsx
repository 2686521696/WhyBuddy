/**
 * DataModelScreen — 16:9 实体关系图渲染器
 *
 * 从 publishClosure 或 artifact 内容中提取 Mermaid ER/classDiagram DSL，
 * 渲染成可视化实体关系图。无数据时展示骨架占位。
 */

import React, { useMemo } from "react";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

interface DataModelScreenProps {
  publishClosure?: PublishClosureSummary | null;
  /** Raw artifact content containing mermaid ER/class diagram */
  mermaidSource?: string | null;
  isActive?: boolean;
  className?: string;
}

const PLACEHOLDER_ER = `erDiagram
  PurchaseOrder {
    string id PK
    string title
    string status
    number amount
    datetime createdAt
  }
  Approver {
    string id PK
    string name
    string role
  }
  ApprovalRecord {
    string id PK
    string decision
    datetime decidedAt
  }
  PurchaseOrder ||--o{ ApprovalRecord : "awaits"
  Approver ||--o{ ApprovalRecord : "creates"`;

function extractMermaid(text: string): string | null {
  if (!text) return null;
  // ```mermaid ... ``` block
  const fenced = text.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // bare erDiagram / classDiagram / graph block
  const bare = text.match(/(erDiagram|classDiagram)([\s\S]*?)(?=\n\n|\n[A-Z#]|$)/i);
  if (bare) return bare[0].trim();
  return null;
}

export function DataModelScreen({
  publishClosure,
  mermaidSource,
  isActive = false,
  className = "",
}: DataModelScreenProps) {
  const diagram = useMemo(() => {
    if (mermaidSource) {
      const extracted = extractMermaid(mermaidSource);
      if (extracted) return extracted;
    }
    return null;
  }, [mermaidSource]);

  const evidence = publishClosure?.perSkillEvidence?.["datamodel"];
  const hasEvidence = evidence?.evidencePresent === true;

  return (
    <div
      className={`relative flex h-full w-full flex-col bg-white ${className}`}
      data-skill="dataModel"
      data-active={isActive}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-blue-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          DataModel
        </span>
        {hasEvidence && (
          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
            evidence ✓
          </span>
        )}
      </div>

      {/* Diagram area */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <MermaidDiagram
          chart={diagram ?? PLACEHOLDER_ER}
          className="h-full w-full"
        />
      </div>

      {!hasEvidence && !diagram && (
        <div className="absolute bottom-3 left-0 right-0 text-center text-[10px] text-slate-300">
          推演完成后将显示真实实体关系
        </div>
      )}
    </div>
  );
}
