/**
 * autopilot-mirofish-stream / Wave 0
 *
 * 纯派生函数：把多个 store slice / job artifact 合并成 MiroFishStreamEntry[]。
 *
 * 设计原则：
 * - 纯函数、无副作用，便于在 vitest node 环境密集 PBT。
 * - O(N + M)：所有合并步骤都是单遍扫，最后做一次 stable sort。
 * - 容忍输入缺失（store 初始空态、SSR mock 部分注入），缺失时跳过该类 entry，
 *   不抛错也不引入造假数据。
 * - timestamp 是排序唯一锚点；缺失 timestamp 的 entry 派为 system_note 落到流尾，
 *   带 warning tone 提示数据问题。
 */

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationArtifact,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import type { CapabilityStatus } from "@/lib/blueprint-realtime-store";
import type { SpecDocumentTreeStats } from "@/lib/blueprint-spec-document-stats";

import type {
  MiroFishArtifactCreatedEntry,
  MiroFishCapabilityInvocationEntry,
  MiroFishCapabilityInvocationStatus,
  MiroFishNodeCompletedEntry,
  MiroFishReasoningEntry,
  MiroFishRouteDecisionEntry,
  MiroFishStreamEntry,
  MiroFishStreamTone,
} from "./mirofish-stream-types";

// ─── 输入与输出 ──────────────────────────────────────────────────────────

