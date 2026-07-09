/**
 * Autopilot 子阶段摘要派生器（纯函数库）
 *
 * 为 `fabric` stage 下 8 个子阶段（`AutopilotRailSubStage`）派生统一结构化摘要：
 * - 标题（中英双语）
 * - API path
 * - 说明文案
 * - 3 个大号数字指标
 * - 数据就绪标记
 *
 * 对应 spec：`.kiro/specs/autopilot-sub-stage-metrics-extractor/`
 *
 * 硬性约束（与 rail 主文件、resolver 保持一致）：
 * - 纯函数，无 side effect
 * - 不 import `@/lib/store` / `useAppStore`
 * - 不 import React
 * - 不依赖 `window` / `document` / `Date.now()` / `Math.random()`
 *
 * 8 个 `derive*` 子派生函数为模块内部实现，仅通过 `deriveSubStageSummary` 统一派发。
 */

import type { AutopilotRailSubStage, AutopilotRightRailProps } from "./types";
import type { AppLocale } from "@/lib/locale";
import { deriveSpecDocumentTreeStats } from "@/lib/blueprint-spec-document-stats";

/**
 * 单个大号数字指标。
 *
 * `value` 允许为 `number`（就绪分支）或 `string`（未就绪时填 `"-"`，或派生出的字面量
 * 如阶段名、版本号）。`hint` 用于补充说明，例如「活跃 2 / 观察 1」。
 */
export interface SubStageMetric {
  label: string;
  value: string | number;
  hint?: string;
}

/**
 * 子阶段摘要结构。
 *
 * `metrics` 固定 3 个，顺序与 rail 主文件渲染顺序一致；未就绪时各 `value` 可填 `"-"`，
 * 但数组长度始终为 3，避免 UI 判空逻辑散落。
 */
export interface SubStageSummary {
  title: string;
  apiPath: string;
  summary: string;
  /** 固定 3 个指标；顺序由每个 `derive*` 函数自行约定 */
  metrics: [SubStageMetric, SubStageMetric, SubStageMetric];
  dataReady: boolean;
}

/** locale === "zh-CN" 快捷判断，避免每个 derive 函数重复展开三元 */
const isZh = (locale: AppLocale): boolean => locale === "zh-CN";

// ---------------------------------------------------------------------------
// 1. agent_crew_fabric
// ---------------------------------------------------------------------------

function deriveAgentCrewFabric(
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  const zh = isZh(locale);
  const { agentCrew } = props;
  const timelines = agentCrew?.roleTimelines ?? agentCrew?.presence ?? [];
  const events = timelines.reduce(
    (sum, role) => sum + (role.entries?.length ?? 0),
    0,
  );
  const active = timelines.filter((role) => role.state === "active").length;
  const watching = timelines.filter((role) => role.state === "watching").length;
  const reviewing = timelines.filter((role) => role.state === "reviewing")
    .length;
  const dataReady = timelines.length > 0;

  return {
    title: zh ? "协作角色" : "Agent Crew",
    apiPath: "POST /api/blueprint/agent-crew",
    summary: zh
      ? "路线生成协作角色并与运行时能力、日志、浏览器预览资产和证据对齐。"
      : "Route-generated roles aligned with runtime capabilities, logs, browser preview artifacts, and evidence.",
    metrics: [
      {
        label: zh ? "角色数" : "ROLES",
        value: dataReady ? timelines.length : "-",
        hint: dataReady
          ? zh
            ? `活跃 ${active} / 观察 ${watching}`
            : `${active} active / ${watching} watching`
          : undefined,
      },
      {
        label: zh ? "事件数" : "EVENTS",
        value: dataReady ? events : "-",
      },
      {
        label: zh ? "活跃数" : "ACTIVE",
        value: dataReady ? active : "-",
        hint:
          dataReady && reviewing > 0
            ? zh
              ? `评审中 ${reviewing}`
              : `${reviewing} reviewing`
            : undefined,
      },
    ],
    dataReady,
  };
}

// ---------------------------------------------------------------------------
// 2. spec_tree
// ---------------------------------------------------------------------------

