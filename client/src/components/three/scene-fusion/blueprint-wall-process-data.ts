/**
 * 蓝图墙面流程图数据纯函数模块。
 *
 * 把 BlueprintGenerationJob 及相关页面数据转换为 graph-ready 的墙面流程图
 * view model，供后续 `blueprint-wall-process-graph-hud-2026-05-31` spec 消费。
 *
 * 设计要点：
 *  - 纯函数：无 React、无 Zustand、无网络、无定时器、无 Date.now()、无随机。
 *  - 确定性：相同输入产出相同输出。
 *  - 阶段信号复用：唯一阶段进度来源为 `getBlueprintSceneStageSignal(job)`。
 *  - 作业隔离：所有输出仅包含当前 job 的数据。
 *
 * 注意：这些类型是 graph-ready wall view model，不是后端规范契约。
 */

import type {
  BlueprintGenerationJob,
  BlueprintRouteSet,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
  BlueprintSpecTreeNodeStatus,
} from "@shared/blueprint/contracts";
import type {
  AgentReasoningEntry,
  AgentReasoningPhase,
} from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintEffectPreviewSnapshot,
  BlueprintEffectPreviewLogEntry,
} from "@/lib/blueprint-api";
import type { AppLocale } from "@/lib/locale";
import type {
  CapabilityOwner,
  CapabilityStatus,
  RolePhase,
} from "@/lib/blueprint-realtime-store";
import {
  getBlueprintSceneStageSignal,
  BLUEPRINT_SCENE_STAGES,
  type BlueprintSceneStageSignal,
  type BlueprintSceneStageKey,
} from "./blueprint-stage-signal";

// ─── Authoritative input-contract type surface ──────────────────────────────
//
// This deriver is the single source of the wall-process input contract. The
// capability/role realtime types it consumes live in `blueprint-realtime-store`,
// but every consumer that builds `DeriveBlueprintWallProcessDataInput` (e.g.
// `Scene3D` props, `BlueprintWallProcessGraphHud` props) should import them from
// THIS module so the prop types and the deriver call can never drift apart.
// Re-exported here (alongside the locally-defined `BlueprintWallArtifactInput`)
// so a single import site carries the whole input contract.
export type {
  CapabilityOwner,
  CapabilityStatus,
  RolePhase,
} from "@/lib/blueprint-realtime-store";

interface CollectedCapabilityStatus {
  id: string;
  status: CapabilityStatus;
}

// ─── Locally-defined input types (not yet in shared contracts) ───────────────

/** Artifact input for the wall process graph. */
export interface BlueprintWallArtifactInput {
  id: string;
  title: string;
  kind: "code" | "document" | "diagram" | "log" | "other";
  isFinal?: boolean;
  jobId?: string;
}

// ─── Graph Node Types ────────────────────────────────────────────────────────

export type BlueprintWallGraphNodeType =
  | "user_goal"
  | "stage"
  | "reasoning"
  | "brainstorm"
  | "route"
  | "spec_node"
  | "capability"
  | "preview"
  | "artifact"
  | "final";

export type BlueprintWallGraphNodeStatus =
  | "empty"
  | "queued"
  | "active"
  | "ready"
  | "completed"
  | "warning"
  | "failed";

export interface BlueprintWallGraphNode {
  id: string;
  type: BlueprintWallGraphNodeType;
  title: string;
  body?: string;
  status: BlueprintWallGraphNodeStatus;
  column: number;
  row: number;
  accent?: "teal" | "purple" | "red" | "blue" | "slate";
  sourceRefs: Array<{
    kind:
      | "job"
      | "stage"
      | "reasoning"
      | "brainstorm"
      | "route"
      | "spec"
      | "capability"
      | "preview"
      | "artifact";
    id: string;
  }>;
}

// ─── Graph Edge Types ────────────────────────────────────────────────────────

export type BlueprintWallGraphEdgeKind =
  | "supports"
  | "depends_on"
  | "produces"
  | "uses_capability"
  | "refines"
  | "blocks"
  | "answers";

export interface BlueprintWallGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: BlueprintWallGraphEdgeKind;
  label?: string;
  priority: "primary" | "secondary" | "ambient";
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface BlueprintWallMetrics {
  tokenBurn?: number | null;
  sourceCount?: number | null;
  remainingPoints?: number | null;
  elapsedMs?: number | null;
  activeRoles: number;
  capabilities: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  artifacts: number;
}

// ─── Console Lines ───────────────────────────────────────────────────────────

export interface BlueprintWallConsoleLine {
  id: string;
  text: string;
  tone: "muted" | "info" | "success" | "warning" | "error";
  sourceRef?: {
    kind: "reasoning" | "preview-log";
    id: string;
  };
}

// ─── Preview Summary ─────────────────────────────────────────────────────────

export type BlueprintWallPreviewSummary =
  | {
      status: "ready";
      kind: "browser";
      previewId: string;
      title: string;
      thumbnailUrl?: string;
      url?: string;
    }
  | {
      status: "ready";
      kind: "architecture";
      previewId: string;
      title: string;
    }
  | {
      status: "empty";
      kind: "none";
      title: string;
    };

// ─── Minimap ─────────────────────────────────────────────────────────────────

export interface BlueprintWallMinimap {
  nodes: Array<{
    id: string;
    column: number;
    row: number;
    status: BlueprintWallGraphNodeStatus;
  }>;
  viewport: {
    columnStart: number;
    columnEnd: number;
    rowStart: number;
    rowEnd: number;
  };
}

// ─── Compatibility Block ─────────────────────────────────────────────────────

export interface BlueprintWallStageItem {
  key: BlueprintSceneStageKey;
  label: string;
  index: number;
  state: "completed" | "active" | "upcoming";
}

export interface BlueprintWallRouteSummary {
  totalRoutes: number;
  primaryRouteTitle: string | null;
}

export interface BlueprintWallSpecSummary {
  totalNodes: number;
  rootTitle: string | null;
}

export interface BlueprintWallCapabilitySummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
}

export interface BlueprintWallCounters {
  reasoningEntries: number;
  consoleLines: number;
  artifacts: number;
}

// ─── Main Output Interface ───────────────────────────────────────────────────

export interface BlueprintWallProcessData {
  stageSignal: BlueprintSceneStageSignal;
  nodes: BlueprintWallGraphNode[];
  edges: BlueprintWallGraphEdge[];
  metrics: BlueprintWallMetrics;
  consoleLines: BlueprintWallConsoleLine[];
  minimap: BlueprintWallMinimap;
  previewSummary: BlueprintWallPreviewSummary;
  compatibility: {
    stages: BlueprintWallStageItem[];
    routeSummary: BlueprintWallRouteSummary;
    specSummary: BlueprintWallSpecSummary;
    capabilitySummary: BlueprintWallCapabilitySummary;
    counters: BlueprintWallCounters;
  };
  emptyReason?: "no-job" | "no-blueprint-data";
}

// ─── Input Interface ─────────────────────────────────────────────────────────

export interface DeriveBlueprintWallProcessDataInput {
  job: BlueprintGenerationJob | null | undefined;
  routeSet?: BlueprintRouteSet | null;
  specTree?: BlueprintSpecTree | null;
  effectPreviews?: BlueprintEffectPreviewSnapshot[];
  agentReasoningEntries?: AgentReasoningEntry[];
  capabilityStatuses?: Record<string, CapabilityStatus>;
  capabilityOwners?: Record<string, CapabilityOwner>;
  rolePhases?: Record<string, RolePhase>;
  artifacts?: BlueprintWallArtifactInput[];
  maxReasoningNodes?: number;
  maxConsoleLines?: number;
  locale?: AppLocale;
}

// ─── Stage label helper ──────────────────────────────────────────────────────

const STAGE_LABELS: Record<BlueprintSceneStageKey, Record<AppLocale, string>> =
  {
    input: { "zh-CN": "目标输入", "en-US": "Goal Input" },
    clarification: { "zh-CN": "澄清交互", "en-US": "Clarification" },
    route_generation: { "zh-CN": "路线生成", "en-US": "Route Generation" },
    route_selection: { "zh-CN": "路线选择", "en-US": "Route Selection" },
    spec_tree: { "zh-CN": "规格树", "en-US": "Spec Tree" },
    spec_docs: { "zh-CN": "规格文档", "en-US": "Spec Docs" },
    effect_preview: { "zh-CN": "效果预览", "en-US": "Effect Preview" },
    prompt_packaging: { "zh-CN": "提示词打包", "en-US": "Prompt Packaging" },
    engineering_handoff: {
      "zh-CN": "工程交付",
      "en-US": "Engineering Handoff",
    },
  };

// ─── Reasoning node defaults ─────────────────────────────────────────────────

/**
 * 默认保留的 reasoning 图节点上限（Req 8.4）。
 *
 * 墙面是一块有限高度的 3D 画布，推理节点过多会让 reasoning/capability 列拥挤到
 * 不可读。12 是「墙面可读」与「保留足够上下文」之间的折中默认值，调用方可通过
 * `input.maxReasoningNodes` 覆盖（测试或后续 UI 调参用）。
 */
const DEFAULT_MAX_REASONING_NODES = 12;

/**
 * 默认保留的 console 行上限（Req 6.6）。
 *
 * 墙面底部的 console/reasoning 行带是一条窄条，过多行会挤压可读性。8 行是
 * 「墙面可读」与「保留最近上下文」之间的折中默认值，调用方可通过
 * `input.maxConsoleLines` 覆盖（测试或后续 UI 调参用）。
 */
const DEFAULT_MAX_CONSOLE_LINES = 8;

/** reasoning 节点所在的列（design 建议方案：列 3 = reasoning / capability）。 */
const REASONING_COLUMN = 3;

/**
 * user_goal 节点所在的列与行（design 建议方案：列 0 = user goal / input）。
 *
 * 列 0 row 0 已被阶段主干节点 `stage:input` 占用（见 buildStageNodes 的布局规则）。
 * 为避免与主干重叠，user_goal 节点固定放在列 0、row 1（输入列内、主干行下方一行）。
 */
const USER_GOAL_COLUMN = 0;
const USER_GOAL_ROW = 1;

/**
 * route 节点所在的列（design 建议方案：列 1 = clarification / route）。
 *
 * 列 1 row 0 已被阶段主干节点 `stage:clarification` 占用，为避免重叠，route 节点的
 * row 从 1 起按确定性顺序堆叠（`row: 已生成 route 节点数 + 1`）。
 */
const ROUTE_COLUMN = 1;

/**
 * spec 节点所在的列（design 建议方案：列 2 = spec / documents）。
 *
 * 列 2 row 0 已被阶段主干节点占用（buildStageNodes 把第 index 个阶段放到
 * `column: index`，列 2 对应 `BLUEPRINT_SCENE_STAGES[2]` = `route_generation`）。为
 * 避免与主干重叠，spec 节点的 row 从 1 起按确定性顺序堆叠（`row: index + 1`）：root
 * 节点占 row 1，其直接子节点依次占 row 2、3、…。
 */
const SPEC_COLUMN = 2;

const BRAINSTORM_COLUMN = REASONING_COLUMN;
const MAX_BRAINSTORM_BRANCH_NODES = 8;
const MIN_BRAINSTORM_BRANCH_NODES = 3;

/** user_goal 节点正文最大字符数，超出则截断以保持墙面可读（Req 4.7）。 */
const USER_GOAL_BODY_MAX = 200;

/** route 节点正文最大字符数，超出则截断以保持墙面可读（Req 4.6）。 */
const ROUTE_BODY_MAX = 160;

