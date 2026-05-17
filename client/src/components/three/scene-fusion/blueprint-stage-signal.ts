/**
 * 自动驾驶 3D 场景融合 — 蓝图 9 阶段信号纯函数。
 *
 * 把 BlueprintGenerationJob 的当前阶段映射到 SceneStageFlow 既有流线节点，
 * 使蓝图 9 阶段推进时场景流线节点能够逐段点亮。
 *
 * 设计要点：
 *  - 输出形状与既有 `SceneStageSignal` 兼容（`source` 标记为 "workflow"），
 *    让 SceneStageFlow 在蓝图模式下零修改即可消费同一份渲染管线。
 *  - 第 10 / 11 阶段（runtime_capability / engineering_landing）按 design.md
 *    风险段 4 的约定，复用 engineering_handoff 末尾节点不单独占位。
 *  - 容忍 null / undefined / 缺失字段 / 未知 stage：返回 SAFE_DEFAULT_SIGNAL，
 *    不抛错也不引入造假数据（对应 AC5 / AC7）。
 *
 * 该模块零副作用、零 hook、零 DOM 引用，可在任何渲染阶段安全调用。
 */

import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "@shared/blueprint/contracts";
import type { AppLocale } from "@/lib/locale";
import {
  SCENE_FLOW_ZONES,
  SCENE_STAGE_SEMANTIC_COLORS,
  type SceneFlowZoneId,
  type SceneStageSemanticKey,
  type SceneStageSignal,
} from "@/lib/scene-stage-flow";

/**
 * 蓝图驾驶舱在场景流线上的 9 阶段节点顺序。
 *
 * 来自 design.md 风险段 4：
 *   input / clarification / route_generation / route_selection /
 *   spec_tree / spec_docs / effect_preview / prompt_packaging /
 *   engineering_handoff
 *
 * 后端 BlueprintGenerationStage 还包含 `preview` / `runtime_capability` /
 * `engineering_landing`，它们在前端阶段流线上分别复用 effect_preview /
 * engineering_handoff 末尾节点（不单独占位）。
 */
export const BLUEPRINT_SCENE_STAGES = [
  "input",
  "clarification",
  "route_generation",
  "route_selection",
  "spec_tree",
  "spec_docs",
  "effect_preview",
  "prompt_packaging",
  "engineering_handoff",
] as const;

/** 蓝图阶段在场景流线上的节点 key 字面量类型。 */
export type BlueprintSceneStageKey = (typeof BLUEPRINT_SCENE_STAGES)[number];

/**
 * 标准化蓝图阶段信号对象。
 *
 * - `stageKey`：当前阶段 key；
 * - `stageIndex`：阶段索引，0..N-1，未开始时为 0；
 * - `totalStages`：总阶段数，恒为 9；
 * - `progress`：0..100 之间的进度比例，等于 `stageIndex / (totalStages - 1) * 100`，
 *   未开始时为 0。注意单位是百分比，与 SceneStageSignal.progress 的语义一致
 *   （SceneStageFlow 直接用 `${progress}%` 渲染进度条）。
 */
export interface BlueprintSceneStageSignal {
  stageKey: BlueprintSceneStageKey;
  stageIndex: number;
  totalStages: number;
  progress: number;
}

/**
 * 蓝图阶段在场景流线上的语义色映射。
 *
 * 沿用既有 SceneStageSemanticKey 调色板，让蓝图模式与 mission-first 模式
 * 视觉一致：
 *  - input / clarification → direction（橙）
 *  - route_generation / route_selection → planning（蓝）
 *  - spec_tree / spec_docs → execution（青）
 *  - effect_preview → review（紫）
 *  - prompt_packaging → summary（黄）
 *  - engineering_handoff → feedback（绿）
 */