function deriveSpecTree(
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  const zh = isZh(locale);
  const { specTree } = props;
  const dataReady = specTree != null;
  const nodes = specTree?.nodes ?? [];
  const leaves = dataReady
    ? nodes.filter(
        (node) => !nodes.some((maybeChild) => maybeChild.parentId === node.id),
      ).length
    : 0;
  const documentStats = deriveSpecDocumentTreeStats(props.job, specTree);

  return {
    title: zh ? "SPEC 树" : "Spec Tree",
    apiPath: "POST /api/blueprint/spec-tree",
    summary: zh
      ? "把选中的路线推导为可编辑的 SPEC 树，冻结 requirements / design / tasks 语义。"
      : "Derive an editable SPEC tree from the selected route; freeze requirements / design / tasks semantics.",
    metrics: [
      {
        label: zh ? "节点数" : "NODES",
        value: dataReady ? nodes.length : "-",
      },
      {
        label: zh ? "叶子数" : "LEAVES",
        value: dataReady ? leaves : "-",
      },
      {
        label: zh ? "文档数" : "DOCS",
        value: dataReady
          ? `${documentStats.generatedDocuments}/${documentStats.totalDocuments}`
          : "-",
        hint: dataReady
          ? zh
            ? `${documentStats.completeNodes} / ${documentStats.totalNodes} 节点完成`
            : `${documentStats.completeNodes} / ${documentStats.totalNodes} nodes complete`
          : undefined,
      },
    ],
    dataReady,
  };
}

// ---------------------------------------------------------------------------
// 3. spec_documents
// ---------------------------------------------------------------------------

/**
 * 本地窄化类型：`BlueprintSpecTree` 的契约目前不含 `documents` 字段，但需求里约定
 * SPEC 文档数量来自 `specTree.documents.length`。因此此处在不污染上层 props 类型的
 * 前提下，局部断言一次可选 `documents` 数组。后续如果 `BlueprintSpecTree` 正式补出
 * `documents`，只需删掉这个局部类型即可。
 */
type SpecTreeWithDocuments = {
  documents?: Array<unknown>;
};

function deriveSpecDocuments(
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  const zh = isZh(locale);
  const specTreeWithDocs = props.specTree as
    | (SpecTreeWithDocuments | null)
    | undefined;
  const documents = specTreeWithDocs?.documents ?? [];
  const dataReady = documents.length > 0;

  return {
    title: zh ? "SPEC 文档" : "Spec Documents",
    apiPath: "POST /api/blueprint/spec-documents",
    summary: zh
      ? "从 SPEC 树生成规格文档：requirements / design / tasks 三件套可编辑预览。"
      : "Generate spec documents from the SPEC tree: editable previews for requirements / design / tasks.",
    metrics: [
      {
        label: zh ? "文档数" : "DOCS",
        value: dataReady ? documents.length : "-",
      },
      {
        label: zh ? "已提交" : "SUBMITTED",
        value: "-",
      },
      {
        label: zh ? "待更新" : "PENDING",
        value: "-",
      },
    ],
    dataReady,
  };
}

// ---------------------------------------------------------------------------
// 4. effect_preview
// ---------------------------------------------------------------------------

function deriveEffectPreview(
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  const zh = isZh(locale);
  const previews = props.effectPreviews ?? [];
  const dataReady = previews.length > 0;
  const latestVersion = previews[0]?.version ?? "-";
  const currentStage = props.job?.stage ?? "-";

  return {
    title: zh ? "效果预演" : "Effect Preview",
    apiPath: "POST /api/blueprint/effect-previews",
    summary: zh
      ? "对生成出的方案进行预演，绑定 3D 场景 / HUD / 浏览器运行时。"
      : "Preview the generated plan bound to 3D scene / HUD / browser runtime.",
    metrics: [
      {
        label: zh ? "预演数" : "PREVIEWS",
        value: dataReady ? previews.length : "-",
      },
      {
        label: zh ? "最新版本" : "LATEST",
        value: latestVersion,
      },
      {
        label: zh ? "当前阶段" : "STAGE",
        value: currentStage,
      },
    ],
    dataReady,
  };
}

// ---------------------------------------------------------------------------
// 5. prompt_package（占位）
// ---------------------------------------------------------------------------

function derivePromptPackage(
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  const zh = isZh(locale);
  const dataReady = props.specTree != null;

  return {
    title: zh ? "提示词包" : "Prompt Package",
    apiPath: "POST /api/blueprint/prompt-packages",
    summary: zh
      ? "把效果预演转成可分发的提示词包，支持 Cursor / Kiro / Trae / Codex / Claude。"
      : "Turn effect previews into distributable prompt packages for Cursor / Kiro / Trae / Codex / Claude.",
    metrics: [
      { label: zh ? "提示词包数" : "PACKAGES", value: "-" },
      { label: zh ? "平台数" : "PLATFORMS", value: "-" },
      { label: zh ? "当前版本" : "VERSION", value: "-" },
    ],
    dataReady,
  };
}