/** spec 节点正文最大字符数，超出则截断以保持墙面可读（Req 4.6）。 */
const SPEC_BODY_MAX = 160;

/** user_goal 节点的本地化短标签。 */
const USER_GOAL_LABELS: Record<AppLocale, string> = {
  "zh-CN": "用户目标",
  "en-US": "User Goal",
};

/** 默认空 route summary，用于无 job / 无 routeSet 场景。 */
const DEFAULT_ROUTE_SUMMARY: BlueprintWallRouteSummary = {
  totalRoutes: 0,
  primaryRouteTitle: null,
};

/** 默认空 spec summary，用于无 job / 无 specTree 场景。 */
const DEFAULT_SPEC_SUMMARY: BlueprintWallSpecSummary = {
  totalNodes: 0,
  rootTitle: null,
};

/** 默认空 capability summary，用于无 job / 无 capability 数据场景。 */
const DEFAULT_CAPABILITY_SUMMARY: BlueprintWallCapabilitySummary = {
  total: 0,
  running: 0,
  completed: 0,
  failed: 0,
};

/**
 * capability 节点所在的列（design 建议方案：列 3 = reasoning / capability）。
 *
 * capability 与 reasoning 共享列 3（reasoning / capability lane）。本数据层只产出
 * 确定性的 column / row 提示，真正的像素布局由后续 visual spec 完成——visual spec 会
 * 在列 3 内为 reasoning 与 capability 再分子道（sublane）。因此这里允许 capability 与
 * reasoning 的 row 取值范围重叠，不在数据层强行错开（exact non-overlap 非强制要求）。
 */
const CAPABILITY_COLUMN = REASONING_COLUMN;

/** capability 节点正文（owner 角色标签）最大字符数，超出则截断以保持墙面可读。 */
const CAPABILITY_BODY_MAX = 80;

/**
 * preview 节点所在的列与行（design 建议方案：列 4 = preview / handoff / final）。
 *
 * 列 4 row 0 已被阶段主干节点占用（buildStageNodes 把第 index 个阶段放到
 * `column: index`，列 4 对应 `BLUEPRINT_SCENE_STAGES[4]` = `spec_tree`）。为避免与
 * 主干重叠，preview 节点固定放在列 4、row 1。后续 handoff / final 节点会在该列继续
 * 向下堆叠（由后续任务负责）。
 */
const PREVIEW_COLUMN = 4;
const PREVIEW_ROW = 1;

/** browser preview 节点的本地化短标签（browserPreview.title 缺失时兜底）。 */
const PREVIEW_BROWSER_LABELS: Record<AppLocale, string> = {
  "zh-CN": "浏览器预览",
  "en-US": "Browser Preview",
};

/** architecture preview fallback 的本地化短标签。 */
const PREVIEW_ARCHITECTURE_LABELS: Record<AppLocale, string> = {
  "zh-CN": "架构草图",
  "en-US": "Architecture Draft",
};

/** 空 preview 状态的本地化短标签（Req 7.4）。 */
const PREVIEW_EMPTY_LABELS: Record<AppLocale, string> = {
  "zh-CN": "暂无预览",
  "en-US": "No Preview",
};

/**
 * artifact / final 节点所在的列（design 建议方案：列 4 = preview / handoff / final）。
 *
 * 列 4 row 0 已被阶段主干节点占用，row 1 已被 preview 节点占用（见 PREVIEW_ROW）。为
 * 避免与二者重叠，artifact 节点从 row `ARTIFACT_ROW_START`（=2）起按确定性顺序向下
 * 堆叠（见 buildArtifactNodes），final 节点再放在所有 artifact 节点之后一行
 * （见 buildFinalNode）。artifact / preview / final 共用列 4。
 */
const ARTIFACT_COLUMN = PREVIEW_COLUMN;

/**
 * artifact 节点起始行（Req 4.8）。
 *
 * 列 4 row 0 = 阶段主干节点、row 1 = preview 节点，因此 artifact 节点从 row 2 起堆叠，
 * 第 index 个 artifact 节点占 `row: index + ARTIFACT_ROW_START`（index 为「已发出的
 * artifact 节点序号」，跳过被选作 final 的 artifact，保证行号连续不留空洞）。
 */
const ARTIFACT_ROW_START = 2;

/**
 * final 节点标题兜底（Req 4.9）。
 *
 * 当被选作终端结果的 artifact 自身缺少可用 title 时，使用该本地化短标签。
 */
const FINAL_LABELS: Record<AppLocale, string> = {
  "zh-CN": "最终交付",
  "en-US": "Final Handoff",
};

/**
 * 已知阶段 key 集合，用于判断 `entry.stageId` 是否对应某个真实阶段节点。
 *
 * 仅当 `entry.stageId` 命中该集合时，reasoning 节点才追加一条 `kind: "stage"` 的
 * source ref，供后续 Task 5 的 edge 派生使用；未知 / 缺失 stageId 不臆测关系。
 */
const KNOWN_STAGE_KEYS: ReadonlySet<string> = new Set<string>(
  BLUEPRINT_SCENE_STAGES
);

// ─── Main Deriver Function ───────────────────────────────────────────────────

/**
 * 把蓝图作业及相关页面数据转换为 graph-ready 的墙面流程图 view model。
 *
 * 容错规则：
 *  - `input.job` 为 null / undefined → 返回安全空数据，`emptyReason = "no-job"`。
 *  - 所有可选数组缺失 → 视为空数组。
 *  - 该函数零副作用、零 hook、确定性输出。
 */