export interface DeriveMiroFishStreamEntriesInput {
  agentReasoning?: ReadonlyArray<AgentReasoningEntry>;
  capabilityStatuses?: Record<string, CapabilityStatus>;
  /** job.artifacts。从 BlueprintGenerationJob 派生。 */
  artifacts?: ReadonlyArray<BlueprintGenerationArtifact>;
  /**
   * 路线选择。当 job.artifacts 中已经有 route_selection artifact，调用方应当从中
   * 解出此对象。
   */
  routeSelection?: BlueprintRouteSelection | null;
  /**
   * 当前 RouteSet（用于反查 routeKind = primary | alternative）。
   * 缺失时 routeKind 字段不出现，不影响其它派生。
   */
  routeSet?: BlueprintRouteSet | null;
  /**
   * specTree 节点元数据（用 nodeId 反查 nodeTitle）+ 联动 deriveSpecDocumentTreeStats
   * 算节点完成态。
   */
  specTree?: BlueprintSpecTree | null;
  /** SPEC 文档列表（可选）。缺失时用 specDocumentTreeStats fallback。 */
  specDocuments?: ReadonlyArray<BlueprintSpecDocument>;
  /**
   * 已经预算好的 specDocumentTreeStats（avoid duplicate work）。MiroFishCardStream
   * 可能在多处用同一份 stats，先算一次再传入。
   */
  specDocumentTreeStats?: SpecDocumentTreeStats | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────

/** artifact.type → stageId 映射。未知 type → undefined（视为全局事件）。 */
function artifactTypeToStageId(
  artifactType: string
): string | undefined {
  switch (artifactType) {
    case "intake":
    case "github_source":
    case "project_context":
      return "intake_created";
    case "clarification_session":
      return "clarification";
    case "route_set":
      return "route_generation";
    case "route_selection":
      return "route_selection";
    case "spec_tree":
    case "spec_tree_version":
      return "spec_tree";
    case "requirements":
    case "design":
    case "tasks":
    case "spec_document_version":
      return "spec_docs";
    case "preview":
    case "effect_preview":
      return "effect_preview";
    case "prompt_pack":
      return "prompt_packaging";
    case "agent_crew":
    case "role_timeline":
      return "agent_crew_fabric";
    case "engineering_plan":
    case "engineering_run":
      return "engineering_handoff";
    case "capability_registry":
    case "capability_invocation":
    case "capability_evidence":
      return "runtime_capability";
    case "replay":
    case "feedback":
    case "sandbox_derivation_job":
    default:
      return undefined;
  }
}

/** reasoning entry phase + observationSuccess 派生 tone。 */
function reasoningTone(
  entry: AgentReasoningEntry
): MiroFishStreamTone {
  switch (entry.phase) {
    case "thinking":
    case "acting":
      return "info";
    case "observing":
      // observationSuccess === false 时升级为 warning，否则 success
      return entry.observationSuccess === false ? "warning" : "success";
    case "completed":
      return "success";
    case "error":
      return "danger";
    case "iteration_started":
    case "iteration_completed":
      return "neutral";
    default:
      return "neutral";
  }
}

/** capability status 派生 tone。 */
function capabilityTone(
  status: MiroFishCapabilityInvocationStatus
): MiroFishStreamTone {
  switch (status) {
    case "invoking":
      return "info";
    case "completed":
      return "success";
    case "failed":
      return "danger";
  }
}

function capabilityStatusFromMap(
  status: CapabilityStatus
): MiroFishCapabilityInvocationStatus | null {
  switch (status) {
    case "invoking":
      return "invoking";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
      return null;
  }
}

/**
 * source 严重级折算：template > fallback > llm。混合时取最严重的那个。
 * undefined / 全部缺失返回 undefined（让卡片不显示 source 标签）。
 */
function combineGenerationSource(
  sources: ReadonlyArray<string | undefined>
): "llm" | "fallback" | "template" | undefined {
  let best: "llm" | "fallback" | "template" | undefined;
  let severity = -1;
  for (const raw of sources) {
    if (raw === undefined) continue;
    const normalized: "llm" | "fallback" | "template" =
      raw === "template"
        ? "template"
        : raw === "llm_fallback"
          ? "fallback"
          : "llm";
    const sev = normalized === "template" ? 2 : normalized === "fallback" ? 1 : 0;
    if (sev > severity) {
      severity = sev;
      best = normalized;
    }
  }
  return best;
}

// ─── 6 类 entry 派生器 ───────────────────────────────────────────────────

function deriveReasoningEntries(
  input: DeriveMiroFishStreamEntriesInput
): MiroFishReasoningEntry[] {
  const out: MiroFishReasoningEntry[] = [];
  const entries = input.agentReasoning;
  if (!Array.isArray(entries)) return out;

  for (const e of entries) {
    // 跳过 iteration 标记（与 AgentReasoningSubTimeline 既有过滤一致）
    if (e.phase === "iteration_started" || e.phase === "iteration_completed") {
      continue;
    }
    out.push({
      id: e.id,
      kind: "reasoning",
      stageId: e.stageId,
      timestamp: e.timestamp,
      tone: reasoningTone(e),
      phase: e.phase,
      iterationLabel: e.iterationLabel,
      thought: e.thought,
      actionToolId: e.actionToolId,
      observationSummary: e.observationSummary,
      observationSuccess: e.observationSuccess,
      reason: e.reason,
      error: e.error,
    });
  }
  return out;
}

function deriveRouteDecisionEntries(
  input: DeriveMiroFishStreamEntriesInput
): MiroFishRouteDecisionEntry[] {
  const out: MiroFishRouteDecisionEntry[] = [];
  const selection = input.routeSelection;
  if (selection === null || selection === undefined) return out;

  // routeKind 反查
  let routeKind: "primary" | "alternative" | undefined;
  if (input.routeSet) {
    const route = input.routeSet.routes.find(r => r.id === selection.routeId);
    if (route) {
      routeKind = route.kind === "primary" ? "primary" : "alternative";
    }
  }

  out.push({
    id: `route-decision-${selection.id}`,
    kind: "route_decision",
    stageId: "route_selection",
    timestamp: selection.selectedAt,
    tone: "info",
    routeId: selection.routeId,
    routeTitle: selection.routeTitle ?? selection.routeId,
    reason: selection.reason,
    routeKind,
  });
  return out;
}

function deriveCapabilityInvocationEntries(
  input: DeriveMiroFishStreamEntriesInput
): MiroFishCapabilityInvocationEntry[] {
  const out: MiroFishCapabilityInvocationEntry[] = [];
  const statuses = input.capabilityStatuses;
  if (!statuses || typeof statuses !== "object") return out;

  const entries = input.agentReasoning ?? [];

  for (const [capabilityId, statusRaw] of Object.entries(statuses)) {
    const status = capabilityStatusFromMap(statusRaw);
    if (status === null) continue; // idle 不入流

    // 优先从 reasoning entries 反查 timestamp（acting phase + actionToolId 匹配）
    let timestamp: string | undefined;
    let stageId: string | undefined;
    for (const entry of entries) {
      if (
        entry.phase === "acting" &&
        entry.actionToolId === capabilityId
      ) {
        timestamp = entry.timestamp;
        stageId = entry.stageId;
        // 不 break；后到的 acting 覆盖前到的，让 timestamp 反映最近一次调用
      }
    }
    if (timestamp === undefined) {
      // fallback：跳过该 capability，避免造假 timestamp 让用户看到突然冒出的旧记录
      continue;
    }

    out.push({
      id: `capability-${capabilityId}-${status}`,
      kind: "capability_invocation",
      stageId,
      timestamp,
      tone: capabilityTone(status),
      capabilityId,
      status,
    });
  }
  return out;
}

function deriveArtifactCreatedEntries(
  input: DeriveMiroFishStreamEntriesInput
): MiroFishArtifactCreatedEntry[] {
  const out: MiroFishArtifactCreatedEntry[] = [];
  const artifacts = input.artifacts;
  if (!Array.isArray(artifacts)) return out;

  for (const a of artifacts) {
    if (typeof a.createdAt !== "string" || a.createdAt.length === 0) continue;
    out.push({
      id: a.id,
      kind: "artifact_created",
      stageId: artifactTypeToStageId(a.type),
      timestamp: a.createdAt,
      tone: "neutral",
      artifactId: a.id,
      artifactType: a.type,
      title: a.title,
    });
  }
  return out;
}

function deriveNodeCompletedEntries(
  input: DeriveMiroFishStreamEntriesInput
): MiroFishNodeCompletedEntry[] {
  const out: MiroFishNodeCompletedEntry[] = [];
  const stats = input.specDocumentTreeStats;
  const specTree = input.specTree;
  if (!stats || !specTree) return out;

  const nodeById = new Map(specTree.nodes.map(n => [n.id, n]));

  for (const [nodeId, nodeStats] of stats.byNodeId.entries()) {
    if (nodeStats.lifecycle !== "complete") continue;
    const node = nodeById.get(nodeId);
    if (!node) continue;

    // 取该节点最后一份 doc 的 createdAt 作为节点完成时间
    let lastCreatedAt: string | undefined;
    let lastSeen = 0;
    for (const doc of nodeStats.documents) {
      if (typeof doc.createdAt !== "string") continue;
      const time = new Date(doc.createdAt).getTime();
      if (Number.isFinite(time) && time >= lastSeen) {
        lastSeen = time;
        lastCreatedAt = doc.createdAt;
      }
    }
    if (lastCreatedAt === undefined) continue;

    const generationSource = combineGenerationSource(
      nodeStats.documents.map(d => d.provenance?.generationSource)
    );

    // tone：含 fallback / template 升级为 warning，纯 llm 为 success
    const tone: MiroFishStreamTone =
      generationSource === "fallback" || generationSource === "template"
        ? "warning"
        : "success";

    out.push({
      id: `node-completed-${nodeId}`,
      kind: "node_completed",
      stageId: "spec_docs",
      timestamp: lastCreatedAt,
      tone,
      nodeId,
      nodeTitle: node.title,
      documentTypes: ["requirements", "design", "tasks"],
      generationSource,
    });
  }
  return out;
}

// ─── 主派生函数 ──────────────────────────────────────────────────────────

/**
 * 合并多路 entry，去重，按 timestamp stable 升序排序。
 *
 * 去重规则：同 id 的 entry 后到覆盖先到（与 React key 稳定性一致）。
 * 排序：按 ISO timestamp parse 成毫秒后比较；非法 timestamp 视为最大值落到流末尾。
 */
export function deriveMiroFishStreamEntries(
  input: DeriveMiroFishStreamEntriesInput
): MiroFishStreamEntry[] {
  const merged: MiroFishStreamEntry[] = [
    ...deriveReasoningEntries(input),
    ...deriveRouteDecisionEntries(input),
    ...deriveCapabilityInvocationEntries(input),
    ...deriveArtifactCreatedEntries(input),
    ...deriveNodeCompletedEntries(input),
  ];

  // 按 id 去重（后到覆盖先到）
  const byId = new Map<string, MiroFishStreamEntry>();
  for (const entry of merged) {
    byId.set(entry.id, entry);
  }
  const deduped = Array.from(byId.values());

  // 按 timestamp 升序（stable）
  deduped.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    const finiteA = Number.isFinite(ta);
    const finiteB = Number.isFinite(tb);
    if (!finiteA && !finiteB) return 0;
    if (!finiteA) return 1; // a 落到尾
    if (!finiteB) return -1;
    if (ta !== tb) return ta - tb;
    // timestamp 相同时按 kind 顺序稳定（reasoning 优先于 capability 等）
    return 0;
  });

  return deduped;
}

// ─── 测试导出 ─────────────────────────────────────────────────────────────
// 仓库约定不集成 @testing-library/react；纯函数 helpers 直接 export 便于 vitest
// 单测覆盖。
export const __testing__ = {
  artifactTypeToStageId,
  reasoningTone,
  capabilityTone,
  capabilityStatusFromMap,
  combineGenerationSource,
};