// ---------------------------------------------------------------------------
// 6. runtime_capability
// ---------------------------------------------------------------------------

function deriveRuntimeCapability(
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  const zh = isZh(locale);
  const capabilities = props.capabilities ?? [];
  const invocations = props.capabilityInvocations ?? [];
  const evidence = props.capabilityEvidence ?? [];
  const dataReady =
    capabilities.length > 0 || invocations.length > 0 || evidence.length > 0;

  return {
    title: zh ? "运行时能力" : "Runtime Capability",
    apiPath: "POST /api/blueprint/runtime-capability",
    summary: zh
      ? "运行时能力桥：把路线生成的调用映射成实际执行的工具链路，收集证据。"
      : "Runtime capability bridge: map route-generated calls to actual tool execution and collect evidence.",
    metrics: [
      {
        label: zh ? "能力数" : "CAPS",
        value: capabilities.length,
      },
      {
        label: zh ? "调用数" : "CALLS",
        value: invocations.length,
      },
      {
        label: zh ? "证据数" : "EVIDENCE",
        value: evidence.length,
      },
    ],
    dataReady,
  };
}

// ---------------------------------------------------------------------------
// 7. engineering_handoff（占位）
// ---------------------------------------------------------------------------

function deriveEngineeringHandoff(
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  const zh = isZh(locale);
  const dataReady = props.selection != null;

  return {
    title: zh ? "工程交接" : "Engineering Handoff",
    apiPath: "POST /api/blueprint/engineering-handoff",
    summary: zh
      ? "把提示词包落到工程执行上，记录落地计划 / 执行步骤 / 验证命令。"
      : "Bring prompt packages into engineering execution with landing plans / steps / verification commands.",
    metrics: [
      { label: zh ? "落地计划数" : "PLANS", value: "-" },
      { label: zh ? "执行步骤数" : "STEPS", value: "-" },
      { label: zh ? "已选平台" : "PLATFORM", value: "-" },
    ],
    dataReady,
  };
}

// ---------------------------------------------------------------------------
// 8. artifact_memory（占位）
// ---------------------------------------------------------------------------

function deriveArtifactMemory(
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  const zh = isZh(locale);
  const dataReady = props.selection != null;

  return {
    title: zh ? "资产记忆" : "Artifact Memory",
    apiPath: "POST /api/blueprint/artifact-memory",
    summary: zh
      ? "沉淀整条 Autopilot 链路的资产、回放、反馈，供后续项目复用。"
      : "Consolidate artifacts, replays, and feedback across the Autopilot chain for future project reuse.",
    metrics: [
      { label: zh ? "资产数" : "ARTIFACTS", value: "-" },
      { label: zh ? "回放数" : "REPLAYS", value: "-" },
      { label: zh ? "反馈数" : "FEEDBACK", value: "-" },
    ],
    dataReady,
  };
}

// ---------------------------------------------------------------------------
// 主派发函数
// ---------------------------------------------------------------------------

/**
 * 根据 `subStage` 派发到对应的子派生函数。
 *
 * `default` 分支使用 `satisfies never` 锁定 `AutopilotRailSubStage` union 完整性：
 * 如果未来新增一个子阶段而未在此处添加 case，编译器会立即报错。
 */
export function deriveSubStageSummary(
  subStage: AutopilotRailSubStage,
  props: AutopilotRightRailProps,
  locale: AppLocale,
): SubStageSummary {
  switch (subStage) {
    case "agent_crew_fabric":
      return deriveAgentCrewFabric(props, locale);
    case "spec_tree":
      return deriveSpecTree(props, locale);
    case "effect_preview":
      return deriveEffectPreview(props, locale);
    case "prompt_package":
      return derivePromptPackage(props, locale);
    case "runtime_capability":
      return deriveRuntimeCapability(props, locale);
    case "engineering_handoff":
      return deriveEngineeringHandoff(props, locale);
    case "artifact_memory":
      return deriveArtifactMemory(props, locale);
    default:
      return subStage satisfies never;
  }
}