export function deriveBlueprintWallProcessData(
  input: DeriveBlueprintWallProcessDataInput
): BlueprintWallProcessData {
  const stageSignal = getBlueprintSceneStageSignal(input.job);
  const locale = input.locale ?? "zh-CN";

  // Build compatibility stage items
  const stages: BlueprintWallStageItem[] = BLUEPRINT_SCENE_STAGES.map(
    (key, index) => ({
      key,
      label: STAGE_LABELS[key][locale],
      index,
      state: deriveStageState(index, stageSignal.stageIndex),
    })
  );

  // Safe empty output when no job: without a job there is no process backbone,
  // so the no-job graph stays empty (keeps the Task 1.2 null-job contract). The
  // route summary stays at its default here because there is no current job to
  // scope routes to (Req 3 job isolation).
  if (!input.job) {
    return buildOutput(
      stageSignal,
      stages,
      [],
      [],
      0,
      [],
      DEFAULT_ROUTE_SUMMARY,
      DEFAULT_SPEC_SUMMARY,
      DEFAULT_CAPABILITY_SUMMARY,
      emptyPreviewSummary(locale),
      // No-job means there is no current job context, so metrics stay at a clean
      // zero/null baseline: activeRoles 0, capabilities all 0, artifacts 0,
      // telemetry null (Req 6.3). rolePhases is intentionally not consulted here.
      buildMetrics(undefined, DEFAULT_CAPABILITY_SUMMARY, 0),
      "no-job"
    );
  }

  // A job exists, so the stage backbone is always generated. Stage nodes are the
  // process spine that later node types (reasoning / route / capability / ...)
  // will branch off from. Their state derives purely from stageSignal.stageIndex
  // (via the same `stages` compatibility items), never from a new stage switch.
  const stageNodes = buildStageNodes(stages);

  // Stage-order edges form the primary backbone (spine) of the wall graph: each
  // adjacent pair of stages in BLUEPRINT_SCENE_STAGES order is connected with a
  // `depends_on` edge (Req 5.1-5.4). They are derived purely from the stage
  // order constant, so they are deterministic and reused on every job-present
  // path (both no-blueprint-data and has-data paths have stage nodes). More edge
  // kinds (route/spec/preview/capability/answers) are added in Task 5.2.
  const stageOrderEdges = buildStageOrderEdges();

  // user_goal node: created only when the job exposes usable user-intent text
  // (`request.targetText`, trimmed non-empty). Missing text → no fabricated node
  // (Req 4.7). It lives in the input column (0) above the stage backbone.
  const userGoalNode = buildUserGoalNode(input.job, locale);

  // Route nodes + compatibility route summary derive from the current routeSet
  // (Req 4.6). Computed once and reused so nodes and the summary stay consistent.
  const routeNodes = buildRouteNodes(input.routeSet);
  const routeSummary = buildRouteSummary(input.routeSet);

  // Spec nodes + compatibility spec summary derive from the current specTree
  // (Req 4.6). The wall is bounded, so spec nodes are the root plus its direct
  // children only (see buildSpecNodes). The summary still reports the full node
  // count, so nodes and the summary are computed from the same specTree input.
  const specNodes = buildSpecNodes(input.specTree);
  const specSummary = buildSpecSummary(input.specTree);

  // Capability nodes + compatibility capability summary derive from the current
  // capabilityStatuses (Req 4.6). Owner attribution uses real capabilityOwners
  // only; an off-stage / unknown real owner is never replaced by a guess
  // (Req 5.6). Nodes and the summary are computed from the same input map so
  // they stay consistent.
  const capabilityNodes = buildCapabilityNodes(
    input.capabilityStatuses,
    input.capabilityOwners
  );
  const capabilitySummary = buildCapabilitySummary(input.capabilityStatuses);

  // Current-job reasoning isolation (Req 3.1): only entries whose `jobId`
  // matches the current `job.id` participate. The full filtered list drives the
  // compatibility counter; the capped subset drives the reasoning graph nodes.
  const filteredReasoning = filterCurrentJobReasoning(
    input.agentReasoningEntries,
    input.job.id
  );
  const brainstormNodes = buildBrainstormNodes(
    input.rolePhases,
    filteredReasoning,
    locale
  );

  // Default `maxReasoningNodes` keeps the wall readable (Req 8.4); callers may
  // override it for tests / later UI tuning.
  const maxReasoningNodes = input.maxReasoningNodes ?? DEFAULT_MAX_REASONING_NODES;
  const reasoningNodes = buildReasoningNodes(
    input.agentReasoningEntries,
    input.job.id,
    maxReasoningNodes
  );

  const includedArtifacts = collectCurrentJobArtifacts(
    input.artifacts,
    input.job.id
  );
  const currentJobPreviewCount = countCurrentJobEffectPreviews(
    input.effectPreviews,
    input.job.id
  );

  // If job exists but no meaningful data, still return the stage backbone only.
  // capabilityStatuses counts as blueprint data: when present (non-empty), the
  // has-data path runs so capability nodes and the capability summary are
  // derived from the same input map (Req 8.2 consistency).
  const hasData =
    filteredReasoning.length > 0 ||
    input.routeSet ||
    input.specTree ||
    brainstormNodes.length > 0 ||
    currentJobPreviewCount > 0 ||
    includedArtifacts.length > 0 ||
    hasCapabilityStatuses(input.capabilityStatuses);

  if (!hasData) {
    // No blueprint data → no reasoning entries and no current-job previews, so
    // console lines are naturally empty here. The stage backbone is still the
    // spine, and the user_goal node is still shown when targetText exists (a job
    // with only a goal and no routes/specs/reasoning still hits this path, since
    // targetText lives in `request` and is not part of the `hasData` check).
    // Order: [userGoalNode?, ...stageNodes] keeps the input goal before the
    // backbone. Route summary stays at default because there is no routeSet here.
    const baseNodes = userGoalNode
      ? [userGoalNode, ...stageNodes]
      : stageNodes;
    return buildOutput(
      stageSignal,
      stages,
      baseNodes,
      stageOrderEdges,
      0,
      [],
      DEFAULT_ROUTE_SUMMARY,
      DEFAULT_SPEC_SUMMARY,
      DEFAULT_CAPABILITY_SUMMARY,
      emptyPreviewSummary(locale),
      // A job exists here, so compute activeRoles from the current rolePhases
      // input. capabilityStatuses is empty on this path (a non-empty map would
      // have routed through the has-data branch), so capabilities stay at the
      // default zero summary and artifacts is 0; telemetry stays null (Req 6.3).
      buildMetrics(input.rolePhases, DEFAULT_CAPABILITY_SUMMARY, 0),
      "no-blueprint-data"
    );
  }

  // Default `maxConsoleLines` keeps the bottom console band wall-readable
  // (Req 6.6); callers may override it for tests / later UI tuning. Console
  // lines combine current-job reasoning entries with current-job effect-preview
  // log timelines (Req 6.4 / 6.5).
  const maxConsoleLines = input.maxConsoleLines ?? DEFAULT_MAX_CONSOLE_LINES;
  const consoleLines = buildConsoleLines(input, input.job.id, maxConsoleLines);

  // previewSummary derives from current-job effect previews (Req 3.2 / 7.1-7.4):
  // browser preview (non-empty trimmed url) is preferred, architecture draft is
  // the fallback, otherwise an explicit localized empty state. When ready, it
  // also emits a `preview` graph node (Req 4.6).
  const previewSummary = buildPreviewSummary(
    input.effectPreviews,
    input.job.id,
    locale
  );
  const previewNode = buildPreviewNode(previewSummary);

  // Current-job artifact scoping (Req 3 / 8.2): collect the artifacts that
  // belong to the current job once, then split them into regular artifact nodes
  // and a single terminal `final` node (Req 4.8 / 4.9). The full included count
  // (artifact nodes + final node) feeds both `metrics.artifacts` and
  // `compatibility.counters.artifacts` so the graph and summaries stay
  // consistent (Req 6.2 / 8.1-8.3).
  const finalArtifactIndex = pickFinalArtifactIndex(includedArtifacts);
  const artifactNodes = buildArtifactNodes(includedArtifacts, finalArtifactIndex);
  const finalNode = buildFinalNode(
    includedArtifacts,
    finalArtifactIndex,
    artifactNodes.length,
    locale
  );
  const artifactCount = includedArtifacts.length;

  // The graph contains an optional user_goal node, the stage backbone,
  // current-job route nodes, current-job spec nodes, current-job capability
  // nodes, current-job reasoning nodes, an optional preview node, current-job
  // artifact nodes, and an optional terminal final node. Graph edges (stage
  // spine + known relationships) are derived right after, from this node set.
  // Deterministic order:
  //   [userGoalNode?, ...stageNodes, ...routeNodes, ...specNodes,
  //    ...capabilityNodes, ...reasoningNodes, previewNode?, ...artifactNodes,
  //    finalNode?]
  // keeps the input goal first, the stage spine next, then routes, then specs,
  // then capabilities, then reasoning, then the preview branch node, then the
  // produced artifacts, and finally the terminal handoff node. Graph edges are
  // derived right after, from this assembled node set.
  const nodes = [
    ...(userGoalNode ? [userGoalNode] : []),
    ...stageNodes,
    ...routeNodes,
    ...specNodes,
    ...brainstormNodes,
    ...capabilityNodes,
    ...reasoningNodes,
    ...(previewNode ? [previewNode] : []),
    ...artifactNodes,
    ...(finalNode ? [finalNode] : []),
  ];

  // Graph edges = stage backbone (spine) first, then known relationship edges.
  // Stage-order edges are the primary spine (Req 5.1-5.4); relationship edges
  // hang route/spec/preview/reasoning/artifact/final nodes back onto known stage
  // nodes or onto the terminal final node, omitting uncertain relationships
  // instead of guessing (Req 5.5-5.8). Relationship edges only emit when both
  // endpoint nodes exist, so they are added only on the has-data path (the
  // no-blueprint-data path has no such nodes and would produce none anyway).
  const edges = [
    ...stageOrderEdges,
    ...buildRelationshipEdges(nodes),
    ...buildBrainstormEdges(nodes),
  ];

  return buildOutput(
    stageSignal,
    stages,
    nodes,
    edges,
    filteredReasoning.length,
    consoleLines,
    routeSummary,
    specSummary,
    capabilitySummary,
    previewSummary,
    // Compute metrics from the current-job inputs: activeRoles from rolePhases,
    // capabilities reuses the same capabilitySummary that feeds the compatibility
    // block (Req 8.2), and artifacts is the included current-job artifact count.
    buildMetrics(input.rolePhases, capabilitySummary, artifactCount),
    undefined
  );
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function deriveStageState(
  stageIndex: number,
  currentStageIndex: number
): "completed" | "active" | "upcoming" {
  if (stageIndex < currentStageIndex) return "completed";
  if (stageIndex === currentStageIndex) return "active";
  return "upcoming";
}

/**
 * 把 compatibility 阶段项映射为图节点状态。
 *
 * stage `state` 已由 `deriveStageState` 从 `stageSignal.stageIndex` 派生，这里
 * 只做 `state` → `BlueprintWallGraphNodeStatus` 的纯映射，不引入第二套阶段索引
 * 计算或后端 stage 别名开关（对应 AC 2.2 / 2.3 / 2.4）：
 *  - completed → "completed"
 *  - active    → "active"
 *  - upcoming  → "queued"（墙面 graph 状态枚举里没有 "upcoming"，未来 / 空阶段
 *               统一落到 "queued"）
 */
function mapStageStateToNodeStatus(
  state: "completed" | "active" | "upcoming"
): BlueprintWallGraphNodeStatus {
  if (state === "completed") return "completed";
  if (state === "active") return "active";
  return "queued";
}

/**
 * 由 compatibility 阶段项生成阶段图节点（流程主干）。
 *
 * 布局规则（确定性）：阶段节点构成流程主干，沿列方向逐段铺开，因此使用
 * `column: index`（0..8）、`row: 0`，每个阶段独占一列、同处主干行。后续任务派生
 * 的 reasoning / route / capability 等节点会分布到其它行，避免与主干重叠。
 *
 * 节点 id 使用稳定的 `stage:${stageKey}`，状态由 `stageSignal.stageIndex` 派生的
 * `state` 映射而来，不新增后端 stage 开关。
 */
function buildStageNodes(
  stages: BlueprintWallStageItem[]
): BlueprintWallGraphNode[] {
  return stages.map((stage) => ({
    id: `stage:${stage.key}`,
    type: "stage" as const,
    title: stage.label,
    status: mapStageStateToNodeStatus(stage.state),
    // Deterministic backbone layout: one stage per column, all on the spine row.
    column: stage.index,
    row: 0,
    sourceRefs: [{ kind: "stage" as const, id: stage.key }],
  }));
}

// ─── Stage Order Edges ───────────────────────────────────────────────────────

/**
 * 由 BLUEPRINT_SCENE_STAGES 顺序生成阶段主干（spine）edges（Req 5.1 / 5.2 / 5.3 /
 * 5.4）。
 *
 * 阶段主干是整张墙面流程图的主脊：把相邻阶段节点按 BLUEPRINT_SCENE_STAGES 的固定
 * 顺序依次用 `depends_on` 连接，表达「后一阶段依赖前一阶段」的流程顺序（Req 5.4）。
 *
 * Edge 规则：
 *  - id：稳定确定性的 `edge:stage-order:${prevKey}->${nextKey}`。
 *  - from：`stage:${prevKey}`；to：`stage:${nextKey}`（与 buildStageNodes 的稳定
 *    stage 节点 id 对齐）。
 *  - kind："depends_on"。
 *  - priority："primary"——阶段主干是墙面流程图的主脊（primary spine）。
 *
 * 共产出 `BLUEPRINT_SCENE_STAGES.length - 1`（= 8）条 edge。该 helper 不依赖 job /
 * 输入数据，纯由阶段顺序常量派生，因此完全确定性。仅在存在阶段节点（job-present
 * 路径）时接入输出；no-job 路径无阶段节点，故无 edge。其它 edge 种类（route / spec /
 * preview / reasoning / answers）由 `buildRelationshipEdges` 在 has-data 路径补充。
 */
function buildStageOrderEdges(): BlueprintWallGraphEdge[] {
  const edges: BlueprintWallGraphEdge[] = [];
  for (let index = 0; index < BLUEPRINT_SCENE_STAGES.length - 1; index += 1) {
    const prevKey = BLUEPRINT_SCENE_STAGES[index];
    const nextKey = BLUEPRINT_SCENE_STAGES[index + 1];
    edges.push({
      id: `edge:stage-order:${prevKey}->${nextKey}`,
      from: `stage:${prevKey}`,
      to: `stage:${nextKey}`,
      kind: "depends_on" as const,
      priority: "primary" as const,
    });
  }
  return edges;
}

// ─── Relationship Edges ──────────────────────────────────────────────────────

/**
 * 由已构建好的图节点集合派生「已知关系」edges（Req 5.5 / 5.6 / 5.7 / 5.8）。
 *
 * 与 `buildStageOrderEdges`（阶段主干 spine）互补：本 helper 负责把 route / spec /
 * preview / reasoning / artifact / final 等节点挂回到流程主干或彼此之间，但**只在关系
 * 确定可知时**连边，任何不确定关系一律省略而非臆测（Req 5.7）。
 *
 * 仅在 has-data 路径接入：no-job / no-blueprint-data 路径没有 route/spec/preview/...
 * 节点，本 helper 在那里也只会产出空数组，但为稳妥仅在 has-data 路径调用。
 *
 * 确定性保证：
 *  - 入参 `nodes` 已是确定性顺序（见 deriveBlueprintWallProcessData 的节点拼装），本
 *    helper 按 `nodes` 顺序遍历产出 edges，因此输出顺序确定。
 *  - 所有 edge id 稳定且可预测（基于稳定的节点 id 派生）。
 *  - 关键不变量：只有当一条 edge 的两个端点节点都存在于 `nodes` 中时才发出该 edge。
 *    用 `nodeIds` Set 做存在性检查。
 *
 * 产出的已知关系 edges：
 *  1. user_goal → stage:input（"supports" / secondary）：用户目标喂入输入阶段。
 *  2. 每个 route 节点 → stage:route_generation（"supports" / secondary）：route 的
 *     「最近已知阶段」选 route_generation——路线在 route_generation 阶段被**生成**，
 *     route_selection 只是后续的选择阶段，因此生成阶段才是 route 节点的来源阶段。
 *  3. 每个 spec 节点 → stage:spec_tree（"supports" / secondary）。
 *  4. stage:effect_preview → preview 节点（"produces" / secondary）：effect_preview
 *     阶段**产出**预览（方向为 stage → preview，即预览生产边）。
 *  5. capability → stage：**整体省略**（Req 5.6 / 5.7）。输入里没有可靠的
 *     capability→stage 映射：`capabilityOwners` 只把 capability 映射到「角色」，而角色
 *     在本图里并不存在为独立图节点，stage 归属无从可靠得知。按 Req 5.6「不臆造
 *     ownership」与 Req 5.7「省略不确定关系」，这里不发明任何 capability→stage 边。
 *  6. 每个带「已知 stage source ref」的 reasoning 节点 → 由 stage 节点连入
 *     （stage → reasoning，"supports" / ambient）。仅当 reasoning 节点的 sourceRefs
 *     含 `{ kind: "stage", id }` 且对应 `stage:${id}` 节点存在时才连边；没有已知 stage
 *     source ref 的 reasoning 节点不臆测其阶段（Req 5.7）。
 *  7. answers edges 连入终端 final 节点（Req 5.8）：从已知支撑 final 的「具体产出
 *     证据」连入——所有 artifact 节点（"answers" / secondary）与 preview 节点
 *     （"answers" / ambient）。reasoning→final 关系不确定，故省略（Req 5.7）。
 */
function buildRelationshipEdges(
  nodes: BlueprintWallGraphNode[]
): BlueprintWallGraphEdge[] {
  const edges: BlueprintWallGraphEdge[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const hasNode = (id: string): boolean => nodeIds.has(id);

  // 1. user_goal → stage:input（Req 5.5）：用户目标支撑/喂入输入阶段。
  const userGoalNode = nodes.find((node) => node.type === "user_goal");
  if (userGoalNode && hasNode("stage:input")) {
    const jobId = userGoalNode.id.slice("user_goal:".length);
    edges.push({
      id: `edge:goal-stage:${jobId}`,
      from: userGoalNode.id,
      to: "stage:input",
      kind: "supports" as const,
      priority: "secondary" as const,
    });
  }

  // 2. route 节点 → stage:route_generation（Req 5.5）：路线在 route_generation 阶段
  //    被生成，故这是 route 的「最近已知阶段」（route_selection 是后续选择阶段）。
  if (hasNode("stage:route_generation")) {
    for (const node of nodes) {
      if (node.type !== "route") continue;
      const routeId = node.id.slice("route:".length);
      edges.push({
        id: `edge:route-stage:${routeId}`,
        from: node.id,
        to: "stage:route_generation",
        kind: "supports" as const,
        priority: "secondary" as const,
      });
    }
  }

  // 3. spec 节点 → stage:spec_tree（Req 5.5）。
  if (hasNode("stage:spec_tree")) {
    for (const node of nodes) {
      if (node.type !== "spec_node") continue;
      edges.push({
        id: `edge:spec-stage:${node.id}`,
        from: node.id,
        to: "stage:spec_tree",
        kind: "supports" as const,
        priority: "secondary" as const,
      });
    }
  }

  // 4. stage:effect_preview → preview 节点（Req 5.5）：effect_preview 阶段产出预览。
  //    方向为 stage → preview（预览生产边，供 Task 5.3 测试断言）。
  const previewNode = nodes.find((node) => node.type === "preview");
  if (previewNode && hasNode("stage:effect_preview")) {
    const previewId = previewNode.id.slice("preview:".length);
    edges.push({
      id: `edge:preview-stage:${previewId}`,
      from: "stage:effect_preview",
      to: previewNode.id,
      kind: "produces" as const,
      priority: "secondary" as const,
    });
  }

  // 5. capability → stage：整体省略（Req 5.6 / 5.7）。输入无可靠的 capability→stage
  //    映射（capabilityOwners 只到角色，角色非图节点），故不臆造 capability 阶段归属。

  // 6. reasoning 节点 ← 其已知 stage（Req 5.5 / 5.7）：仅当 reasoning 节点带
  //    `{ kind: "stage" }` source ref 且该 stage 节点存在时连边，方向 stage → reasoning。
  for (const node of nodes) {
    if (node.type !== "reasoning") continue;
    const stageRef = node.sourceRefs.find((ref) => ref.kind === "stage");
    if (!stageRef) continue;
    const stageNodeId = `stage:${stageRef.id}`;
    if (!hasNode(stageNodeId)) continue;
    edges.push({
      id: `edge:reasoning-stage:${node.id}`,
      from: stageNodeId,
      to: node.id,
      kind: "supports" as const,
      priority: "ambient" as const,
    });
  }

  // 7. answers edges 连入 final 节点（Req 5.8）：artifact / preview 是支撑终端交付的
  //    具体产出证据。reasoning→final 不确定，省略（Req 5.7）。
  const finalNode = nodes.find((node) => node.type === "final");
  if (finalNode) {
    const finalId = finalNode.id.slice("final:".length);
    for (const node of nodes) {
      if (node.type !== "artifact") continue;
      const artifactId = node.id.slice("artifact:".length);
      edges.push({
        id: `edge:answers-artifact:${artifactId}->${finalId}`,
        from: node.id,
        to: finalNode.id,
        kind: "answers" as const,
        priority: "secondary" as const,
      });
    }
    if (previewNode) {
      const previewId = previewNode.id.slice("preview:".length);
      edges.push({
        id: `edge:answers-preview:${previewId}->${finalId}`,
        from: previewNode.id,
        to: finalNode.id,
        kind: "answers" as const,
        priority: "ambient" as const,
      });
    }
  }

  return edges;
}

// ─── User Goal Node ──────────────────────────────────────────────────────────

/**
 * 由当前 job 生成可选的 user_goal 图节点（Req 4.7）。
 *
 * 数据源：`job.request.targetText`（用户意图文本）。该字段是 optional 的，缺失 /
 * 非字符串 / trim 后为空时不臆造节点，优雅跳过返回 undefined。
 *
 * 节点规则：
 *  - id：稳定的 `user_goal:${job.id}`。
 *  - status："completed"——用户目标在作业创建时即已给定，不是待执行步骤。
 *  - body：targetText（trim 后），超过 USER_GOAL_BODY_MAX 时截断，保持墙面可读。
 *  - 布局：输入列（列 0），row 1（避开列 0 row 0 的 `stage:input` 主干节点）。
 *  - sourceRefs：指向 job 本身。
 */
function buildBrainstormEdges(
  nodes: BlueprintWallGraphNode[]
): BlueprintWallGraphEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has("stage:spec_tree") || !nodeIds.has("stage:spec_docs")) {
    return [];
  }

  const brainstormNodes = nodes.filter((node) => node.type === "brainstorm");
  if (brainstormNodes.length === 0) return [];

  const edges: BlueprintWallGraphEdge[] = [];
  for (const node of brainstormNodes) {
    const brainstormId = node.id.slice("brainstorm:".length);
    edges.push({
      id: `edge:brainstorm-fanout:${brainstormId}`,
      from: "stage:spec_tree",
      to: node.id,
      kind: "supports" as const,
      priority: "secondary" as const,
    });
    edges.push({
      id: `edge:brainstorm-converge:${brainstormId}`,
      from: node.id,
      to: "stage:spec_docs",
      kind: "refines" as const,
      priority: "ambient" as const,
    });
  }

  return edges;
}