const STAGE_SEMANTIC: Record<BlueprintSceneStageKey, SceneStageSemanticKey> = {
  input: "direction",
  clarification: "direction",
  route_generation: "planning",
  route_selection: "planning",
  spec_tree: "execution",
  spec_docs: "execution",
  effect_preview: "review",
  prompt_packaging: "summary",
  engineering_handoff: "feedback",
};

/** 蓝图阶段映射到 SceneFlowZone trail（每条 trail 至少 2 个 zone，触发 StageFlowSegment）。 */
const STAGE_ZONES: Record<BlueprintSceneStageKey, SceneFlowZoneId[]> = {
  input: ["mission", "leadDesk"],
  clarification: ["leadDesk", "podA"],
  route_generation: ["leadDesk", "podA", "podB"],
  route_selection: ["leadDesk", "podB"],
  spec_tree: ["podA", "podB", "podC"],
  spec_docs: ["podB", "podC", "podD"],
  effect_preview: ["podC", "podD"],
  prompt_packaging: ["podD", "lounge"],
  engineering_handoff: ["lounge", "mission"],
};

/** 蓝图阶段在中文 / 英文场景 HUD 中的展示标签。 */
const STAGE_TITLES: Record<BlueprintSceneStageKey, Record<AppLocale, string>> =
  {
    input: { "zh-CN": "目标输入", "en-US": "Goal Input" },
    clarification: { "zh-CN": "澄清交互", "en-US": "Clarification" },
    route_generation: { "zh-CN": "路线生成", "en-US": "Route Generation" },
    route_selection: { "zh-CN": "路线选择", "en-US": "Route Selection" },
    spec_tree: { "zh-CN": "规格树", "en-US": "Spec Tree" },
    spec_docs: { "zh-CN": "规格文档", "en-US": "Spec Docs" },
    effect_preview: { "zh-CN": "效果预览", "en-US": "Effect Preview" },
    prompt_packaging: { "zh-CN": "提示词打包", "en-US": "Prompt Packaging" },
    engineering_handoff: { "zh-CN": "工程交付", "en-US": "Engineering Handoff" },
  };

/**
 * 后端 BlueprintGenerationStage → 场景流线节点 key 的归一化映射。
 *
 * 不在 BLUEPRINT_SCENE_STAGES 内的后端 stage（preview / runtime_capability /
 * engineering_landing）被复用到最近的同语义节点上，避免场景流线节点过密。
 */
const BACKEND_STAGE_FALLBACK: Record<
  BlueprintGenerationStage,
  BlueprintSceneStageKey
> = {
  input: "input",
  clarification: "clarification",
  route_generation: "route_generation",
  spec_tree: "spec_tree",
  spec_docs: "spec_docs",
  // preview 是 BlueprintGenerationStage 旧别名，归到 effect_preview 节点
  preview: "effect_preview",
  effect_preview: "effect_preview",
  prompt_packaging: "prompt_packaging",
  // runtime_capability / engineering_landing 复用 engineering_handoff 末尾节点
  runtime_capability: "engineering_handoff",
  engineering_handoff: "engineering_handoff",
  engineering_landing: "engineering_handoff",
};

/** 安全默认信号：未开始 / 第 0 阶段（input） / 进度 0。 */
const SAFE_DEFAULT_SIGNAL: BlueprintSceneStageSignal = {
  stageKey: "input",
  stageIndex: 0,
  totalStages: BLUEPRINT_SCENE_STAGES.length,
  progress: 0,
};

/**
 * 把 BlueprintGenerationJob 翻译为前端可消费的标准化 9 阶段信号。
 *
 * 容错规则：
 *  - `job` 为 `null` / `undefined` → SAFE_DEFAULT_SIGNAL
 *  - `job.stage` 缺失 / 非字符串 → SAFE_DEFAULT_SIGNAL
 *  - `job.stage` 是后端 enum 但不在 BLUEPRINT_SCENE_STAGES 内（例如
 *    `runtime_capability`）→ 走 BACKEND_STAGE_FALLBACK 复用末尾节点
 *  - `job.stage` 是未知字符串 → SAFE_DEFAULT_SIGNAL（不抛错）
 *
 * 该函数零副作用、零 hook、可在任何渲染阶段安全调用。
 *
 * @param job 当前 BlueprintGenerationJob，可能为 null / undefined
 * @returns 标准化的蓝图阶段信号对象
 */
