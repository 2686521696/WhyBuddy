/**
 * DataModelScreen — 16:9 实体关系图渲染器
 *
 * 从 publishClosure 或 artifact 内容中提取 Mermaid ER/classDiagram DSL，
 * 渲染成可视化实体关系图。无数据时展示骨架占位。
 */

import React, { useMemo } from "react";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { datamodelToMermaid, type FiveSystemModel } from "./five-system-model";

interface DataModelScreenProps {
  publishClosure?: PublishClosureSummary | null;
  /** Raw artifact content containing mermaid ER/class diagram */
  mermaidSource?: string | null;
  /** 解析出的五系统模型（刷新路径：modelSection 重建真实实体关系）。 */
  model?: FiveSystemModel | null;
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
  model,
  isActive = false,
  className = "",
}: DataModelScreenProps) {
  // 诚实降级链：SSE mermaid（实时）→ 五系统模型实体（刷新重建）→ 占位骨架。
  const sseDiagram = useMemo(() => {
    if (!mermaidSource) return null;
    return extractMermaid(mermaidSource);
  }, [mermaidSource]);
  const modelDiagram = useMemo(
    () => datamodelToMermaid(model?.datamodel),
    [model?.datamodel]
  );
  const diagram = sseDiagram ?? modelDiagram;
  const isPlaceholder = !diagram;

  const evidence = publishClosure?.perSkillEvidence?.["datamodel"];

  return (
    <div
      className={`relative flex h-full w-full flex-col bg-white ${className}`}
      data-skill="dataModel"
      data-active={isActive}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[#EFEBE2] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-blue-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          DataModel
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      {/* Diagram area — 占位骨架降透明度并明示，不冒充真实产物 */}
      <div className={`min-h-0 flex-1 overflow-auto p-3 ${isPlaceholder ? "opacity-40" : ""}`}>
        <MermaidDiagram
          chart={diagram ?? PLACEHOLDER_ER}
          className="h-full w-full"
        />
      </div>

      {isPlaceholder && (
        <div className="absolute bottom-3 left-0 right-0 text-center text-[10px] text-stone-400">
          占位示意（非本话题数据）· 推演完成后将显示真实实体关系
        </div>
      )}
    </div>
  );
}