function buildUserGoalNode(
  job: BlueprintGenerationJob,
  locale: AppLocale
): BlueprintWallGraphNode | undefined {
  const rawTargetText = job.request?.targetText;
  if (typeof rawTargetText !== "string") return undefined;

  const targetText = rawTargetText.trim();
  if (targetText.length === 0) return undefined;

  return {
    id: `user_goal:${job.id}`,
    type: "user_goal" as const,
    title: USER_GOAL_LABELS[locale],
    body: truncateForWall(targetText, USER_GOAL_BODY_MAX),
    status: "completed" as const,
    column: USER_GOAL_COLUMN,
    row: USER_GOAL_ROW,
    accent: "teal" as const,
    sourceRefs: [{ kind: "job" as const, id: job.id }],
  };
}

// ─── Route Nodes ─────────────────────────────────────────────────────────────

/**
 * 由当前 routeSet 生成 route 图节点（Req 4.6）。
 *
 * 防御性规则：`routeSet` 缺失 / 非对象、`routeSet.routes` 非数组 → 返回空数组；
 * 逐项跳过 null / 非对象、缺失 `id` 的脏数据。保持输入顺序（不排序），保证确定性。
 *
 * 节点规则：
 *  - id：稳定的 `route:${route.id}`。
 *  - title：route.title；body：route.summary（截断到 ROUTE_BODY_MAX）。
 *  - status：主路线（`route.id === routeSet.primaryRouteId`）→ "active"，
 *    其余 → "queued"（确定性映射）。
 *  - 布局：路线列（列 1），row 从 1 起递增以避开列 1 row 0 的 `stage:clarification`
 *    主干节点。
 *  - accent："blue"（确定性，路线统一色）。
 *  - sourceRefs：指向 route 本身。
 */
function buildRouteNodes(
  routeSet: BlueprintRouteSet | null | undefined
): BlueprintWallGraphNode[] {
  if (!routeSet || typeof routeSet !== "object") return [];
  const routes = routeSet.routes;
  if (!Array.isArray(routes)) return [];

  const primaryRouteId = routeSet.primaryRouteId;
  const nodes: BlueprintWallGraphNode[] = [];

  for (const route of routes) {
    if (!route || typeof route !== "object") continue;
    if (typeof route.id !== "string" || route.id.length === 0) continue;

    const node: BlueprintWallGraphNode = {
      id: `route:${route.id}`,
      type: "route" as const,
      title: typeof route.title === "string" ? route.title : route.id,
      status: route.id === primaryRouteId ? "active" : "queued",
      // 路线列；row 从 1 起以避开列 1 row 0 的阶段节点。
      column: ROUTE_COLUMN,
      row: nodes.length + 1,
      accent: "blue" as const,
      sourceRefs: [{ kind: "route" as const, id: route.id }],
    };

    if (typeof route.summary === "string" && route.summary.length > 0) {
      node.body = truncateForWall(route.summary, ROUTE_BODY_MAX);
    }

    nodes.push(node);
  }

  return nodes;
}

/**
 * 由当前 routeSet 生成 compatibility route summary（Req 4.6 / 8.1 / 8.2）。
 *
 * 防御性规则：`routeSet` 缺失 / 非对象、`routes` 非数组 → 返回默认空摘要。
 *  - totalRoutes：routes 数组长度。
 *  - primaryRouteTitle：id === primaryRouteId 的 route 标题，找不到则 null。
 */
function buildRouteSummary(
  routeSet: BlueprintRouteSet | null | undefined
): BlueprintWallRouteSummary {
  if (!routeSet || typeof routeSet !== "object") return DEFAULT_ROUTE_SUMMARY;
  const routes = routeSet.routes;
  if (!Array.isArray(routes)) return DEFAULT_ROUTE_SUMMARY;

  const primaryRoute = routes.find(
    (route) =>
      route &&
      typeof route === "object" &&
      route.id === routeSet.primaryRouteId
  );

  return {
    totalRoutes: routes.length,
    primaryRouteTitle:
      primaryRoute && typeof primaryRoute.title === "string"
        ? primaryRoute.title
        : null,
  };
}

// ─── Spec Nodes ──────────────────────────────────────────────────────────────

/**
 * 由当前 specTree 生成 spec 图节点（Req 4.6）。
 *
 * 墙面是一块有限高度的 3D 画布，不能把整棵 spec 树的每个节点都铺到墙上。这里采用
 * 确定性的「root + 直接子节点」裁剪策略：
 *  1. 先按 `specTree.rootNodeId` 找到 root 节点并发出；
 *  2. 再发出 `parentId === specTree.rootNodeId` 的顶层节点（root 的直接子节点）。
 *
 * 选择「`parentId === rootNodeId`」而不是「读 root.children 数组」是因为前者只依赖每
 * 个节点自身的 parentId，对 children 数组缺失 / 不一致的脏数据更健壮；两种方式在数据
 * 一致时等价。顶层子节点保持 `nodes` 数组中的原始顺序（不排序），保证确定性。
 *
 * 防御性规则：`specTree` 缺失 / 非对象、`nodes` 非数组 → 返回空数组；逐项跳过 null /
 * 非对象、缺失 `id` 的脏数据；找不到 root 节点时返回空数组（无主干则不臆造顶层）。
 *
 * 节点规则：
 *  - id：稳定的 `spec:${node.id}`。
 *  - title：node.title；body：node.summary（截断到 SPEC_BODY_MAX）。
 *  - status：由 spec 节点 status 确定性映射（见 mapSpecNodeStatusToNodeStatus）。
 *  - 布局：spec/documents 列（列 2），row 从 1 起（`row: index + 1`，root 占 row 1）
 *    以避开列 2 row 0 的阶段主干节点。
 *  - accent："purple"（确定性，spec 统一色）。
 *  - sourceRefs：指向 spec 节点本身。
 */
