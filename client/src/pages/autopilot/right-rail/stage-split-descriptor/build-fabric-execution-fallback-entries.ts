/**
 * `buildFabricExecutionFallbackEntries` — generates a single info-toned
 * fallback execution entry for each fabric sub-stage when a job exists but
 * no artifacts have been produced yet.
 *
 * 对应需求：1.4, 1.6, 3.2
 *
 * 严格契约：
 * - `stageId` 从 `STAGE_FILTER_BY_SUB[sub]` 读取，**不**使用 sub 字面量。
 *   这保证 `prompt_package` 的 fallback entry 使用服务端 stageId
 *   `"prompt_packaging"`，否则 `ProcessArtifactSplitPanel` 的 filterSet
 *   会把该 entry 过滤掉。
 * - `job === null` 时返回 `[]`（尚未启动执行，无需 fallback）。
 * - 永不抛出异常。
 */

import type { AppLocale } from "@/lib/locale";
import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

import type { ProcessArtifactFallbackExecutionEntry } from "../ProcessArtifactSplitPanel";
import { STAGE_FILTER_BY_SUB } from "./stage-filter-by-sub";

/**
 * 7 个 fabric sub-stage 的字面联合。
 */
export type FabricExecutionFallbackSub =
  | "agent_crew_fabric"
  | "spec_tree"
  | "effect_preview"
  | "prompt_package"
  | "runtime_capability"
  | "engineering_handoff"
  | "artifact_memory";

const FABRIC_FALLBACK_TEXT: Record<
  FabricExecutionFallbackSub,
  Record<AppLocale, string>
> = {
  agent_crew_fabric: {
    "zh-CN": "正在编组 Agent 车队…",
    "en-US": "Assembling agent crew…",
  },
  spec_tree: {
    "zh-CN": "正在派生 SPEC 资产树…",
    "en-US": "Deriving SPEC asset tree…",
  },
  effect_preview: {
    "zh-CN": "正在生成效果预演…",
    "en-US": "Generating effect preview…",
  },
  prompt_package: {
    "zh-CN": "正在打包提示词…",
    "en-US": "Packaging prompts…",
  },
  runtime_capability: {
    "zh-CN": "正在桥接运行时能力…",
    "en-US": "Bridging runtime capabilities…",
  },
  engineering_handoff: {
    "zh-CN": "正在准备工程交接…",
    "en-US": "Preparing engineering handoff…",
  },
  artifact_memory: {
    "zh-CN": "正在归档产物记忆…",
    "en-US": "Archiving artifact memory…",
  },
};

/**
 * Returns a single info-toned fallback execution entry for the given fabric
 * sub when `job` is non-null (indicating execution has started but no
 * artifacts are present yet). Returns `[]` when `job === null`.
 */
export function buildFabricExecutionFallbackEntries({
  sub,
  locale,
  job,
}: {
  sub: FabricExecutionFallbackSub;
  locale: AppLocale;
  job: BlueprintGenerationJob | null;
}): ProcessArtifactFallbackExecutionEntry[] {
  if (job === null) {
    return [];
  }

  const rawStageFilter = STAGE_FILTER_BY_SUB[sub];
  const stageId: string =
    typeof rawStageFilter === "string"
      ? rawStageFilter
      : rawStageFilter[0];

  return [
    {
      id: `fabric-fallback-${sub}-${job.id}`,
      stageId,
      text: FABRIC_FALLBACK_TEXT[sub][locale],
      tone: "info",
    },
  ];
}
