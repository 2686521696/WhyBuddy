/**
 * D1-A3/A5 manual acceptance runner (live LLM).
 * Usage: pnpm exec tsx scripts/d1-manual-acceptance.mjs
 */
import dotenv from "dotenv";
dotenv.config();

import { executeOrchestratePlan } from "../server/whybuddy/orchestrate-plan.js";
import { executeDialogueCapability } from "../server/whybuddy/dialogue-exec-map.js";
import { pickNextCapabilities } from "../shared/blueprint/whybuddy-pick-heuristic.js";

const GOAL = "做一个权限管理系统（支持 RBAC + 数据范围）";

function freshState(extra = {}) {
  return {
    sessionId: `d1-${Date.now()}`,
    goal: { text: GOAL, status: "needs_refinement" },
    artifacts: [],
    staleArtifactIds: [],
    decisionLedger: [],
    capabilityRuns: [],
    conversation: [],
    ...extra,
  };
}

function healthy(id, kind, content, title) {
  return {
    id,
    kind,
    title: title || id,
    summary: content.slice(0, 80),
    content,
    trustLevel: "gated_pass",
    provenance: "ai_generated",
    producedBy: { capabilityRunId: `run-${id}`, capabilityId: "route.generate", roleId: "架构" },
    passedGates: ["commit"],
  };
}

const DIALOGUE_CASES = [
  { id: "intent.clarify", userText: "这个方案上线后运维要投入多少人力?", roleId: "产品" },
  { id: "route.generate", userText: "用户第一次打开会看到什么", roleId: "架构" },
  { id: "route.compare", userText: "对比一下这几条路线的取舍", roleId: "工程", needsRoutes: true },
  { id: "requirement.write", userText: "把当前结论整理成可评审的需求草案", roleId: "产品", needsUpstream: true },
];

const rows = [];

// Orchestrate spot-check (planning station source)
for (const userText of ["用户第一次打开会看到什么", "竞品是怎么解决这个问题的"]) {
  const state = freshState();
  const heuristic = pickNextCapabilities(state, userText).map((p) => p.capabilityId);
  const orch = await executeOrchestratePlan({ state, turnId: `orch-${Date.now()}`, userText });
  rows.push({
    phase: "orchestrate",
    userText,
    heuristic,
    source: orch.source,
    reason: orch.reason,
    chose: orch.selected.map((s) => s.capabilityId),
    rationale: orch.rationale?.slice(0, 160),
    planningLabel: orch.source === "llm" ? "智能调度" : "规则调度",
  });
}

// D1-A3: four dialogue capabilities
for (const c of DIALOGUE_CASES) {
  const artifacts = [];
  if (c.needsRoutes || c.needsUpstream) {
    artifacts.push(
      healthy(
        "routes-1",
        "route_options",
        "路线一:策略表\n**思路**:集中管控权限\n**适合的前提**:团队≥3人\n**主要代价**:初期建模成本高\n**第一周做什么**:梳理资源模型\n\n路线二:视图封装\n**思路**:快速复用现有查询\n**适合的前提**:只读场景为主\n**主要代价**:复杂条件难维护\n**第一周做什么**:盘点现有视图",
        "路线方案"
      )
    );
  }
  if (c.needsUpstream) {
    artifacts.push(healthy("cl-1", "clarification", "目标：RBAC+数据范围，首期覆盖部门级隔离"));
    artifacts.push(healthy("risk-1", "risk", "主要风险：越权与审计链路过长"));
    artifacts.push(healthy("syn-1", "synthesis", "倾向路线一，但需确认首期范围"));
  }

  const state = freshState({ artifacts });
  const inputArtifactIds = c.needsRoutes ? ["routes-1"] : [];
  let result;
  try {
    result = await executeDialogueCapability({
      capabilityId: c.id,
      state,
      turnId: `d1-${c.id}`,
      roleId: c.roleId,
      inputArtifactIds,
    });
  } catch (e) {
    result = { error: String(e?.message || e) };
  }
  rows.push({
    phase: "dialogue",
    capabilityId: c.id,
    userText: c.userText,
    ok: Boolean(result.content),
    title: result.title,
    summary: result.summary?.slice(0, 100),
    contentHead: result.content?.slice(0, 200),
    error: result.error,
  });
}

// D1-A5 chain: generate → compare
const chainState = freshState();
const gen = await executeDialogueCapability({
  capabilityId: "route.generate",
  state: chainState,
  turnId: "chain-gen",
  roleId: "架构",
});
const chainArtifacts = [
  healthy("chain-routes", "route_options", gen.content || "", gen.title || "路线"),
];
const cmp = await executeDialogueCapability({
  capabilityId: "route.compare",
  state: { ...chainState, artifacts: chainArtifacts },
  turnId: "chain-cmp",
  roleId: "工程",
  inputArtifactIds: ["chain-routes"],
});
rows.push({
  phase: "chain",
  generateTitle: gen.title,
  compareUsesRouteAnchors:
    Boolean(cmp.content?.includes("路线一")) && Boolean(cmp.content?.includes("路线二")),
  compareInventsNewRoutes: /路线三|路线四/.test(cmp.content || ""),
  compareHead: cmp.content?.slice(0, 240),
});

console.log(JSON.stringify({ goal: GOAL, hasKey: Boolean(process.env.LLM_API_KEY), rows }, null, 2));