function buildSpecNodes(
  specTree: BlueprintSpecTree | null | undefined
): BlueprintWallGraphNode[] {
  if (!specTree || typeof specTree !== "object") return [];
  const treeNodes = specTree.nodes;
  if (!Array.isArray(treeNodes)) return [];

  const rootNodeId = specTree.rootNodeId;
  const rootNode = treeNodes.find(
    (node) =>
      node &&
      typeof node === "object" &&
      typeof node.id === "string" &&
      node.id === rootNodeId
  );
  // 没有可识别的 root 节点 → 不臆造顶层节点。
  if (!rootNode) return [];

  // 顶层节点 = root 节点 + parentId === rootNodeId 的直接子节点，保持输入顺序。
  const topLevelNodes: BlueprintSpecTreeNode[] = [rootNode];
  for (const node of treeNodes) {
    if (!node || typeof node !== "object") continue;
    if (typeof node.id !== "string" || node.id.length === 0) continue;
    if (node.id === rootNodeId) continue; // root 已加入，避免重复
    if (node.parentId === rootNodeId) {
      topLevelNodes.push(node);
    }
  }

  return topLevelNodes.map((node, index) => {
    const graphNode: BlueprintWallGraphNode = {
      id: `spec:${node.id}`,
      type: "spec_node" as const,
      title: typeof node.title === "string" ? node.title : node.id,
      status: mapSpecNodeStatusToNodeStatus(node.status),
      // spec/documents 列；row 从 1 起以避开列 2 row 0 的阶段节点。
      column: SPEC_COLUMN,
      row: index + 1,
      accent: "purple" as const,
      sourceRefs: [{ kind: "spec" as const, id: node.id }],
    };

    if (typeof node.summary === "string" && node.summary.length > 0) {
      graphNode.body = truncateForWall(node.summary, SPEC_BODY_MAX);
    }

    return graphNode;
  });
}

/**
 * spec 节点 status → 墙面图节点状态映射（确定性）。
 *
 * BlueprintSpecTreeNodeStatus 当前枚举为 `seed | draft | ready | accepted`：
 *  - `accepted`        → "completed"（已验收，等价于完成态）
 *  - `ready`           → "ready"（就绪态）
 *  - `seed` / `draft`  → "queued"（尚在草拟 / 种子态，等待推进）
 *
 * 使用穷尽 switch + default 兜底，未知 / 新增枚举成员统一落到 "queued"，避免臆造状态。
 */
function mapSpecNodeStatusToNodeStatus(
  status: BlueprintSpecTreeNodeStatus
): BlueprintWallGraphNodeStatus {
  switch (status) {
    case "accepted":
      return "completed";
    case "ready":
      return "ready";
    case "seed":
    case "draft":
      return "queued";
    default:
      return "queued";
  }
}

/**
 * 由当前 specTree 生成 compatibility spec summary（Req 4.6 / 8.1 / 8.2）。
 *
 * 防御性规则：`specTree` 缺失 / 非对象、`nodes` 非数组 → 返回默认空摘要。
 *  - totalNodes：specTree.nodes 全量长度（不是裁剪后发出的 spec 节点数）。
 *  - rootTitle：id === rootNodeId 的节点标题，找不到则 null。
 */
function buildSpecSummary(
  specTree: BlueprintSpecTree | null | undefined
): BlueprintWallSpecSummary {
  if (!specTree || typeof specTree !== "object") return DEFAULT_SPEC_SUMMARY;
  const treeNodes = specTree.nodes;
  if (!Array.isArray(treeNodes)) return DEFAULT_SPEC_SUMMARY;

  const rootNode = treeNodes.find(
    (node) =>
      node &&
      typeof node === "object" &&
      node.id === specTree.rootNodeId
  );

  return {
    totalNodes: treeNodes.length,
    rootTitle:
      rootNode && typeof rootNode.title === "string" ? rootNode.title : null,
  };
}

// ─── Capability Nodes ────────────────────────────────────────────────────────

/**
 * 判断 capabilityStatuses 是否含有至少一个有效 capability status 条目。
 *
 * 用于 `hasData` 判定：仅当存在可用的 capability 数据时，才让主链路走 has-data
 * 分支并产出 capability 节点，从而保证 capability 节点与 capability summary 由同一份
 * 输入派生（Req 8.2）。防御性规则与 `buildCapabilityNodes` / `buildCapabilitySummary`
 * 保持一致。
 */
function isRolePhaseActive(phase: RolePhase | undefined): boolean {
  return (
    phase === "thinking" ||
    phase === "acting" ||
    phase === "activated" ||
    phase === "reviewing" ||
    phase === "observing"
  );
}

function buildBrainstormNodes(
  rolePhases: Record<string, RolePhase> | null | undefined,
  reasoningEntries: AgentReasoningEntry[],
  locale: AppLocale
): BlueprintWallGraphNode[] {
  const activeRoleIds = collectBrainstormRoleIds(rolePhases, reasoningEntries);
  if (activeRoleIds.length < MIN_BRAINSTORM_BRANCH_NODES) return [];

  return activeRoleIds
    .slice(0, MAX_BRAINSTORM_BRANCH_NODES)
    .map((roleId, index) => ({
    id: `brainstorm:${roleId}`,
    type: "brainstorm" as const,
    title: formatBrainstormRoleTitle(roleId),
    body:
      locale === "zh-CN"
        ? `LLM 运行时分支：${roleId}`
        : `Runtime branch: ${roleId}`,
    status: "active" as const,
    column: BRAINSTORM_COLUMN,
    row: index + 1,
    accent: "teal" as const,
    sourceRefs: [{ kind: "brainstorm" as const, id: roleId }],
  }));
}

function collectBrainstormRoleIds(
  rolePhases: Record<string, RolePhase> | null | undefined,
  reasoningEntries: AgentReasoningEntry[]
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const pushRoleId = (rawRoleId: string | undefined) => {
    if (!rawRoleId) return;
    const roleId = sanitizeBrainstormRoleId(rawRoleId);
    if (roleId.length === 0 || seen.has(roleId)) return;
    seen.add(roleId);
    ids.push(roleId);
  };

  if (rolePhases && typeof rolePhases === "object") {
    for (const [key, phase] of Object.entries(rolePhases)) {
      if (!isRolePhaseActive(phase)) continue;
      pushRoleId(key);
    }
  }

  for (const entry of reasoningEntries) {
    if (!isSpecBrainstormStage(entry.stageId)) continue;
    pushRoleId((entry as AgentReasoningEntry & { roleId?: string }).roleId);
  }

  return ids;
}

function isSpecBrainstormStage(stageId: string | null | undefined): boolean {
  return stageId === "spec_tree" || stageId === "spec_docs";
}

function sanitizeBrainstormRoleId(roleId: string): string {
  return roleId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatBrainstormRoleTitle(roleId: string): string {
  const words = roleId
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : roleId;
}

function hasCapabilityStatuses(
  capabilityStatuses: Record<string, CapabilityStatus> | null | undefined
): boolean {
  return collectCapabilityStatuses(capabilityStatuses).length > 0;
}

/**
 * 防御性收集 capabilityStatuses 中的有效条目，并按 capability id 升序排序。
 *
 * 防御性规则：`capabilityStatuses` 缺失 / 非对象 → 返回空数组；逐项跳过 null /
 * 非对象、缺失 `id`（非字符串 / 空串）的脏数据。
 *
 * 确定性排序：JS 对象的字符串键顺序是插入顺序（对同一输入对象是确定的），但为了
 * 不依赖调用方的键插入顺序，这里显式按 `status.id` 升序排序，得到与输入对象键插入
 * 顺序无关的稳定确定性输出。
 */
function collectCapabilityStatuses(
  capabilityStatuses: Record<string, CapabilityStatus> | null | undefined
): CollectedCapabilityStatus[] {
  if (!capabilityStatuses || typeof capabilityStatuses !== "object") return [];

  const collected: CollectedCapabilityStatus[] = [];
  for (const key of Object.keys(capabilityStatuses)) {
    const status = capabilityStatuses[key];
    if (typeof key !== "string" || key.length === 0) continue;
    if (!isCapabilityStatus(status)) continue;
    collected.push({ id: key, status });
  }

  // 按 capability id 升序，保证与对象键插入顺序无关的确定性输出。
  collected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return collected;
}

function isCapabilityStatus(status: unknown): status is CapabilityStatus {
  return (
    status === "idle" ||
    status === "invoking" ||
    status === "completed" ||
    status === "failed"
  );
}

/**
 * 由当前 capabilityStatuses 与 capabilityOwners 生成 capability 图节点
 * （Req 4.6 / 5.6）。
 *
 * Owner 归属（Req 5.6，关键）：从 `capabilityOwners[capabilityId]` 查询真实 owner。
 * 仅当存在真实 owner 映射时，才把 owner 角色信息写进节点 body（使用真实 `roleId`，
 * 否则 `roleId`）。**绝不臆造 / 推断替代 owner**：当真实 owner 处于 off-stage 或未知
 * （无映射）时，直接省略 owner 信息，而不是猜一个角色。这里不新增 sourceRef 种类
 * （sourceRefs 枚举不含 "role"），owner 信息只落在 body 文本里。
 *
 * 节点规则：
 *  - id：稳定的 `capability:${status.id}`。
 *  - title：capability id（store 的 status map value 不携带 label）。
 *  - status：由 capability status 确定性映射（见 mapCapabilityStatusToNodeStatus）。
 *  - body：存在真实 owner 时为 owner 角色标签（截断到 CAPABILITY_BODY_MAX）；否则省略。
 *  - 布局：reasoning / capability 列（列 3），row 从 1 起（`row: index + 1`）以避开
 *    列 3 row 0 的阶段主干节点。capability 与 reasoning 共享列 3，row 取值范围可能
 *    重叠，由 visual spec 在列内再分子道（见 CAPABILITY_COLUMN 注释）。
 *  - accent："teal"（确定性，capability 统一色）。
 *  - sourceRefs：仅指向 capability 自身 `{ kind: "capability", id: status.id }`。
 */
function buildCapabilityNodes(
  capabilityStatuses: Record<string, CapabilityStatus> | null | undefined,
  capabilityOwners: Record<string, CapabilityOwner> | null | undefined
): BlueprintWallGraphNode[] {
  const statuses = collectCapabilityStatuses(capabilityStatuses);
  if (statuses.length === 0) return [];

  const ownersObject =
    capabilityOwners && typeof capabilityOwners === "object"
      ? capabilityOwners
      : undefined;

  return statuses.map((status, index) => {
    const node: BlueprintWallGraphNode = {
      id: `capability:${status.id}`,
      type: "capability" as const,
      title: status.id,
      status: mapCapabilityStatusToNodeStatus(status.status),
      // reasoning / capability 列；row 从 1 起以避开列 3 row 0 的阶段节点。
      column: CAPABILITY_COLUMN,
      row: index + 1,
      accent: "teal" as const,
      sourceRefs: [{ kind: "capability" as const, id: status.id }],
    };

    // 真实 owner 优先（Req 5.6）：仅在存在真实映射时写入，绝不臆造替代 owner。
    const ownerLabel = deriveCapabilityOwnerLabel(ownersObject, status.id);
    if (ownerLabel !== undefined) {
      node.body = truncateForWall(ownerLabel, CAPABILITY_BODY_MAX);
    }

    return node;
  });
}

/**
 * 查询 capability 的真实 owner 角色标签（Req 5.6）。
 *
 * 仅返回真实存在的 owner：当 `capabilityOwners[capabilityId]` 存在且为对象、且其
 * `roleId` 为非空字符串时，返回 `roleId`。任何缺失 /
 * 非法情况一律返回 undefined —— **不臆造、不替代 owner**（off-stage / unknown owner
 * 不会被一个猜测的角色替换）。
 */
function deriveCapabilityOwnerLabel(
  capabilityOwners: Record<string, CapabilityOwner> | undefined,
  capabilityId: string
): string | undefined {
  if (!capabilityOwners) return undefined;

  const owner = capabilityOwners[capabilityId];
  if (!owner || typeof owner !== "object") return undefined;
  if (typeof owner.roleId !== "string" || owner.roleId.length === 0) {
    return undefined;
  }

  return owner.roleId;
}

/**
 * capability status → 墙面图节点状态映射（确定性）：
 *  - `running`    → "active"
 *  - `completed`  → "completed"
 *  - `failed`     → "failed"
 *  - `available`  → "ready"
 *  - `disabled`   → "queued"
 *
 * 使用穷尽 switch + default 兜底，未知 / 新增枚举成员统一落到 "queued"。
 */
function mapCapabilityStatusToNodeStatus(
  status: CapabilityStatus
): BlueprintWallGraphNodeStatus {
  switch (status) {
    case "invoking":
      return "active";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
      return "queued";
    default:
      return "queued";
  }
}

/**
 * 由当前 capabilityStatuses 生成 compatibility capability summary（Req 4.6 / 8.1 /
 * 8.2）。
 *
 * 防御性规则：`capabilityStatuses` 缺失 / 非对象 → 返回默认空摘要；脏条目（null /
 * 非对象 / 缺失 id）不计入任何计数。
 *  - total：有效 capability 条目数。
 *  - running / completed / failed：对应 status 命中数。
 *  - `idle` 计入 total，但不计入
 *    running / completed / failed（对应设计 Error Handling）。
 */
function buildCapabilitySummary(
  capabilityStatuses: Record<string, CapabilityStatus> | null | undefined
): BlueprintWallCapabilitySummary {
  const statuses = collectCapabilityStatuses(capabilityStatuses);
  if (statuses.length === 0) return DEFAULT_CAPABILITY_SUMMARY;

  let running = 0;
  let completed = 0;
  let failed = 0;
  for (const status of statuses) {
    if (status.status === "invoking") running += 1;
    else if (status.status === "completed") completed += 1;
    else if (status.status === "failed") failed += 1;
  }

  return {
    total: statuses.length,
    running,
    completed,
    failed,
  };
}

/**
 * 把墙面节点正文截断到给定上限。超出时保留前 `max - 1` 个字符并追加省略号 `…`，
 * 使总长度不超过 `max`。`max <= 0` 时返回空串。纯函数、确定性。
 */
function truncateForWall(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * 过滤出当前 job 的 reasoning entries（作业隔离，Req 3.1）。
 *
 * 防御性规则：`entries` 缺失 / 非数组 → 视为空；逐项跳过 null / 非对象 /
 * `jobId !== jobId` 的脏数据。保持输入顺序（不排序），保证确定性。
 */
function filterCurrentJobReasoning(
  entries: AgentReasoningEntry[] | undefined,
  jobId: string
): AgentReasoningEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (entry): entry is AgentReasoningEntry =>
      !!entry && typeof entry === "object" && entry.jobId === jobId
  );
}

