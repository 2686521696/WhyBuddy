/**
 * `autopilot-spec-documents-workbench-v2` — 底部执行步骤区域组件（Phase 2 / Task 8）。
 *
 * 职责：
 * - 左右双栏 CSS Grid 布局（`min-width: 0` 硬约束，不引入 `swiper`）（R5.8）。
 * - 左栏聚焦 ArtifactCard：通过 `MiroFishCardStream` 渲染，并在容器顶部叠加由
 *   `parseSpecDocsObservingEntries(reasoningEntries)` 派生的 observing chip（R5.4）；
 *   不在外层重复 ArtifactCard 类型标签的硬编码（R5.3）。
 * - 右栏聚焦 ReasoningCard：复用同一 `MiroFishCardStream` 派生面，按
 *   `entry.role`（`Analyzer / Planner / Generator`）分类小标题（R5.5）。
 * - 保持 Phase 1 的空态契约：分别在左栏 / 右栏内联条件渲染空态 `<p>`，
 *   不出现任何列表容器（R5.6 / R5.7）。
 *
 * 设计契约：
 * - `data-testid` 使用英文标识（R6.4），中文 JSDoc 描述模块职责（R6.3）。
 * - 不修改 `MiroFishCardStream` / `useBlueprintRealtimeStore` /
 *   `deriveMiroFishStreamEntries` / `parseSpecDocsObservingEntries` 签名或行为。
 */

import { useMemo } from "react";
import type { FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { StaleBadge } from "@/pages/autopilot/stage-edit";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
} from "@shared/blueprint/contracts";

import { parseSpecDocsObservingEntries } from "../../parse-spec-docs-observing";
import {
  ArtifactCreatedCard,
  ReasoningCard,
} from "../../mirofish-stream/cards";
import type {
  MiroFishArtifactCreatedEntry,
  MiroFishReasoningEntry,
} from "../../mirofish-stream/mirofish-stream-types";

type StaleBadgeState = {
  staleSince?: string | null;
  invalidatedBy?: BlueprintGenerationArtifact["invalidatedBy"] | null;
};

type WorkbenchArtifactEntry = MiroFishArtifactCreatedEntry & StaleBadgeState;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * 底部执行步骤 props。
 *
 * - `job`：当前蓝图 job 对象，用于判断 artifacts 空态与传递给 MiroFishCardStream。
 * - `locale`：国际化语言标识。
 * - `reasoningEntries`：由容器透传的 reasoning entries，用于派生 observing chip
 *   与角色分类小标题。
 */
export interface WorkbenchExecutionPanelProps {
  job: BlueprintGenerationJob | null | undefined;
  locale: AppLocale;
  reasoningEntries: readonly AgentReasoningEntry[];
}

// ---------------------------------------------------------------------------
// 角色分类常量
// ---------------------------------------------------------------------------

/** 右栏角色分类小标题列表。 */
const ROLE_SECTIONS = ["analyzer", "planner", "generator"] as const;

const EXECUTION_STAGE_IDS = new Set([
  "spec_tree",
  "spec_docs",
  "spec_documents",
  "effect_preview",
  "preview",
  "prompt_package",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
  undefined,
]);
const SPEC_DOC_ARTIFACT_TYPES = new Set([
  "requirements",
  "design",
  "tasks",
  "spec_document",
  "spec_document_version",
]);

// ---------------------------------------------------------------------------
// 空态文案
// ---------------------------------------------------------------------------

/** 左栏空态文案（artifacts 为空时展示）。 */
const EMPTY_ARTIFACTS_TEXT: Record<AppLocale, string> = {
  "zh-CN": "暂无产物",
  "en-US": "No artifacts yet",
};

/** 右栏空态文案（reasoning entries 为空时展示）。 */
const EMPTY_REASONING_TEXT: Record<AppLocale, string> = {
  "zh-CN": "暂无推理记录",
  "en-US": "No reasoning entries yet",
};

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 底部执行步骤区域组件。
 *
 * Phase 2 实现：左右双栏 CSS Grid 布局，左栏渲染 ArtifactCard + observing chip，
 * 右栏渲染 ReasoningCard + 角色分类小标题。空态时仅渲染占位文案，不渲染任何列表容器。
 */
