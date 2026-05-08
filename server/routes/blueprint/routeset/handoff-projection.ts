/**
 * `handoff-projection.ts`：基于 `BlueprintGenerationJob` 的只读派生，
 * 给响应 payload 补上 `handoffState` 与 `stageState.reviewingHandoff` 两个新可选字段。
 *
 * 设计要点：
 * - 纯函数、无副作用：不修改入参 job，也不写 jobStore；
 * - 新字段永远是"追加"；既有响应形状不变；
 * - 由 `createJobDetailsPayload` 在返回前调用一次，
 *   让所有读取路径（`GET /jobs/:id`、`GET /jobs/latest`、`GET /generations/:id`）
 *   自动拥有显式 `reviewing` 交接态，而不需要每条路由各自处理。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 4.1（`reviewing` 显式化）
 * - 需求 4.3（向后兼容：新字段仅可选）
 * - 需求 4.4（进入 reviewing 时写入 provenance）
 */

import type {
  BlueprintGenerationJob,
  BlueprintHandoffState,
  BlueprintReviewingHandoff,
  BlueprintRouteSelection,
  BlueprintSpecTree,
} from "../../../../shared/blueprint/index.js";

function findArtifactPayload<T>(
  job: BlueprintGenerationJob,
  type: string
): T | undefined {
  const artifact = job.artifacts.find(item => item.type === type);
  return artifact?.payload as T | undefined;
}

/**
 * 从作业状态推断 `handoffState`。
 *
 * 规则：
 * - `failed` → `"failed"`；
 * - `reviewing` → `"reviewing"`；
 * - `completed` 且 stage 已经到下游生成物（`spec_docs` 及之后）→ `"confirmed"`；
 * - 最后一个事件 message 含 `"reset"` 的 reset 场景 → `"reset"`；
 * - 其它 → `"idle"`。
 *
 * 若作业带 error，也一并视为 `"failed"`。
 */
export function inferHandoffState(
  job: BlueprintGenerationJob
): BlueprintHandoffState {
  if (job.error) return "failed";
  if (job.status === "failed") return "failed";
  if (job.status === "reviewing") return "reviewing";
  if (job.status === "completed") {
    const downstreamStages: BlueprintGenerationJob["stage"][] = [
      "spec_docs",
      "preview",
      "effect_preview",
      "prompt_packaging",
      "runtime_capability",
      "engineering_handoff",
      "engineering_landing",
    ];
    if (downstreamStages.includes(job.stage)) return "confirmed";
  }
  // Detect `DELETE /route-selection` path: job status 会回到 running/completed，
  // 但最后一条事件描述会包含 "reset"。这里做显式标记，便于前端展示"撤回交接"状态。
  if (hasRecentResetEvent(job)) return "reset";
  return "idle";
}

function hasRecentResetEvent(job: BlueprintGenerationJob): boolean {
  const last = job.events.at(-1);
  if (!last) return false;
  const message = last.message?.toLowerCase() ?? "";
  return (
    last.stage === "route_generation" &&
    (message.includes("reset") || last.type === "route.reset")
  );
}

/**
 * 构造 `reviewingHandoff` 对象。
 *
 * 只有当 `inferHandoffState(job) === "reviewing"` 时才返回对象；其它情况返回 `undefined`。
 * 字段优先级：
 * - `selectedPathId`：来自 `BlueprintRouteSelection.selectedPathId` → `routeId` → 空串兜底；
 * - `routeId`：`selection.routeId`；
 * - `selectionId`：`selection.id`；
 * - `specTreeId`：`specTree.id`；
 * - `nodeId`：当 stage === "spec_tree" 时，默认不填（节点级别的 nodeId 由调用方在具体改动路径里单独注入）；
 * - `enteredAt`：优先使用 `job.updatedAt`；若为空则 fallback 到 `job.createdAt`；
 * - `confirmable`：stage 为 `spec_tree` 或 `route_generation` 时默认 `true`。
 */
export function buildReviewingHandoff(
  job: BlueprintGenerationJob
): BlueprintReviewingHandoff | undefined {
  if (inferHandoffState(job) !== "reviewing") return undefined;

  const selection = findArtifactPayload<BlueprintRouteSelection>(
    job,
    "route_selection"
  );
  const specTree = findArtifactPayload<BlueprintSpecTree>(job, "spec_tree");

  const selectedPathId =
    selection?.selectedPathId ?? selection?.routeId ?? "";
  const routeId = selection?.routeId ?? "";

  if (!selectedPathId || !routeId) {
    // 还没选路线就进入 reviewing（理论上不应发生），不返回 handoff，保留 idle 视图。
    return undefined;
  }

  const enteredAt = job.updatedAt || job.createdAt;

  const confirmable =
    job.stage === "spec_tree" || job.stage === "route_generation";

  return {
    state: "reviewing",
    stage: job.stage,
    selectedPathId,
    routeId,
    selectionId: selection?.id,
    specTreeId: specTree?.id,
    enteredAt,
    confirmable,
  };
}

/**
 * 计算一个只读 projection，不修改入参 job。
 *
 * 返回值：
 * - `job.handoffState`：推断值；
 * - `job.stageState.reviewingHandoff`：仅在 stageState 存在且 handoffState 为 reviewing 时写入。
 *
 * 调用方（例如 `createJobDetailsPayload`）把返回对象合并到响应 `job` 字段即可。
 */
export function projectHandoffOntoJob(
  job: BlueprintGenerationJob
): BlueprintGenerationJob {
  const handoffState = inferHandoffState(job);
  const reviewingHandoff = buildReviewingHandoff(job);
  const stageState = job.stageState
    ? {
        ...job.stageState,
        ...(reviewingHandoff ? { reviewingHandoff } : {}),
      }
    : job.stageState;
  return {
    ...job,
    handoffState,
    stageState,
  };
}