/**
 * 由当前 job 的 reasoning entries 生成 reasoning 图节点。
 *
 * 步骤：
 *  1. 作业隔离：仅保留 `entry.jobId === jobId`（Req 3.1）。
 *  2. 上限裁剪：当过滤后数量超过 `maxReasoningNodes` 时，**保留最近的若干条**。
 *     由于本模块必须确定性、不得依赖 `Date.now` 或按时间排序，这里假设输入
 *     已按时间顺序排列（最新在尾部），因此「最近」= 取数组尾部
 *     `slice(-maxReasoningNodes)`。这是一个纯粹基于输入数组顺序的确定性选择。
 *  3. 布局：reasoning 节点归入 reasoning/capability 列（列 3）。为避免与该列
 *     row 0 上的阶段节点重叠，row 从 1 起递增（`row: index + 1`）。
 *
 * `maxReasoningNodes <= 0` 时不产出任何节点。
 */
function buildReasoningNodes(
  entries: AgentReasoningEntry[] | undefined,
  jobId: string,
  maxReasoningNodes: number
): BlueprintWallGraphNode[] {
  const filtered = filterCurrentJobReasoning(entries, jobId);
  if (maxReasoningNodes <= 0) return [];

  // Deterministic "keep the most recent" = take the tail in input order.
  const capped =
    filtered.length > maxReasoningNodes
      ? filtered.slice(-maxReasoningNodes)
      : filtered;

  return capped.map((entry, index) => {
    const sourceRefs: BlueprintWallGraphNode["sourceRefs"] = [
      { kind: "reasoning" as const, id: entry.id },
    ];
    // 当 entry.stageId 命中已知阶段时，附带 stage source ref，供后续 edge 派生。
    if (entry.stageId && KNOWN_STAGE_KEYS.has(entry.stageId)) {
      sourceRefs.push({ kind: "stage" as const, id: entry.stageId });
    }

    const node: BlueprintWallGraphNode = {
      id: `reasoning:${entry.id}`,
      type: "reasoning" as const,
      title: deriveReasoningTitle(entry),
      status: mapReasoningPhaseToStatus(entry.phase),
      // reasoning/capability 列，row 从 1 起以避开列 3 row 0 的阶段节点。
      column: REASONING_COLUMN,
      row: index + 1,
      sourceRefs,
    };

    const body = deriveReasoningBody(entry);
    if (body !== undefined) {
      node.body = body;
    }

    return node;
  });
}

/**
 * reasoning 节点标题：优先用 `iterationLabel` 拼接 phase，缺失时退化到 phase。
 * 例如 `#3 · thinking`。
 */
function deriveReasoningTitle(entry: AgentReasoningEntry): string {
  const label =
    typeof entry.iterationLabel === "string" && entry.iterationLabel.length > 0
      ? entry.iterationLabel
      : "";
  return label.length > 0 ? `${label} · ${entry.phase}` : entry.phase;
}

/**
 * reasoning 节点正文：按 thought → observationSummary → error 顺序取首个非空值；
 * 都缺失时返回 undefined（节点不带 body）。
 */
function deriveReasoningBody(entry: AgentReasoningEntry): string | undefined {
  if (typeof entry.thought === "string" && entry.thought.length > 0) {
    return entry.thought;
  }
  if (
    typeof entry.observationSummary === "string" &&
    entry.observationSummary.length > 0
  ) {
    return entry.observationSummary;
  }
  if (typeof entry.error === "string" && entry.error.length > 0) {
    return entry.error;
  }
  return undefined;
}

/**
 * reasoning phase → 墙面图节点状态映射：
 *  - `error`                              → "failed"
 *  - `completed` / `iteration_completed`  → "completed"
 *  - `observing`                          → "ready"
 *  - 其余（thinking / acting / iteration_started）→ "active"
 */
function mapReasoningPhaseToStatus(
  phase: AgentReasoningPhase
): BlueprintWallGraphNodeStatus {
  switch (phase) {
    case "error":
      return "failed";
    case "completed":
    case "iteration_completed":
      return "completed";
    case "observing":
      return "ready";
    default:
      return "active";
  }
}

// ─── Console Lines ───────────────────────────────────────────────────────────

/**
 * 由当前 job 的 reasoning entries 与 effect-preview 日志时间线生成 console 行
 * （Req 6.4 / 6.5 / 6.6）。
 *
 * 数据源与顺序（确定性，不按时间排序）：
 *  1. Source 1 — 当前 job 的 reasoning entries（`entry.jobId === jobId`）。
 *  2. Source 2 — 当前 job 的 effect-preview `runtimeProjection.logTimeline`，
 *     仅纳入 `runtimeProjection.jobId === jobId` 的预览（作业隔离，Req 3 / 6.5）。
 *
 * reasoning 行在前、preview-log 行在后，各自保持输入数组原始顺序。本模块必须
 * 确定性、不得依赖 `Date.now` 或按 `timestamp` / `Date` 排序，因此严格沿用输入
 * 顺序。
 *
 * 上限裁剪：合并后若超过 `maxConsoleLines`，**保留最近的若干条**。沿用 reasoning
 * 节点的同一约定——假设输入按时间顺序排列（最新在尾部），「最近」= 取尾部
 * `slice(-maxConsoleLines)`。这是纯粹基于输入顺序的确定性选择。
 *
 * `maxConsoleLines <= 0` 时返回空数组。
 */
function buildConsoleLines(
  input: DeriveBlueprintWallProcessDataInput,
  jobId: string,
  maxConsoleLines: number
): BlueprintWallConsoleLine[] {
  if (maxConsoleLines <= 0) return [];

  const reasoningLines = buildReasoningConsoleLines(
    input.agentReasoningEntries,
    jobId
  );
  const previewLogLines = buildPreviewLogConsoleLines(
    input.effectPreviews,
    jobId
  );

  // reasoning 行在前，preview-log 行在后（主执行链路，不混入 brainstorm 辩论日志）
  const combined = [...reasoningLines, ...previewLogLines];

  // 确定性「保留最近」= 取尾部（与 reasoning 节点裁剪约定一致）。
  return combined.length > maxConsoleLines
    ? combined.slice(-maxConsoleLines)
    : combined;
}

/**
 * 由当前 job 的 reasoning entries 生成 console 行。
 *
 * 文本优先级：`thought` → `observationSummary` → `error` → `${iterationLabel} ·
 * ${phase}` 兜底。tone 由 phase / observationSuccess 派生（见
 * `deriveReasoningConsoleTone`）。
 */
function buildReasoningConsoleLines(
  entries: AgentReasoningEntry[] | undefined,
  jobId: string
): BlueprintWallConsoleLine[] {
  const filtered = filterCurrentJobReasoning(entries, jobId);
  return filtered.map((entry) => ({
    id: `console:reasoning:${entry.id}`,
    text: deriveReasoningConsoleText(entry),
    tone: deriveReasoningConsoleTone(entry),
    sourceRef: { kind: "reasoning" as const, id: entry.id },
  }));
}

/**
 * reasoning console 行文本：thought → observationSummary → error → 兜底。
 * 兜底文本为 `${iterationLabel} · ${phase}`（iterationLabel 缺失时退化为 phase）。
 */
function deriveReasoningConsoleText(entry: AgentReasoningEntry): string {
  const body = deriveReasoningBody(entry);
  if (body !== undefined) {
    return body;
  }
  const label =
    typeof entry.iterationLabel === "string" && entry.iterationLabel.length > 0
      ? entry.iterationLabel
      : "";
  return label.length > 0 ? `${label} · ${entry.phase}` : entry.phase;
}

/**
 * reasoning console 行 tone 映射（确定性）：
 *  - `observationSuccess === false`            → "warning"（观察失败优先标黄）
 *  - phase `error`                             → "error"
 *  - phase `completed` / `iteration_completed` → "success"
 *  - phase `observing`                         → "info"
 *  - 其余（thinking / acting / iteration_started）→ "muted"
 */
