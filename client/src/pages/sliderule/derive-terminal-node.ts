import type {
  BrainstormReasoningEdge,
  BrainstormReasoningNode,
} from "@shared/blueprint/brainstorm-reasoning-graph";
import {
  hasReviewPassRecorded,
  latestTrustedReport,
} from "@shared/blueprint/sliderule-delivery-chain";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveTrustSeal } from "./derive-trust-seal";
import { SLIDERULE_TERMINAL_NODE_ID } from "./sliderule-projection-constants";

export type TerminalNodeMeta = {
  trustSealLine: string;
  goalStatus: string;
  canExport: boolean;
  reportArtifactId: string;
  reportTitle: string;
  summaryExcerpt: string;
};

export type TerminalProjection = {
  node: BrainstormReasoningNode;
  edgeFromReportNodeId?: string;
  edge: BrainstormReasoningEdge | null;
  meta: TerminalNodeMeta;
};

function goalStatusLabel(status?: string): string {
  if (status === "clear") return "建议建设";
  if (status === "not_recommended") return "不建议建设";
  return status || "未知";
}

/** Virtual delivery terminal — projection only (Knife C). */
export function deriveTerminalProjection(
  state: V5SessionState
): TerminalProjection | null {
  const report = latestTrustedReport(state);
  const goalStatus = state.goal?.status;
  if (!report || (goalStatus !== "clear" && goalStatus !== "not_recommended")) {
    return null;
  }

  const seal = deriveTrustSeal(state);
  const statusLabel = goalStatusLabel(goalStatus);
  const canExport =
    goalStatus === "clear" &&
    (state.deliveryPhase === "shipped" || hasReviewPassRecorded(state, report));

  const summaryExcerpt = String(report.summary || report.content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  const meta: TerminalNodeMeta = {
    trustSealLine: seal.displayLine,
    goalStatus: statusLabel,
    canExport,
    reportArtifactId: report.id,
    reportTitle: report.title || "可行性报告",
    summaryExcerpt,
  };

  const reportGraphNode = (state.graph?.nodes || []).find(
    (n) =>
      (n as { producedArtifactId?: string }).producedArtifactId === report.id ||
      n.capabilityId === "report.write"
  );

  const node: BrainstormReasoningNode = {
    id: SLIDERULE_TERMINAL_NODE_ID,
    type: "decision",
    title: "终点交付月台",
    body: `${seal.displayLine}\n${statusLabel} · ${summaryExcerpt}`,
    status: "resolved",
    roleId: "综合",
    roleLabel: "交付",
    conclusionBadge: "终点交付",
    capabilityId: "report.write",
    producedArtifactId: report.id,
    order: 9999,
  };

  const edgeFromReportNodeId = reportGraphNode?.id;
  const edge: BrainstormReasoningEdge | null = edgeFromReportNodeId
    ? {
        id: `${edgeFromReportNodeId}-to-terminal`,
        source: edgeFromReportNodeId,
        target: SLIDERULE_TERMINAL_NODE_ID,
        type: "synthesizes",
        label: "收敛",
      }
    : null;

  return { node, edgeFromReportNodeId, edge, meta };
}