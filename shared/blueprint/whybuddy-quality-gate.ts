/**
 * K3 · G_QUALITY 内容质量门（新增，非改旧）。
 *
 * 严格二元裁决：满足契约（或 pilot baseline）→ passed，否则 failed。
 * 灵活性全外置到 QualityBaseline（显式可审计，进 T_LEDGER）。
 *
 * - production：执行完整 OutputContract（K2）。
 * - pilot-template：按 K4 升档后的模板能力设定（演示/ pilot 模式专用，在 STATUS 与封条注明 baseline）。
 * - 无契约能力（evidence.search 等）：不参与（契约表缺位 ≠ 例外分支）。
 *
 * 失败走既有重试 / challenged 路径（与 G_SCHEMA 同构），不兜底造假。
 * 满足契约的产物 trustLevel 不受本门额外惩罚。
 */

import type { Artifact } from "./v5-reasoning-state.js"; // 简化，实际运行时 Artifact 带 content 等
import type { OutputContract } from "./whybuddy-output-contracts.js";
import { getOutputContract } from "./whybuddy-output-contracts.js";

export type QualityBaselineName = "production" | "pilot-template";

export interface QualityBaseline {
  name: QualityBaselineName;
  minContentChars: number;
  requireAllRequiredHeadings: boolean;
  requireMinChildBlocks: boolean;
  requireEarsInSections: boolean;
  requireEmbedded: boolean;
  // pilot 可在此放宽具体数字
}

export const PRODUCTION_BASELINE: QualityBaseline = {
  name: "production",
  minContentChars: 0, // 由 contract 决定
  requireAllRequiredHeadings: true,
  requireMinChildBlocks: true,
  requireEarsInSections: true,
  requireEmbedded: true,
};

export const PILOT_TEMPLATE_BASELINE: QualityBaseline = {
  name: "pilot-template",
  minContentChars: 280, // K3+K4 合并：pilot/demo 演示数据可信下限（模板升档后显著厚于原 1-3 行；STATUS/封条会注明 baseline）
  requireAllRequiredHeadings: false,
  requireMinChildBlocks: false,
  requireEarsInSections: false,
  requireEmbedded: false,
};

export type GateVerdict = {
  gateId: string;
  status: "passed" | "failed";
  phase: "commit" | "ship";
  reason?: string;
};

export interface QualityGateResult extends GateVerdict {
  gateId: "quality";
  baseline: QualityBaselineName;
  contractId?: string;
}

function countEarsLike(text: string): number {
  // 简易 EARS 检测：WHEN / IF / AS ... SHALL / SHOULD / MUST
  const re = /\b(WHEN|IF|AS SOON AS|THE .* (SHALL|SHOULD|MUST|WILL))\b/i;
  return (text.match(re) || []).length;
}

function hasMermaid(text: string): boolean {
  return /```mermaid[\s\S]*?```/i.test(text);
}

function hasTsInterface(text: string): boolean {
  return /```(?:ts|typescript)[\s\S]*?interface\s+\w+/i.test(text) || /export\s+interface\s+\w+/i.test(text);
}

function extractHeadings(text: string): string[] {
  const hs: string[] = [];
  const re = /^#{1,3}\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    hs.push(m[1].trim());
  }
  // 也识别 report 风格无 # 的中文段标
  const cn = /(?:^|\n)(支撑证据|反证\/挑战|风险|分歧|收敛决策|未解缺口|下一步工程化分支)\s*[:：]?/g;
  let c;
  while ((c = cn.exec(text)) !== null) {
    hs.push(c[1]);
  }
  return hs;
}

function satisfiesContract(
  content: string,
  contract: OutputContract,
  baseline: QualityBaseline
): { ok: boolean; reason?: string } {
  const body = content || "";
  if (body.length < contract.minContentChars && baseline.name === "production") {
    return { ok: false, reason: `content ${body.length} < min ${contract.minContentChars}` };
  }
  if (baseline.minContentChars > 0 && body.length < baseline.minContentChars) {
    return { ok: false, reason: `content ${body.length} < baseline ${baseline.minContentChars}` };
  }

  if (baseline.requireAllRequiredHeadings && contract.requiredHeadings.length > 0) {
    const present = extractHeadings(body);
    const missing = contract.requiredHeadings.filter((h) =>
      !present.some((p) => p.toLowerCase().includes(h.toLowerCase().replace(/^#+\s*/, "")))
    );
    if (missing.length > 0) {
      return { ok: false, reason: `missing required headings: ${missing.join(", ")}` };
    }
  }

  if (baseline.requireMinChildBlocks && contract.minChildBlocks) {
    const matches = (body.match(contract.minChildBlocks.pattern) || []).length;
    if (matches < contract.minChildBlocks.min) {
      return { ok: false, reason: `child blocks under ${contract.minChildBlocks.heading} only ${matches} < ${contract.minChildBlocks.min}` };
    }
  }

  if (baseline.requireEarsInSections && contract.earsSections && contract.earsSections.length) {
    const earsCount = countEarsLike(body);
    if (earsCount < 1) {
      return { ok: false, reason: "EARS patterns missing in required sections" };
    }
  }

  if (baseline.requireEmbedded && contract.requiredEmbedded) {
    const needM = contract.requiredEmbedded.includes("mermaid");
    const needI = contract.requiredEmbedded.includes("ts_interface");
    if (needM && !hasMermaid(body)) return { ok: false, reason: "missing mermaid block" };
    if (needI && !hasTsInterface(body)) return { ok: false, reason: "missing ts_interface block" };
  }

  return { ok: true };
}

/**
 * 核心质量门。
 * contract 来自 K2 同一对象（单一真相）。
 * 无契约的能力返回 undefined（不参与 quality 裁决）。
 */
export function evaluateQualityGate(
  artifact: Pick<Artifact, "content" | "producedBy"> & { capabilityId?: string },
  contractOverride?: OutputContract,
  baseline: QualityBaseline = PRODUCTION_BASELINE
): QualityGateResult | undefined {
  const capId = (artifact as any).producedBy?.capabilityId || (artifact as any).capabilityId || "";
  const contract = contractOverride || getOutputContract(capId);
  if (!contract) {
    // 契约缺位 → 本门不适用（不是失败）
    return undefined;
  }

  const content = String((artifact as any).content || "");
  const check = satisfiesContract(content, contract, baseline);

  if (check.ok) {
    return {
      gateId: "quality",
      status: "passed",
      phase: "commit",
      baseline: baseline.name,
      contractId: contract.capabilityId,
    };
  }

  return {
    gateId: "quality",
    status: "failed",
    phase: "commit",
    reason: check.reason || "quality contract not satisfied",
    baseline: baseline.name,
    contractId: contract.capabilityId,
  };
}

/**
 * 便捷：给定 baseline 名取对象。
 */
export function getBaseline(name: QualityBaselineName): QualityBaseline {
  return name === "pilot-template" ? PILOT_TEMPLATE_BASELINE : PRODUCTION_BASELINE;
}
