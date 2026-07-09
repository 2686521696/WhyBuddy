/**
 * Dev-only fixture: a rich, reference-matching structured BrainstormReasoningGraph.
 *
 * Product推演平台场景（非法律/养犬）。用于 2D ReasoningFlowSurface 视觉 QA。
 * 主题：AI 产品推演平台在 SPEC Tree 阶段为什么需要默认切到 2D Reasoning Map。
 *
 * 保留了原结构（节点数、连接、角色、telemetry/console 数量）以维持截图可比性，
 * 但所有标题、body、console、边 label 均为产品推演语义。
 *
 * Used by the wall-fixture harness (?surface=2d) for credible product screenshots.
 * NOT shipped runtime data.
 */

import type { BrainstormReasoningGraph } from "@shared/blueprint";

export const REASONING_GRAPH_FIXTURE: BrainstormReasoningGraph = {
  id: "graph-fixture-1",
  jobId: "blueprint-job-fixture",
  stage: "spec_tree",
  source: "llm",
  centralQuestion: {
    id: "q-central",
    title: "为什么当前 AI 产品推演平台在 SPEC Tree 阶段需要切到 2D Reasoning Map？",
    body: "用户目标：让 reasoning-heavy 阶段的密集推理路径更可探索。需要评估 3D 墙面 vs 2D 无限画布的权衡、viewModel 主路径、raw graph 防御入口。",
  },
  telemetry: {
    tokenBurn: 189116,
    sourceCount: 371,
    remainingBudget: 1057,
    elapsedMs: 5700,
    activeRoleCount: 4,
  },
  consoleLines: [
    { id: "c1", kind: "Ask", text: "SPEC Tree 阶段 3D 墙面是否适合承载密集推理卡片与路径？", roleId: "clarifier" },
    { id: "c2", kind: "Thinking", text: "右栏 sub-stage 与视觉阶段是否同源，2D 是否能更好承载 hover 路径高亮。", roleId: "planner" },
    { id: "c3", kind: "Observation", text: "用户手动切 3D 后，数据刷新容易覆盖偏好；viewModel 路径已带 defense-in-depth。", roleId: "researcher" },
    { id: "c4", kind: "Report", text: "决策：reasoning-heavy 阶段默认 2D，保留 3D toggle；以 viewModel 为主路径，raw graph 仅作防御。", roleId: "architect" },
  ],
  nodes: [
    {
      id: "q-central",
      type: "question",
      title: "为什么当前 AI 产品推演平台在 SPEC Tree 阶段需要切到 2D Reasoning Map？",
      body: "用户目标：让 reasoning-heavy 阶段的密集推理路径更可探索。评估 3D vs 2D、viewModel 主路径、防御入口。",
      status: "open",
      roleId: "clarifier",
      roleLabel: "澄清者",
      order: 0,
    },
    {
      id: "n-setup-1",
      type: "clarification",
      title: "右栏阶段与视觉阶段是否同源？effectiveSubStage 是否应驱动 2D 默认？",
      status: "open",
      roleId: "clarifier",
      roleLabel: "澄清者",
      order: 1,
    },
    {
      id: "n-mid-1",
      type: "hypothesis",
      title: "3D 墙面 texture 不适合承载密集卡片与多层推理路径，2D 无限画布更可探索",
      status: "active",
      roleId: "planner",
      roleLabel: "规划师",
      order: 2,
    },
    {
      id: "n-mid-2",
      type: "evidence",
      title: "用户手动切 3D 后，数据刷新（job.stage / activeReasoningStage 变化）容易覆盖偏好",
      status: "supported",
      roleId: "researcher",
      roleLabel: "接地者",
      order: 3,
    },
    {
      id: "n-mid-3",
      type: "evidence",
      title: "ReasoningFlowSurface 已支持 viewModel 主路径 + raw graph 防御 + hover 路径高亮",
      status: "supported",
      roleId: "researcher",
      roleLabel: "接地者",
      order: 4,
    },
    {
      id: "n-res-1",
      type: "decision",
      title: "reasoning-heavy 阶段（spec_tree / effect_preview）默认 2D，保留 3D toggle",
      status: "resolved",
      roleId: "architect",
      roleLabel: "架构师",
      order: 5,
    },
    {
      id: "n-res-2",
      type: "decision",
      title: "visualModePreference（auto/2d/3d）模型可防止 auto effect 覆盖用户手动选择",
      status: "resolved",
      roleId: "architect",
      roleLabel: "架构师",
      order: 6,
    },
    {
      id: "n-res-3",
      type: "synthesis",
      title: "以 viewModel 为主路径，raw graph 仅作防御入口；activeReasoningStage 作为 gating 权威",
      status: "resolved",
      roleId: "synthesizer",
      roleLabel: "综合器",
      order: 7,
    },
    {
      id: "n-gap-1",
      type: "gap",
      title: "底部 console 与 reasoning console 是否需要分层？telemetry 是否应做左侧纵向指标栏",
      status: "challenged",
      roleId: "critic",
      roleLabel: "挑刺者",
      order: 8,
    },
  ],
  edges: [
    { id: "e1", source: "q-central", target: "n-setup-1", type: "questions", label: "提出" },
    { id: "e2", source: "n-setup-1", target: "n-mid-1", type: "refines", label: "拆解" },
    { id: "e3", source: "q-central", target: "n-mid-2", type: "cites", label: "来源" },
    { id: "e4", source: "q-central", target: "n-mid-3", type: "cites", label: "支撑" },
    { id: "e5", source: "n-mid-2", target: "n-res-1", type: "supports", label: "验证" },
    { id: "e6", source: "n-mid-1", target: "n-res-2", type: "supports", label: "影响" },
    { id: "e7", source: "n-mid-3", target: "n-res-3", type: "synthesizes", label: "收敛" },
    { id: "e8", source: "n-res-3", target: "n-gap-1", type: "conflicts", label: "反证" },
    { id: "e9", source: "n-mid-2", target: "n-gap-1", type: "questions", label: "权衡" },
  ],
};
