/**
 * S18 · Visual capabilities for /whybuddy execute-capability.
 */

import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  auditPreviewReal,
  renderSpecTreeToMermaid,
} from "../../shared/blueprint/whybuddy-visual-chain.js";
import type { RawExecutorResult } from "./capability-exec-map.js";

export type VisualCapabilityId = "ux.preview" | "outcome.visualize";

const VISUAL_CAPS = new Set<string>(["ux.preview", "outcome.visualize"]);

export function isVisualCapability(id: string): id is VisualCapabilityId {
  return VISUAL_CAPS.has(id);
}

function latestArtifact(state: V5SessionState, kind: string) {
  const stale = new Set(state.staleArtifactIds || []);
  const arts = (state.artifacts || []).filter(
    (a) => a.kind === kind && !stale.has(a.id)
  );
  return arts[arts.length - 1];
}

export async function executeVisualCapabilityMapped(
  capabilityId: VisualCapabilityId,
  state: V5SessionState
): Promise<RawExecutorResult & { payload?: { audit?: ReturnType<typeof auditPreviewReal> } }> {
  const goal = state.goal?.text || "目标";

  if (capabilityId === "outcome.visualize") {
    const tree = latestArtifact(state, "spec_tree");
    const mermaid = renderSpecTreeToMermaid(tree?.content || goal);
    return {
      title: "SPEC 结构图 (Mermaid)",
      summary: "确定性渲染 · C_VISREND",
      content: `【预览·未验证】\n\`\`\`mermaid\n${mermaid}\n\`\`\``,
      provenance: "ai_generated",
    };
  }

  const doc = latestArtifact(state, "doc");
  const report = latestArtifact(state, "report");
  const source = doc?.summary || report?.summary || goal;
  const draft =
    `【预览·未验证】模块预览页\n` +
    `目标: ${goal.slice(0, 80)}\n` +
    `基于: ${String(source).slice(0, 120)}\n` +
    `- 权限列表页 · 未验证\n` +
    `- 角色配置页 · 未验证\n` +
    `- 审计日志页 · 未验证`;

  const audit = auditPreviewReal(draft);
  return {
    title: "UX 模块预览",
    summary: audit.passed ? "出图审计通过" : `出图审计打回: ${audit.reason}`,
    content: draft,
    provenance: "ai_generated",
    payload: { audit },
  };
}

/** Test hook: generate intentionally failing preview for audit regression. */
export function buildFakePreviewForAudit(): string {
  return "placeholder copy\nplaceholder copy\nplaceholder copy\nlorem ipsum preview";
}