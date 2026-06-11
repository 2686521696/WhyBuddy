import dotenv from "dotenv";
dotenv.config();
import { executeDialogueCapability } from "../server/whybuddy/dialogue-exec-map.js";

const goal = { text: "权限系统 RBAC+数据范围", status: "needs_refinement" };
const gen = await executeDialogueCapability({
  capabilityId: "route.generate",
  state: { sessionId: "c", goal, artifacts: [], staleArtifactIds: [] },
  turnId: "cg",
  roleId: "架构",
});
const art = {
  id: "r",
  kind: "route_options",
  title: gen.title,
  content: gen.content,
  trustLevel: "gated_pass",
  provenance: "llm",
  producedBy: { capabilityRunId: "x", capabilityId: "route.generate", roleId: "架构" },
  passedGates: [],
};
const cmp = await executeDialogueCapability({
  capabilityId: "route.compare",
  state: { sessionId: "c2", goal, artifacts: [art], staleArtifactIds: [] },
  turnId: "cc",
  roleId: "工程",
  inputArtifactIds: ["r"],
});
console.log(
  JSON.stringify({
    genRouteCount: (gen.content.match(/路线[一二三四五六]/g) || []).length,
    cmpAnchors: [...new Set(cmp.content.match(/路线[一二三四五六]/g) || [])],
    comparesWithoutInventing: !/路线三[:：][^\n]{6,}/.test(cmp.content) || gen.content.includes("路线三"),
    head: cmp.content.slice(0, 500),
  })
);