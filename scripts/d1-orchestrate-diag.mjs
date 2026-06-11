import dotenv from "dotenv";
dotenv.config();
import { executeOrchestratePlan } from "../server/whybuddy/orchestrate-plan.js";

const state = {
  sessionId: "d1-diag",
  goal: { text: "做一个权限管理系统（支持 RBAC + 数据范围）", status: "needs_refinement" },
  artifacts: [],
  staleArtifactIds: [],
  decisionLedger: [],
  capabilityRuns: [],
};

const sentences = [
  "用户第一次打开会看到什么",
  "这个方案上线后运维要投入多少人力?",
];

for (const userText of sentences) {
  const t0 = Date.now();
  const r = await executeOrchestratePlan({
    state,
    turnId: `diag-${Date.now()}`,
    userText,
  });
  console.log(
    JSON.stringify({
      userText,
      elapsedMs: Date.now() - t0,
      source: r.source,
      reason: r.reason,
      chose: r.selected.map((s) => s.capabilityId),
      rationale: r.rationale?.slice(0, 120),
    })
  );
}