function deriveReasoningConsoleTone(
  entry: AgentReasoningEntry
): BlueprintWallConsoleLine["tone"] {
  if (entry.observationSuccess === false) {
    return "warning";
  }
  switch (entry.phase) {
    case "error":
      return "error";
    case "completed":
    case "iteration_completed":
      return "success";
    case "observing":
      return "info";
    default:
      return "muted";
  }
}

/**
 * 由当前 job 的 effect-preview `runtimeProjection.logTimeline` 生成 console 行。
 *
 * 作业隔离（Req 3 / 6.5）：仅纳入 `runtimeProjection.jobId === jobId` 的预览。
 * 防御性规则：`effectPreviews` 缺失 / 非数组 → 视为空；逐项跳过 null / 非对象、
 * 缺失 runtimeProjection、jobId 不匹配、logTimeline 非数组的脏数据；逐条跳过
 * null / 非对象的日志项。保持输入顺序（不排序）。
 */
function buildPreviewLogConsoleLines(
  effectPreviews: BlueprintEffectPreviewSnapshot[] | undefined,
  jobId: string
): BlueprintWallConsoleLine[] {
  if (!Array.isArray(effectPreviews)) return [];

  const lines: BlueprintWallConsoleLine[] = [];
  for (const preview of effectPreviews) {
    if (!preview || typeof preview !== "object") continue;

    const runtimeProjection = preview.runtimeProjection;
    if (!runtimeProjection || typeof runtimeProjection !== "object") continue;

    // Job isolation: only current-job previews contribute console lines.
    if (runtimeProjection.jobId !== jobId) continue;

    const logTimeline = runtimeProjection.logTimeline;
    if (!Array.isArray(logTimeline)) continue;

    for (const logEntry of logTimeline) {
      if (!logEntry || typeof logEntry !== "object") continue;
      lines.push({
        id: `console:preview-log:${logEntry.id}`,
        text: logEntry.message,
        tone: mapPreviewLogLevelToTone(logEntry.level),
        sourceRef: { kind: "preview-log" as const, id: logEntry.id },
      });
    }
  }
  return lines;
}

/**
 * effect-preview 日志级别 → console 行 tone 映射：
 *  - "info"    → "info"
 *  - "warning" → "warning"
 *  - "success" → "success"
 */
function mapPreviewLogLevelToTone(
  level: BlueprintEffectPreviewLogEntry["level"]
): BlueprintWallConsoleLine["tone"] {
  switch (level) {
    case "warning":
      return "warning";
    case "success":
      return "success";
    default:
      return "info";
  }
}

// ─── Preview Summary & Preview Node ──────────────────────────────────────────

/**
 * 构造本地化的空 preview 摘要（Req 7.4）。
 *
 * 既无 browser preview 也无 architecture 草图时使用；绝不回退到 mission 截图数据。
 */
function emptyPreviewSummary(locale: AppLocale): BlueprintWallPreviewSummary {
  return {
    status: "empty",
    kind: "none",
    title: PREVIEW_EMPTY_LABELS[locale],
  };
}

function countCurrentJobEffectPreviews(
  effectPreviews: BlueprintEffectPreviewSnapshot[] | undefined,
  jobId: string
): number {
  if (!Array.isArray(effectPreviews)) return 0;

  let count = 0;
  for (const preview of effectPreviews) {
    if (!preview || typeof preview !== "object") continue;
    const runtimeProjection = preview.runtimeProjection;
    if (!runtimeProjection || typeof runtimeProjection !== "object") continue;
    if (runtimeProjection.jobId === jobId) count += 1;
  }
  return count;
}

/**
 * 由当前 job 的 effect previews 派生 previewSummary（Req 3.2 / 7.1 / 7.2 / 7.3 /
 * 7.4）。
 *
 * 作业隔离（Req 3.2）：仅考虑 `runtimeProjection.jobId === jobId` 的预览，并防御性
 * 跳过缺失 / 非对象 runtimeProjection 或 jobId 不匹配的脏数据。
 *
 * browser preview 优先（Req 7.2 / 设计 Property 4）：`browserPreview` 对象在契约里
 * 永远存在，因此对象存在本身不足以判定有 browser 预览——只有 `browserPreview.url`
 * trim 后非空才算数。命中时取**最新的当前 job 预览**，确定性定义为输入数组顺序里
 * 的**最后一个**匹配项（输入假设按时间顺序排列）。
 *
 * architecture 回退（Req 7.3）：若没有任何合格 browser 预览，则取最新（最后一个）
 * 带非空 `architectureSvgDraft` 的当前 job 预览。
 *
 * 兜底（Req 7.4）：两者都没有时返回本地化空状态。
 */
function buildPreviewSummary(
  effectPreviews: BlueprintEffectPreviewSnapshot[] | undefined,
  jobId: string,
  locale: AppLocale
): BlueprintWallPreviewSummary {
  if (!Array.isArray(effectPreviews)) return emptyPreviewSummary(locale);

  // Collect current-job previews in input (chronological) order.
  const currentJobPreviews: BlueprintEffectPreviewSnapshot[] = [];
  for (const preview of effectPreviews) {
    if (!preview || typeof preview !== "object") continue;
    const runtimeProjection = preview.runtimeProjection;
    if (!runtimeProjection || typeof runtimeProjection !== "object") continue;
    if (runtimeProjection.jobId !== jobId) continue;
    currentJobPreviews.push(preview);
  }

  if (currentJobPreviews.length === 0) return emptyPreviewSummary(locale);

  // Browser preference (Req 7.2): pick the LAST current-job preview whose
  // browserPreview.url is a non-empty string (after trim). The object is always
  // present, so only a non-empty trimmed url counts (Property 4).
  for (let index = currentJobPreviews.length - 1; index >= 0; index -= 1) {
    const preview = currentJobPreviews[index];
    const browserPreview = preview.runtimeProjection.browserPreview;
    if (!browserPreview || typeof browserPreview !== "object") continue;

    const url =
      typeof browserPreview.url === "string" ? browserPreview.url.trim() : "";
    if (url.length === 0) continue;

    const title =
      typeof browserPreview.title === "string" &&
      browserPreview.title.trim().length > 0
        ? browserPreview.title
        : PREVIEW_BROWSER_LABELS[locale];

    return {
      status: "ready",
      kind: "browser",
      previewId: preview.id,
      title,
      url,
    };
  }

  // Architecture fallback (Req 7.3): latest current-job preview with a non-empty
  // architectureSvgDraft string.
  for (let index = currentJobPreviews.length - 1; index >= 0; index -= 1) {
    const preview = currentJobPreviews[index];
    const draft = preview.architectureSvgDraft;
    if (typeof draft !== "string" || draft.trim().length === 0) continue;

    return {
      status: "ready",
      kind: "architecture",
      previewId: preview.id,
      title: PREVIEW_ARCHITECTURE_LABELS[locale],
    };
  }

  // Neither exists (Req 7.4): explicit empty, never mission screenshot data.
  return emptyPreviewSummary(locale);
}

/**
 * 当 previewSummary 处于 ready 状态时，生成对应的 preview 图节点（Req 4.6）。
 *
 * empty 状态不产出节点（返回 undefined）。
 *
 * 节点规则：
 *  - id：稳定的 `preview:${previewSummary.previewId}`。
 *  - status："ready"。
 *  - body：browser kind 为预览 url；architecture kind 省略 body。
 *  - 布局：preview / handoff / final 列（列 4），row 1（避开列 4 row 0 的阶段节点
 *    `stage:spec_tree`）。
 *  - accent：browser → "blue"，architecture → "slate"。
 *  - sourceRefs：指向 preview 自身。
 */
function buildPreviewNode(
  previewSummary: BlueprintWallPreviewSummary
): BlueprintWallGraphNode | undefined {
  if (previewSummary.status !== "ready") return undefined;

  const node: BlueprintWallGraphNode = {
    id: `preview:${previewSummary.previewId}`,
    type: "preview" as const,
    title: previewSummary.title,
    status: "ready" as const,
    column: PREVIEW_COLUMN,
    row: PREVIEW_ROW,
    accent: previewSummary.kind === "browser" ? "blue" : "slate",
    sourceRefs: [{ kind: "preview" as const, id: previewSummary.previewId }],
  };

  if (previewSummary.kind === "browser" && previewSummary.url) {
    node.body = previewSummary.url;
  }

  return node;
}

// ─── Artifact Nodes & Final Node ─────────────────────────────────────────────

/**
 * 防御性收集当前 job 的 artifact 输入（Req 4.8 / 3 / 8.2）。
 *
 * 防御性规则：`artifacts` 缺失 / 非数组 → 返回空数组；逐项跳过 null / 非对象、缺失
 * 字符串 `id`（非字符串 / 空串）的脏数据。保持输入顺序（不排序），保证确定性。
 *
 * 作业隔离规则（Req 3 / 8.2，关键）：
 *  - 当 artifact 带 `jobId` 字段时，仅当 `jobId === job.id` 才纳入（严格作业隔离）。
 *  - 当 artifact 没有 `jobId`（undefined）时纳入——按 Req 3.3，这类输入是页面直接
 *    传入、已被上层按当前 job 作用域裁剪过的 prop，且没有更好的 job-scoped 替代来源，
 *    因此视为属于当前 job。
 */
function collectCurrentJobArtifacts(
  artifacts: BlueprintWallArtifactInput[] | undefined,
  jobId: string
): BlueprintWallArtifactInput[] {
  if (!Array.isArray(artifacts)) return [];

  const collected: BlueprintWallArtifactInput[] = [];
  const seenIds = new Set<string>();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") continue;
    if (typeof artifact.id !== "string" || artifact.id.length === 0) continue;

    // Job isolation (Req 3 / 8.2): a present jobId must match the current job;
    // an absent jobId is treated as an already-scoped page prop (Req 3.3).
    if (artifact.jobId !== undefined && artifact.jobId !== jobId) continue;

    if (seenIds.has(artifact.id)) continue;
    seenIds.add(artifact.id);
    collected.push(artifact);
  }
  return collected;
}

/**
 * 选出当前 job artifact 列表里作为终端结果的那一个的索引（Req 4.9）。
 *
 * 规则：取最后一个 `isFinal === true` 的 artifact（与本模块「最新在尾部」的确定性
 * 约定一致）。不存在任何 `isFinal === true` 的 artifact 时返回 -1（不产出 final 节点）。
 *
 * 注意：当存在多个 `isFinal === true` 的 artifact 时，只有被选中的最后一个成为 final
 * 节点；更早的 isFinal artifact 仍作为普通 `artifact` 节点渲染（见 buildArtifactNodes），
 * 不会丢失。
 *
 * 范围说明：本任务只依据 artifact 输入判定终端结果；超出 artifact 输入之外的 job 级
 * 终端状态检测（例如 job.status 自身的完成态）不在本任务范围内。
 */
function pickFinalArtifactIndex(
  artifacts: BlueprintWallArtifactInput[]
): number {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    if (artifacts[index].isFinal === true) return index;
  }
  return -1;
}