export function getBlueprintSceneStageSignal(
  job: BlueprintGenerationJob | null | undefined
): BlueprintSceneStageSignal {
  if (!job) return SAFE_DEFAULT_SIGNAL;
  const rawStage = (job as { stage?: unknown }).stage;
  if (typeof rawStage !== "string" || rawStage.length === 0) {
    return SAFE_DEFAULT_SIGNAL;
  }

  // 先尝试直接命中 BLUEPRINT_SCENE_STAGES（前端 9 个节点）
  const directIndex = BLUEPRINT_SCENE_STAGES.indexOf(
    rawStage as BlueprintSceneStageKey
  );
  if (directIndex >= 0) {
    return buildSignal(rawStage as BlueprintSceneStageKey, directIndex);
  }

  // 再走后端 enum fallback 表
  const fallback =
    BACKEND_STAGE_FALLBACK[rawStage as BlueprintGenerationStage];
  if (fallback) {
    const idx = BLUEPRINT_SCENE_STAGES.indexOf(fallback);
    if (idx >= 0) return buildSignal(fallback, idx);
  }

  return SAFE_DEFAULT_SIGNAL;
}

function buildSignal(
  stageKey: BlueprintSceneStageKey,
  stageIndex: number
): BlueprintSceneStageSignal {
  const total = BLUEPRINT_SCENE_STAGES.length;
  const progress =
    total > 1 ? (stageIndex / (total - 1)) * 100 : stageIndex === 0 ? 0 : 100;
  return {
    stageKey,
    stageIndex,
    totalStages: total,
    progress,
  };
}

/**
 * 把 BlueprintSceneStageSignal 包装成 SceneStageFlow 既有渲染管线消费的
 * SceneStageSignal 形状。
 *
 * 让 SceneStageFlow 在蓝图模式下零修改即可复用同一份 zone trail / 颜色 /
 * progress 渲染逻辑。`source` 设为 "workflow" 让既有过滤器一致。
 *
 * 容忍 SAFE_DEFAULT_SIGNAL 输入，但仅当 zoneTrail.length >= 2 时返回非空 signal；
 * 蓝图刚启动且当前 stage = "input" 时仍然有 mission → leadDesk 两点 trail，
 * SceneStageFlow 自然会渲染第一段流线（对应 AC7：初始空态稳定）。
 *
 * @param signal 标准化蓝图阶段信号
 * @param locale 当前语言
 * @returns SceneStageSignal 兼容对象，或 null（zoneTrail 不足时）
 */
export function adaptBlueprintSignalToSceneStageSignal(
  signal: BlueprintSceneStageSignal,
  locale: AppLocale
): SceneStageSignal | null {
  const semantic = STAGE_SEMANTIC[signal.stageKey];
  const zones = STAGE_ZONES[signal.stageKey];
  if (!zones || zones.length < 2) return null;

  // 校验 zone id 都在 SCENE_FLOW_ZONES 里（防御性）
  for (const zoneId of zones) {
    if (!SCENE_FLOW_ZONES[zoneId]) return null;
  }

  const stageLabel = STAGE_TITLES[signal.stageKey][locale];
  const statusLabel =
    locale === "zh-CN" ? "蓝图驾驶舱推进中" : "Blueprint Driving";

  return {
    source: "workflow",
    stageKey: signal.stageKey,
    stageLabel,
    semantic,
    color: SCENE_STAGE_SEMANTIC_COLORS[semantic],
    zones,
    statusLabel,
    summary: null,
    progress: signal.progress,
    taskId: null,
  };
}
