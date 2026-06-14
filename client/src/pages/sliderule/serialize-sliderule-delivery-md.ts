import { latestTrustedReport } from "@shared/blueprint/sliderule-delivery-chain";
import { replayCoverage } from "@shared/blueprint/sliderule-coverage-replay";
import type { V5SessionState, Artifact } from "@shared/blueprint/v5-reasoning-state";
import { deriveTrustSeal } from "./derive-trust-seal";
import { parseReportSections } from "./parse-report-sections";

/** Pure md serializer for Knife C delivery export — does not mutate state. */
export function serializeSlideRuleDeliveryMd(state: V5SessionState): string {
  const report = latestTrustedReport(state);
  const seal = deriveTrustSeal(state);
  const replay = replayCoverage(state);
  const lines: string[] = [];

  lines.push("# SlideRule 交付包");
  lines.push("");
  lines.push(`> ${seal.displayLine}`);
  lines.push("");
  lines.push(`**目标**: ${state.goal?.text || "—"}`);
  lines.push(`**结论状态**: ${state.goal?.status || "—"}`);
  lines.push(`**交付阶段**: ${state.deliveryPhase || "none"}`);
  lines.push("");

  if (report) {
    lines.push("## 推演报告（核心交付 · 人类可读版）");
    lines.push("");
    const sections = parseReportSections(report);
    for (const sec of sections) {
      lines.push(`### ${sec.label}`);
      lines.push("");
      lines.push(sec.body.trim() || "（空）");
      lines.push("");
      if (sec.evidenceRefs.length > 0) {
        lines.push("**证据 / 上游引用**：");
        sec.evidenceRefs.forEach((ref: string) => lines.push(`- ${ref}`));
        lines.push("");
      }
    }
    lines.push("> 注：报告中如有外部 URL、证据 artifact，请在画布上点击对应节点或证据按钮查看完整上下文。");
    lines.push("");
  }

  // 尽力包含其他分类交付物（与 DeliverablesPanel 分类对齐）
  const stale2 = new Set(state.staleArtifactIds || []);
  const trusted2 = (state.artifacts || []).filter(
    (a: any) => (a.trustLevel === "gated_pass" || a.trustLevel === "audited") && !stale2.has(a.id)
  );
  const latestBy = (kindOrCap: string) =>
    [...trusted2].reverse().find((a: any) =>
      a.kind === kindOrCap ||
      String(a.producedBy?.capabilityId || "").includes(kindOrCap) ||
      (kindOrCap === "prompt" && String(a.producedBy?.capabilityId || "").includes("instruction.package")) ||
      (kindOrCap === "handoff" && String(a.producedBy?.capabilityId || "").includes("handoff.package")) ||
      (kindOrCap === "arch" && String(a.producedBy?.capabilityId || "").includes("outcome.visualize"))
    );

  const addSection = (title: string, art: any) => {
    if (!art) return;
    lines.push(`## ${title}`);
    lines.push("");
    const c = String(art.content || "").trim();
    if (title.includes("规格树")) {
      lines.push("```");
      lines.push(c);
      lines.push("```");
    } else if (title.includes("架构图")) {
      const m = c.match(/```mermaid[\s\S]*?```/i);
      lines.push(m ? m[0] : c);
    } else {
      lines.push(c || "（空）");
    }
    lines.push("");
  };

  addSection("规格树（SPEC Tree）", latestBy("spec_tree"));
  addSection("提示词包（Prompt Pack）", latestBy("prompt"));
  addSection("架构图（Arch / Mermaid）", latestBy("arch"));
  addSection("工程交接包（Handoff）", latestBy("handoff"));
  const otherDoc = latestBy("doc") || latestBy("document.draft") || latestBy("task.write");
  if (otherDoc && (!report || otherDoc.id !== report.id)) {
    addSection("规格 / 设计 / 任务文档", otherDoc);
  }

  lines.push("## 审计明细（内部 / 开发者参考，可忽略）");
  lines.push("");
  lines.push("### T_LEDGER 摘要");
  lines.push("");
  const structureRows = (state.structureGateLedger || []).slice(-12);
  if (structureRows.length === 0) {
    lines.push("（无 structure gate 记录）");
  } else {
    for (const row of structureRows) {
      lines.push(
        `- ${row.gateId} attempt=${row.attempt ?? 0} status=${row.status} turn=${row.turnId || "—"}`
      );
    }
  }
  lines.push("");
  const flowRows = (state.flowBoundaryLedger || []).slice(-12);
  if (flowRows.length > 0) {
    lines.push("### Flow boundary");
    for (const row of flowRows) {
      lines.push(
        `- ${row.id} turn=${row.turnId} passed=${row.passed} source=${row.source}`
      );
    }
    lines.push("");
  }

  lines.push("### 证据出处");
  lines.push("");
  const stale = new Set(state.staleArtifactIds || []);
  const evidenceArts = (state.artifacts || []).filter(
    (a) =>
      a.kind === "evidence" &&
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") &&
      !stale.has(a.id)
  );
  if (evidenceArts.length === 0) {
    lines.push("（无健康 evidence 产物）");
  } else {
    for (const ev of evidenceArts) {
      lines.push(
        `- **${ev.id}** (provenance=${ev.provenance || "—"}): ${(ev.summary || ev.title || "").slice(0, 120)}`
      );
    }
  }
  lines.push("");

  lines.push("### GCOV 覆盖回放");
  lines.push("");
  lines.push(`模式: ${replay.mode || "—"} · gatePassed: ${replay.gatePassed}`);
  for (const req of replay.required) {
    lines.push(
      `- ${req.capabilityId}${req.isConvergenceAction ? " (收敛)" : ""}: ${
        req.satisfied ? "✓" : "✗"
      }${req.satisfiedByArtifactId ? ` ← ${req.satisfiedByArtifactId}` : ""}`
    );
  }
  if (replay.openGapIds.length > 0) {
    lines.push("");
    lines.push(`开放缺口: ${replay.openGapIds.join(", ")}`);
  }

  lines.push("");
  lines.push("---");
  lines.push(`Generated by SlideRule · session=${state.sessionId || "—"}`);

  return lines.join("\n");
}

export function downloadSlideRuleDeliveryMd(state: V5SessionState, filename?: string): void {
  const md = serializeSlideRuleDeliveryMd(state);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    filename ||
    `sliderule-delivery-${state.sessionId || "session"}-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}