/**
 * 由当前 job 的 artifact 输入生成 `artifact` 图节点（Req 4.8）。
 *
 * 终端结果去重（关键设计选择）：被 `pickFinalArtifactIndex` 选中的那个 artifact 改由
 * `buildFinalNode` 渲染成单一 `final` 节点，**不**在这里重复发出为 `artifact` 节点，
 * 避免出现两张看起来重复的卡片。其余所有 artifact（包括任何更早的 isFinal artifact）
 * 都作为普通 `artifact` 节点渲染，确保不丢数据。
 *
 * 节点规则：
 *  - id：稳定的 `artifact:${artifact.id}`。
 *  - title：`artifact.title`（缺失 / 空串时兜底为 id）。
 *  - status："completed"——一个已存在的 artifact 是已产出的结果。
 *  - 布局：preview / handoff / final 列（列 4）。列 4 row 0 = 阶段节点、row 1 =
 *    preview 节点，因此 artifact 节点从 row `ARTIFACT_ROW_START`（=2）起堆叠。这里使用
 *    「已发出 artifact 节点序号」作为偏移（跳过被选作 final 的 artifact），保证行号连续
 *    不留空洞：`row: emittedIndex + ARTIFACT_ROW_START`。
 *  - accent："slate"（确定性，artifact 统一色）。
 *  - sourceRefs：指向 artifact 自身。
 */
function buildArtifactNodes(
  artifacts: BlueprintWallArtifactInput[],
  finalArtifactIndex: number
): BlueprintWallGraphNode[] {
  const nodes: BlueprintWallGraphNode[] = [];

  artifacts.forEach((artifact, index) => {
    // The terminal artifact is rendered once, as the `final` node (not here).
    if (index === finalArtifactIndex) return;

    nodes.push({
      id: `artifact:${artifact.id}`,
      type: "artifact" as const,
      title:
        typeof artifact.title === "string" && artifact.title.length > 0
          ? artifact.title
          : artifact.id,
      status: "completed" as const,
      // 列 4；row 从 2 起以避开列 4 row 0 的阶段节点与 row 1 的 preview 节点。
      // 使用已发出节点序号（nodes.length）保证行号连续。
      column: ARTIFACT_COLUMN,
      row: nodes.length + ARTIFACT_ROW_START,
      accent: "slate" as const,
      sourceRefs: [{ kind: "artifact" as const, id: artifact.id }],
    });
  });

  return nodes;
}

/**
 * 由被选中的终端 artifact 生成单一 `final` 图节点（Req 4.9）。
 *
 * `finalArtifactIndex < 0`（没有任何 `isFinal === true` 的 artifact）时不产出 final
 * 节点（返回 undefined）。本任务仅依据 artifact 输入判定终端结果，job 级终端检测不在
 * 本任务范围内。
 *
 * 节点规则：
 *  - id：稳定的 `final:${artifact.id}`。
 *  - title：`artifact.title`（缺失 / 空串时兜底为本地化「最终交付 / Final Handoff」）。
 *  - status："completed"——终端交付是已完成的结果。
 *  - 布局：preview / handoff / final 列（列 4），放在所有 artifact 节点之后一行，确定性
 *    定义为 `row: artifactNodeCount + ARTIFACT_ROW_START`（artifact 节点占
 *    row 2..artifactNodeCount+1，final 紧随其后）。
 *  - accent："teal"。
 *  - sourceRefs：指向 artifact 自身。
 */
function buildFinalNode(
  artifacts: BlueprintWallArtifactInput[],
  finalArtifactIndex: number,
  artifactNodeCount: number,
  locale: AppLocale
): BlueprintWallGraphNode | undefined {
  if (finalArtifactIndex < 0) return undefined;

  const artifact = artifacts[finalArtifactIndex];

  return {
    id: `final:${artifact.id}`,
    type: "final" as const,
    title:
      typeof artifact.title === "string" && artifact.title.length > 0
        ? artifact.title
        : FINAL_LABELS[locale],
    status: "completed" as const,
    // 列 4；放在所有 artifact 节点（row 2..artifactNodeCount+1）之后一行。
    column: ARTIFACT_COLUMN,
    row: artifactNodeCount + ARTIFACT_ROW_START,
    accent: "teal" as const,
    sourceRefs: [{ kind: "artifact" as const, id: artifact.id }],
  };
}

/**
 * 统计处于 "active" 阶段的角色数（Req 6.2）。
 *
 * 防御性规则：`rolePhases` 缺失 / 非对象 → 0；逐项跳过 null / 非对象、缺失
 * 非字符串 phase 的脏条目；仅统计 activated/thinking/acting/observing/reviewing。该 helper
 * 遍历对象 values、不排序也不依赖键插入顺序（计数与顺序无关），因此确定性。
 */
function countActiveRoles(
  rolePhases: Record<string, RolePhase> | null | undefined
): number {
  if (!rolePhases || typeof rolePhases !== "object") return 0;

  let activeCount = 0;
  for (const key of Object.keys(rolePhases)) {
    const phase = rolePhases[key];
    if (typeof key !== "string" || key.length === 0) continue;
    if (isActiveRolePhase(phase)) activeCount += 1;
  }
  return activeCount;
}

function isActiveRolePhase(phase: unknown): phase is RolePhase {
  return (
    phase === "activated" ||
    phase === "thinking" ||
    phase === "acting" ||
    phase === "observing" ||
    phase === "reviewing"
  );
}

/**
 * 组装墙面 metrics（Req 6.1 / 6.2 / 6.3）。
 *
 *  - activeRoles：由 `countActiveRoles(rolePhases)` 派生（Req 6.2）。
 *  - capabilities：复用传入的 `capabilitySummary`（= `buildCapabilitySummary(...)`），
 *    保证 `metrics.capabilities` 与 `compatibility.capabilitySummary` 由同一份输入派生、
 *    始终一致（Req 8.2 spirit）。这里复制成新对象，避免与 compatibility 块共享引用。
 *  - artifacts：当前 job 的 included artifact 总数（artifact 节点 + final 节点，Req 6.2）。
 *  - tokenBurn / sourceCount / remainingPoints / elapsedMs：当前输入边界
 *    （`DeriveBlueprintWallProcessDataInput`）不携带 token / source / time / remaining
 *    遥测字段，故一律保持 `null`，绝不臆造（Req 6.3）。这些字段会持续保持 `null`，
 *    直到后续把输入边界扩展为真实遥测来源——这属于本数据 spec 范围之外。
 */
function buildMetrics(
  rolePhases: Record<string, RolePhase> | null | undefined,
  capabilitySummary: BlueprintWallCapabilitySummary,
  artifactCount: number
): BlueprintWallMetrics {
  return {
    tokenBurn: null,
    sourceCount: null,
    remainingPoints: null,
    elapsedMs: null,
    activeRoles: countActiveRoles(rolePhases),
    capabilities: {
      total: capabilitySummary.total,
      running: capabilitySummary.running,
      completed: capabilitySummary.completed,
      failed: capabilitySummary.failed,
    },
    artifacts: artifactCount,
  };
}

// ─── Minimap Builder ─────────────────────────────────────────────────────────

/**
 * 空 minimap 的兜底 viewport（Req 7.7）。
 *
 * 当没有任何图节点时（no-job / no-blueprint-data 路径，或被裁成空节点集），无法从
 * 节点 bounds 推导真实范围，于是回落到一个稳定的「墙面 5 列方案」默认窗口：列 0..4
 * （design 建议方案的 5 列：input / route / spec / reasoning / preview）、行 0..0。
 * 这样静态墙面渲染在空态下也有一个确定、可读、与列布局一致的窗口，而不是 0..0 的退化
 * 窗口。该常量只在零节点时使用；有节点时 viewport 由真实 min/max 推导（见 buildMinimap）。
 */
const EMPTY_MINIMAP_VIEWPORT: BlueprintWallMinimap["viewport"] = {
  columnStart: 0,
  columnEnd: 4,
  rowStart: 0,
  rowEnd: 0,
};

/**
 * 由图节点集合派生 minimap 数据（Req 7.5 / 7.6 / 7.7）。
 *
 * - minimap 节点镜像图节点的 id / column / row / status，并保持入参 `nodes` 的确定性
 *   顺序（Req 7.6）。本数据层不重新排序、不去重。
 * - viewport 从 minimap 节点的真实 column / row bounds 确定性推导（Req 7.5 / 7.7）：
 *     columnStart = 所有节点 column 的最小值
 *     columnEnd   = 所有节点 column 的最大值
 *     rowStart    = 所有节点 row 的最小值
 *     rowEnd      = 所有节点 row 的最大值
 *   这样 viewport 反映墙面上真正存在的列/行范围——例如某列堆了很多 reasoning / artifact
 *   行时，rowEnd 会随之增大，静态墙面渲染据此就能框住最高的一列（Req 7.7），而不是被
 *   写死成 0。阶段主干节点用 `column: index`（0..8），所以列范围可超过建议的 0..4，
 *   viewport 如实反映实际最大列。
 * - 零节点时回落到 `EMPTY_MINIMAP_VIEWPORT`（列 0..4、行 0..0），保持空态下的稳定、
 *   墙面 bounded 默认窗口（Req 7.7）。
 *
 * 纯函数、确定性：仅依赖入参节点的 column / row / status，无时间 / 随机 / 全局状态。
 */
function buildMinimap(
  nodes: BlueprintWallGraphNode[]
): BlueprintWallMinimap {
  const minimapNodes = nodes.map((node) => ({
    id: node.id,
    column: node.column,
    row: node.row,
    status: node.status,
  }));

  // Empty-case default: no nodes → no derivable bounds, use the stable
  // wall 5-column scheme window (columns 0..4, rows 0..0) so a static wall
  // render still has a deterministic, layout-consistent viewport.
  if (minimapNodes.length === 0) {
    return {
      nodes: minimapNodes,
      viewport: { ...EMPTY_MINIMAP_VIEWPORT },
    };
  }

  // Nodes exist → derive the real min/max column and row bounds. rowEnd then
  // reflects the tallest column (e.g. many reasoning / artifact rows), which is
  // what a static wall render needs to frame the graph (Req 7.7).
  let columnStart = minimapNodes[0].column;
  let columnEnd = minimapNodes[0].column;
  let rowStart = minimapNodes[0].row;
  let rowEnd = minimapNodes[0].row;
  for (const node of minimapNodes) {
    if (node.column < columnStart) columnStart = node.column;
    if (node.column > columnEnd) columnEnd = node.column;
    if (node.row < rowStart) rowStart = node.row;
    if (node.row > rowEnd) rowEnd = node.row;
  }

  return {
    nodes: minimapNodes,
    viewport: { columnStart, columnEnd, rowStart, rowEnd },
  };
}

function buildOutput(
  stageSignal: BlueprintSceneStageSignal,
  stages: BlueprintWallStageItem[],
  nodes: BlueprintWallGraphNode[],
  edges: BlueprintWallGraphEdge[],
  reasoningEntryCount: number,
  consoleLines: BlueprintWallConsoleLine[],
  routeSummary: BlueprintWallRouteSummary,
  specSummary: BlueprintWallSpecSummary,
  capabilitySummary: BlueprintWallCapabilitySummary,
  previewSummary: BlueprintWallPreviewSummary,
  metrics: BlueprintWallMetrics,
  emptyReason: "no-job" | "no-blueprint-data" | undefined
): BlueprintWallProcessData {
  const result: BlueprintWallProcessData = {
    stageSignal,
    nodes,
    edges,
    metrics,
    consoleLines,
    minimap: buildMinimap(nodes),
    previewSummary,
    compatibility: {
      stages,
      routeSummary,
      specSummary,
      capabilitySummary,
      counters: {
        reasoningEntries: reasoningEntryCount,
        consoleLines: consoleLines.length,
        // metrics.artifacts is the same current-job included-artifact count
        // (artifact nodes + final node), so the graph metric and the
        // compatibility counter stay consistent (Req 8.2 / 8.3).
        artifacts: metrics.artifacts,
      },
    },
  };

  if (emptyReason) {
    result.emptyReason = emptyReason;
  }

  return result;
}
