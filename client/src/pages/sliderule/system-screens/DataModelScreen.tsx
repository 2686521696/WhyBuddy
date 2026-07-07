/**
 * DataModelScreen — 16:9 实体关系图渲染器
 *
 * 从 publishClosure 或 artifact 内容中提取 Mermaid ER/classDiagram DSL，
 * 渲染成可视化实体关系图。无数据时展示骨架占位。
 */

import React, { useMemo, useState } from "react";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { datamodelToMermaid, type FiveSystemModel } from "./five-system-model";
import { EntityDataPanel } from "../live-runtime/EntityDataPanel";
import { EmptyScreenHint } from "./EmptyScreenHint";
import { EntityRelationGraph } from "./EntityRelationGraph";

interface DataModelScreenProps {
  publishClosure?: PublishClosureSummary | null;
  /** Raw artifact content containing mermaid ER/class diagram */
  mermaidSource?: string | null;
  /** 解析出的五系统模型（刷新路径：modelSection 重建真实实体关系）。 */
  model?: FiveSystemModel | null;
  /** 数据表（浏览器运行时）状态的持久化命名空间 */
  sessionId?: string;
  isActive?: boolean;
  className?: string;
}

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
  sessionId = "sliderule-v51-product",
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
  // 数据表需要模型里有实体（编辑才有对象）
  const canEditData = (model?.datamodel?.entities?.length ?? 0) > 0;
  const [screenMode, setScreenMode] = useState<"diagram" | "table">("diagram");

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
          {canEditData && (
            <div
              className="flex items-center gap-0.5 rounded-full bg-[#F0EDE5] p-0.5 ring-1 ring-[#E7E2D9]/80"
              data-testid="datamodel-mode-toggle"
            >
              {([
                { id: "diagram" as const, label: "模型图" },
                { id: "table" as const, label: "数据表" },
              ]).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`datamodel-mode-${id}`}
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

      {screenMode === "table" && canEditData && model ? (
        <div className="min-h-0 flex-1">
          <EntityDataPanel model={model} sessionId={sessionId} />
        </div>
      ) : canEditData ? (
        // 结构化模型在手 → G6 实体关系图（卡片节点 + 关联边 + 拖拽缩放）
        <div className="min-h-0 flex-1">
          <EntityRelationGraph datamodel={model!.datamodel} />
        </div>
      ) : isPlaceholder ? (
        // 空状态不渲染任何假域示例（曾被误读成真实数据），只说清将来出现什么
        <EmptyScreenHint title="实体关系图（ER）" desc="实体、字段与关联，来自五系统模型 datamodel 段" />
      ) : (
        // 仅有 SSE 文本 mermaid（无结构化模型）时的降级渲染
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <MermaidDiagram chart={diagram!} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}
