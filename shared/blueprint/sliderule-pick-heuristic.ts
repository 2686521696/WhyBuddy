/**
 * R1: Deterministic capability picker (heuristic fallback).
 * Moved from client runtime — single implementation for server degradation + local fallback.
 */
import type { V5CapabilityId } from "./contracts.js";
import { V5_CAPABILITY_POOL } from "./contracts.js";
import type { V5SessionState } from "./v5-reasoning-state.js";
import { findGithubUrlInTexts } from "./sliderule-github-context.js";
import {
  hasGroundedExternalEvidence,
  recentUngroundedEvidenceAttempts,
} from "./sliderule-grounding.js";
import {
  needsReadinessChain,
  pickReadinessChainCapabilities,
} from "./sliderule-readiness-chain.js";
import {
  hasSpecTreeArtifact,
  isDeliveryIntent,
  pickDeliveryCapabilities,
  pickStructureBeforeDelivery,
} from "./sliderule-delivery-chain.js";
import {
  resolveRoleMode,
  shouldDegradeBrainstorm,
  pickBrainstormChain,
} from "./sliderule-role-mode.js";
import { isVisualIntent, pickVisualCapabilities } from "./sliderule-visual-chain.js";

function isHealthyArtifact(
  artifact: { id: string; trustLevel?: string },
  staleSet: Set<string>
): boolean {
  return (
    (artifact.trustLevel === "gated_pass" || artifact.trustLevel === "audited") &&
    !staleSet.has(artifact.id)
  );
}

/** Knife A′: extended structure/decompose intent (CN + EN, case-insensitive spec tree). */
export function hasStructureDecomposeIntent(userText: string): boolean {
  if (/结构|分解|decompose/.test(userText)) return true;
  const lower = userText.toLowerCase();
  if (lower.includes("树") || lower.includes("拆解")) return true;
  if (/spec\s*tree/i.test(userText)) return true;
  if (/\btree\b/i.test(userText)) return true;
  return false;
}