export const WorkbenchExecutionPanel: FC<WorkbenchExecutionPanelProps> = ({
  job,
  locale,
  reasoningEntries,
}) => {
  // 派生 observing 快照（R5.4）：不修改 parseSpecDocsObservingEntries 签名。
  const observingSnapshot = useMemo(
    () => parseSpecDocsObservingEntries(reasoningEntries),
    [reasoningEntries]
  );

  const artifactEntries = useMemo(
    () => deriveArtifactEntries(job?.artifacts ?? []),
    [job?.artifacts]
  );

  const reasoningCards = useMemo(
    () => deriveReasoningCards(reasoningEntries),
    [reasoningEntries]
  );

  const hasArtifacts = artifactEntries.length > 0;
  const hasReasoning = reasoningCards.length > 0;

  return (
    <section
      data-testid="autopilot-workbench-execution-panel"
      role="region"
      aria-label="autopilot workbench execution panel"
      className="border border-slate-200 bg-white shadow-sm"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
        gridTemplateRows: "minmax(0, 1fr)",
        gap: "8px",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: 0,
        boxSizing: "border-box",
        overflow: "hidden",
        border: "1px solid #e2e8f0",
        borderRadius: 0,
        background: "#ffffff",
        padding: "8px",
      }}
    >
      {/* 左栏：Artifacts + observing chip */}
      <div
        data-testid="autopilot-workbench-execution-artifacts"
        className="min-w-0 rounded-md bg-slate-50/70"
        style={{
          minWidth: 0,
          minHeight: 0,
          height: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          padding: "6px",
        }}
      >
        {hasArtifacts ? (
          <>
            {/* observing chip：仅在有 observing 节点时渲染（R5.4） */}
            {observingSnapshot.byNodeTitle.size > 0 && (
              <div data-testid="autopilot-workbench-execution-observing-chip">
                {Array.from(observingSnapshot.byNodeTitle.entries())
                  .slice(0, 1)
                  .map(([title, kind]) => (
                    <span
                      key={title}
                      className="mb-1.5 inline-flex max-w-full truncate rounded-md border border-cyan-100 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-bold text-cyan-800"
                      title={title}
                    >
                      {kind === "generating" ? "Live" : "Fallback"} · {title}
                    </span>
                  ))}
              </div>
            )}
            <div
              data-testid="autopilot-workbench-execution-artifact-cards"
              style={{ display: "grid", gap: "6px" }}
            >
              {artifactEntries.map((entry) => (
                <div
                  key={entry.id}
                  data-testid="autopilot-workbench-execution-artifact-card-frame"
                  className="min-w-0 overflow-hidden [&_.truncate]:min-w-0 [&_button]:min-w-0 [&_span]:min-w-0"
                >
                  <StaleBadge
                    staleSince={entry.staleSince}
                    invalidatedBy={entry.invalidatedBy}
                    locale={locale}
                  />
                  <ArtifactCreatedCard
                    entry={entry}
                    locale={locale}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p data-testid="autopilot-workbench-execution-artifacts-empty">
            {EMPTY_ARTIFACTS_TEXT[locale]}
          </p>
        )}
      </div>

      {/* 右栏：Reasoning + 角色分类小标题 */}
      <div
        data-testid="autopilot-workbench-execution-reasoning"
        className="min-w-0 rounded-md bg-white"
        style={{
          minWidth: 0,
          minHeight: 0,
          height: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          paddingLeft: "6px",
          borderLeft: "1px solid #e2e8f0",
        }}
      >
        {hasReasoning ? (
          <>
            {/* 角色分类小标题（R5.5） */}
            {ROLE_SECTIONS.map((role) => (
              <div
                key={role}
                data-testid={`autopilot-workbench-execution-role-${role}`}
                style={{
                  display: "inline-flex",
                  marginRight: "6px",
                  marginBottom: "6px",
                  fontSize: "10px",
                  fontWeight: 700,
                  color:
                    role === "analyzer"
                      ? "#2563eb"
                      : role === "planner"
                        ? "#059669"
                        : "#7c3aed",
                }}
              >
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </div>
            ))}
            <div
              data-testid="autopilot-workbench-execution-reasoning-cards"
              className="min-w-0 overflow-hidden [&>*]:min-w-0"
              style={{ display: "grid", gap: "6px" }}
            >
              {reasoningCards.map((entry) => (
                <ReasoningCard
                  key={entry.id}
                  entry={entry}
                  locale={locale}
                />
              ))}
            </div>
          </>
        ) : (
          <p data-testid="autopilot-workbench-execution-reasoning-empty">
            {EMPTY_REASONING_TEXT[locale]}
          </p>
        )}
      </div>
    </section>
  );
};

export default WorkbenchExecutionPanel;

function deriveArtifactEntries(
  artifacts: readonly BlueprintGenerationArtifact[]
): WorkbenchArtifactEntry[] {
  return artifacts
    .filter((artifact) => SPEC_DOC_ARTIFACT_TYPES.has(String(artifact.type)))
    .map((artifact, index) => ({
      id: readArtifactString(artifact, "id") ?? `spec-doc-artifact-${index}`,
      kind: "artifact_created" as const,
      stageId: "spec_docs",
      timestamp:
        readArtifactString(artifact, "createdAt") ?? "1970-01-01T00:00:00.000Z",
      tone: "neutral" as const,
      artifactId: readArtifactString(artifact, "id") ?? `spec-doc-artifact-${index}`,
      artifactType: String(artifact.type),
      title:
        readArtifactString(artifact, "title") ??
        String(artifact.type).replace(/_/g, " "),
      staleSince: artifact.staleSince,
      invalidatedBy: artifact.invalidatedBy,
    }));
}

function readArtifactString(
  artifact: BlueprintGenerationArtifact,
  key: string
): string | undefined {
  const value = (artifact as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function deriveReasoningCards(
  entries: readonly AgentReasoningEntry[]
): MiroFishReasoningEntry[] {
  return entries
    .filter((entry) => EXECUTION_STAGE_IDS.has(entry.stageId))
    .filter(
      (entry) =>
        entry.phase !== "iteration_started" &&
        entry.phase !== "iteration_completed"
    )
    .map((entry) => ({
      id: entry.id,
      kind: "reasoning" as const,
      stageId: entry.stageId,
      timestamp: entry.timestamp,
      tone: entry.phase === "error"
        ? "danger"
        : entry.phase === "observing"
          ? entry.observationSuccess === false
            ? "warning"
            : "success"
          : entry.phase === "completed"
            ? "success"
            : "info",
      phase: entry.phase,
      iterationLabel: entry.iterationLabel,
      thought: entry.thought,
      actionToolId: entry.actionToolId,
      observationSummary: entry.observationSummary,
      observationSuccess: entry.observationSuccess,
      reason: entry.reason,
      error: entry.error,
    }));
}