export function pickNextCapabilities(
  state: V5SessionState,
  userText: string
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const lower = userText.toLowerCase();
  const picks: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [];

  const available = V5_CAPABILITY_POOL;

  // P0 S11: vague goal / open_question → gap.ask → question.expand before anything else.
  if (needsReadinessChain(state, userText)) {
    return pickReadinessChainCapabilities(state).filter((p) => available.has(p.capabilityId));
  }

  // S19: after clear, delivery intent runs ship pipeline.
  // 交付能力多为模板/确定性(document/task/matrix/instruction/visualize/handoff),
  // 一次性排完整条流水线(含 spec 树前置),让「生成交付物」一键产出全部交付物。
  if (isDeliveryIntent(userText) && state.goal?.status === "clear") {
    const delivery = pickDeliveryCapabilities(state);
    const structure = pickStructureBeforeDelivery(state, userText);
    // 推演报告是最重要的交付物 —— 若本会话收敛时没产出过可信报告(LLM 调度可能跳过),
    // 交付前先补一发 report.write,保证交付物始终含报告。
    const stales = new Set(state.staleArtifactIds || []);
    const hasTrustedReport = (state.artifacts || []).some(
      (a) => a.kind === "report" && isHealthyArtifact(a, stales)
    );
    const reportPrefix =
      !hasTrustedReport && V5_CAPABILITY_POOL.has("report.write")
        ? [{ capabilityId: "report.write" as V5CapabilityId, roleId: "综合" }]
        : [];
    return [...reportPrefix, ...structure, ...delivery].slice(0, 9);
  }

  // S18: visual / mermaid intents after doc or tree exists.
  if (isVisualIntent(userText) || /mermaid|结构图渲染/.test(userText)) {
    const vis = pickVisualCapabilities(state, userText);
    if (vis.length > 0) return vis.slice(0, 5);
  }

  // P6: complex role mode primes deliberation before standard picks.
  const roleMode = resolveRoleMode(state, userText);

  const stales = new Set(state.staleArtifactIds || []);
  const existingKinds = new Set(
    (state.artifacts || [])
      .filter((a) => isHealthyArtifact(a, stales))
      .map((a) => a.kind)
  );
  const hasRisk = existingKinds.has("risk");
  const hasSynthesis = existingKinds.has("synthesis");
  const hasReport = existingKinds.has("report");
  const staleCount = (state.staleArtifactIds || []).length;
  const recentRuns = (state.capabilityRuns || []).slice(-6).map((r) => r.capabilityId);
  const openQCount = (state.openQuestions || []).length;
  const recentLedgerCaps = (state.capabilityRuns || []).slice(-4).map((r) => r.capabilityId);
  const ungroundedEvidenceAttempts = recentUngroundedEvidenceAttempts(state, 3);
  const sessionGrounded = hasGroundedExternalEvidence(state);
  const shouldSkipEvidenceSearch =
    !sessionGrounded && ungroundedEvidenceAttempts >= 2;

  const artifactCount = (state.artifacts || []).filter((a) =>
    isHealthyArtifact(a, stales)
  ).length;
  const isColdStart = artifactCount === 0 && (state.capabilityRuns || []).length === 0;

  const ghUrl = findGithubUrlInTexts(lower, state.goal?.text || "");
  if (ghUrl) {
    if (available.has("repo.inspect") && !picks.some((p) => p.capabilityId === "repo.inspect")) {
      picks.push({ capabilityId: "repo.inspect", roleId: "工程" });
    }
    if (
      !shouldSkipEvidenceSearch &&
      available.has("evidence.search") &&
      !picks.some((p) => p.capabilityId === "evidence.search")
    ) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
  }

  if (lower.includes("路线") || lower.includes("route") || lower.includes("对比")) {
    if (available.has("route.generate")) picks.push({ capabilityId: "route.generate", roleId: "架构" });
    if (available.has("route.compare")) picks.push({ capabilityId: "route.compare", roleId: "工程" });
  }
  if (lower.includes("澄清") || lower.includes("clarif") || lower.includes("模糊")) {
    if (available.has("intent.clarify")) picks.push({ capabilityId: "intent.clarify", roleId: "产品" });
  }
  if (lower.includes("风险") || lower.includes("安全") || lower.includes("反驳")) {
    if (available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
    if (available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
  }
  if (
    hasStructureDecomposeIntent(userText) &&
    !hasSpecTreeArtifact(state) &&
    available.has("structure.decompose")
  ) {
    picks.push({ capabilityId: "structure.decompose", roleId: "架构" });
  }
  if (lower.includes("报告") || lower.includes("report") || lower.includes("可行性") || lower.includes("总结")) {
    if (!hasRisk && available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
    if (!hasRisk && available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
    if (!hasSynthesis && available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
    if (!hasReport && available.has("report.write")) picks.push({ capabilityId: "report.write", roleId: "综合" });
  }
  if (lower.includes("预览") || lower.includes("效果") || lower.includes("preview")) {
    if (available.has("scenario.simulate")) picks.push({ capabilityId: "scenario.simulate", roleId: "工程" });
  }

  if (staleCount > 0) {
    if (!picks.some((p) => p.capabilityId.includes("risk") || p.capabilityId.includes("argue"))) {
      if (available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
      if (available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
    }
  }

  if (hasRisk && !hasSynthesis && !hasReport) {
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  if (hasSynthesis && !hasReport) {
    if (available.has("report.write")) picks.push({ capabilityId: "report.write", roleId: "综合" });
  }

  if (openQCount > 0) {
    if (available.has("intent.clarify")) picks.push({ capabilityId: "intent.clarify", roleId: "产品" });
    if (
      available.has("structure.decompose") &&
      !hasSpecTreeArtifact(state) &&
      !picks.some((p) => p.capabilityId === "structure.decompose")
    ) {
      picks.push({ capabilityId: "structure.decompose", roleId: "架构" });
    }
  }

  if (staleCount === 0 && !shouldSkipEvidenceSearch) {
    const avoidLedger = new Set(recentLedgerCaps);
    if (picks.length < 3 && !avoidLedger.has("evidence.search") && available.has("evidence.search")) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
  }

  if (isColdStart && picks.length < 3) {
    if (available.has("intent.clarify") && !picks.some((p) => p.capabilityId === "intent.clarify")) {
      picks.push({ capabilityId: "intent.clarify", roleId: "产品" });
    }
    if (available.has("route.generate") && !picks.some((p) => p.capabilityId === "route.generate")) {
      picks.push({ capabilityId: "route.generate", roleId: "架构" });
    }
    if (available.has("risk.analyze") && !picks.some((p) => p.capabilityId === "risk.analyze")) {
      picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
    }
    if (
      !shouldSkipEvidenceSearch &&
      available.has("evidence.search") &&
      !picks.some((p) => p.capabilityId === "evidence.search")
    ) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
  }

  if (picks.length === 0) {
    const avoidRecent = new Set([...recentRuns, ...recentLedgerCaps]);
    if (!avoidRecent.has("intent.parse") && available.has("intent.parse")) {
      picks.push({ capabilityId: "intent.parse", roleId: "产品" });
    }
    if (
      !shouldSkipEvidenceSearch &&
      !avoidRecent.has("evidence.search") &&
      available.has("evidence.search")
    ) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  if (picks.length === 0) {
    if (available.has("intent.parse")) picks.push({ capabilityId: "intent.parse", roleId: "产品" });
    if (!shouldSkipEvidenceSearch && available.has("evidence.search")) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  if (roleMode === "complex" && !shouldDegradeBrainstorm(state, userText) && picks.length < 4) {
    // 多角色面板链需保持顺序：critique.generate(面板) → synthesis.merge → ……(report)。
    // 整体前置（不用逐个 unshift，否则会把顺序倒过来让 synthesis 跑在 critique 之前）。
    const primers = pickBrainstormChain(state).filter(
      (primer) =>
        available.has(primer.capabilityId) &&
        !picks.some((p) => p.capabilityId === primer.capabilityId)
    );
    if (primers.length > 0) {
      picks.unshift(...primers);
    }
  }

  const seen = new Set<string>();
  return picks
    .filter((p) => {
      const key = `${p.capabilityId}:${p.roleId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}