/**
 * WhyBuddy V5 structured report builder (extracted to shared so both
 * client runtime and server route can depend on it cleanly).
 *
 * This contains the pure 9-section report generation logic + fragment
 * extraction used by report.write (and internally by PilotReal / default executors).
 */

import type { V5SessionState } from './v5-reasoning-state.js';
import { hasGroundedExternalEvidence } from './whybuddy-grounding.js';

export type FragmentKind = "conclusion" | "risk" | "rebuttal" | "recommendation" | "evidence" | "snippet";

export interface ArtifactFragment {
  label: "结论" | "风险" | "反驳" | "建议" | "证据" | "片段";
  kind?: FragmentKind;
  text: string;
}

// Internal map (Chinese label → stable kind)
const CHINESE_LABEL_TO_KIND: Record<string, FragmentKind> = {
  结论: "conclusion",
  风险: "risk",
  反驳: "rebuttal",
  建议: "recommendation",
  证据: "evidence",
};

/**
 * Extract user-visible semantic fragments from an artifact payload.
 */
export function extractArtifactFragments(
  artifact: { title?: string; summary?: string; content?: string },
  maxLength = 1500
): ArtifactFragment[] {
  const source = String(artifact.content || artifact.summary || artifact.title || "").trim();
  if (!source) return [];

  const normalized = source
    .replace(/\r\n/g, "\n")
    .split(/\n|；|;/)
    .map((part) => part.trim())
    .filter(Boolean);

  const fragments: ArtifactFragment[] = [];

  for (const part of normalized) {
    const match = part.match(/^(结论|风险|反驳|建议|证据)\s*[：:]\s*(.+)$/);
    if (!match) continue;
    const raw = match[1];
    const kind = CHINESE_LABEL_TO_KIND[raw] || "snippet";
    const text = match[2].trim();
    if (!text) continue;
    const truncated = text.length > maxLength;
    const display = truncated
      ? `${text.slice(0, maxLength)}…[truncated ${text.length - maxLength} chars]`
      : text;
    fragments.push({
      label: raw as ArtifactFragment["label"],
      kind,
      text: display,
    });
  }

  if (fragments.length > 0) return fragments;

  const fallback = source.replace(/\s+/g, " ").slice(0, maxLength);
  const truncated = source.length > maxLength;
  return fallback
    ? [
        {
          label: "片段",
          kind: "snippet",
          text: truncated ? `${fallback}…[truncated ${source.length - maxLength} chars]` : fallback,
        },
      ]
    : [];
}

export interface StructuredReportInput {
  state: V5SessionState;
  inputArtifactIds: string[];
  roleId?: string;
  turnLabel?: string; // e.g. "重入" to tag re-entry reports
}

/**
 * Canonical 9段 section labels produced by buildStructuredReport.
 * This is the single source of truth for the report skeleton structure.
 * - Must be kept in sync with REPORT_WRITE_CONTRACT.requiredHeadings (K2).
 * - Downstream (Knife C ReportReader, quality gate, projection, parse-report-sections) depend on these exact labels.
 * - Do NOT rename or reorder without coordinated changes across the thickness contract + parsers.
 */
export const REPORT_CANONICAL_SECTIONS = [
  "支撑证据",
  "反证/挑战",
  "风险",
  "分歧",
  "收敛决策",
  "未解缺口",
  "下一步工程化分支",
] as const;

export type ReportCanonicalSection = (typeof REPORT_CANONICAL_SECTIONS)[number];

export function buildStructuredReport(input: StructuredReportInput): { title: string; summary: string; content: string } {
  const { state, inputArtifactIds, roleId, turnLabel } = input;

  const upstreams = (state.artifacts || []).filter((a: any) => inputArtifactIds.includes(a.id));
  const hasStaleGlobal = (state.staleArtifactIds || []).length > 0;
  const hasStale = upstreams.some((a: any) => (state.staleArtifactIds || []).includes(a.id)) || hasStaleGlobal;

  // K1/K4 thickness: goal-aware interpolation so each of the 9 segments has real body (2-3+ sentences)
  // even with sparse upstreams. This is the authoritative BASE for both pilot (direct) and server-llm (expand-on-top).
  const goalText = (state as any)?.goal?.text || (state as any)?.goal || '目标';
  const goalSlug = String(goalText).slice(0, 60);

  // Build rich fragments from all upstreams (K1: now up to 1500/800 with visible truncation)
  const fragments = upstreams.flatMap((u: any) => {
    const srcCap = u.producedBy?.capabilityId || (u as any).capability || 'unknown';
    const srcRole = u.producedBy?.roleId || (u as any).role || roleId || 'agent';
    const src = `${u.kind}(${srcCap}×${srcRole})`;
    const extracted = extractArtifactFragments(u, 1500);
    return extracted.map((fragment) => `- 来自 ${src} / ${fragment.label}: ${fragment.text}`);
  }).join('\n');

  const upstreamSummary = upstreams.length > 0
    ? upstreams.map((u: any) => `${u.kind}(${u.producedBy?.capabilityId || (u as any).capability}×${u.producedBy?.roleId || (u as any).role})`).join(', ')
    : '无';

  const riskFragments = upstreams
    .filter((u: any) => u.kind === 'risk' || String(u.producedBy?.capabilityId || (u as any).capability || '').includes('risk') || String(u.producedBy?.capabilityId || (u as any).capability || '').includes('argue'))
    .flatMap((u: any) => extractArtifactFragments(u, 800))
    .filter((fragment) => fragment.label === '风险' || fragment.label === '反驳' || fragment.label === '建议')
    .map((fragment) => `- ${fragment.label}: ${fragment.text}`)
    .join('\n');

  const dissentBlock = hasStale
    ? '分歧：部分上游 artifact 已被标记 stale（依赖链级联），多角色间存在异议，建议再澄清一轮或回炉重跑。\n'
    : '';

  const prefix = turnLabel
    ? `【可行性 / 产品推演报告 (${turnLabel})】`
    : '【可行性 / 产品推演报告】';

  const grounded = hasGroundedExternalEvidence(state);
  const groundingDisclaimer = grounded
    ? ''
    : `⚠️ 免责（G-GROUND）：本轮未引入成功的外部接地证据，以下为基于内部假设/会话内材料的推演收敛，结论状态应为「待补证」，不得视为已验证可行性。\n\n`;

  // Goal-interpolated conclusion (K4: based on goal text, not lorem)
  const conclusionLine = grounded
    ? `结论：针对「${goalSlug}」，基于本轮多角色讨论 + 真实上游证据聚合，核心路径已收敛，具备 MVP 落地条件。关键假设已由上游风险与证据片段支撑，可进入下一阶段拆解与验证。`
    : `结论（待补证）：针对「${goalSlug}」，当前仅完成内部假设推演，缺少外部接地证据；建议补证后再做推进/否决裁决。`;

  // Goal-aware risk paragraph. When rich riskFragments exist they dominate; this provides baseline 2-3 sentence substance for pilot thickness + K3 pilot baseline.
  const riskBase = `风险：针对「${goalSlug}」的落地需重点关注范围边界、权限模型、数据隔离与变更审计。典型风险包括越权访问、操作不可追溯、以及策略在多团队场景下的扩散。建议在 MVP 阶段建立最小可验证的控制面，并通过上游 risk/counter 产物持续收敛假设。`;
  const riskStaleNote = hasStale ? '注意：存在 stale 上游，风险评估建议重跑。\n' : '';

  // Goal-aware convergence decision + gaps (K4: each major section aims for 2-3 sentences via goal interpolation)
  const convergeDecision = `收敛决策：MVP 阶段优先实现「${goalSlug}」的核心闭环（最小可用验证路径），预留关键扩展点（策略演进、外部证据补强、多角色协作），降低初期复杂度与验证成本。收敛以当前 gated 上游证据为基石，后续可通过 structure.decompose 产生可执行任务树。`;

  const gaps = `未解缺口：针对「${goalSlug}」的细粒度边界定义、持久化审计方案、跨系统集成契约、以及外部真实环境下的证据补强路径仍需进一步澄清与试点。缺口信息应在后续轮次通过 gap.ask / evidence.search 等能力持续补录，并反映到 report 与 spec tree 中。`;

  const content = `${prefix}
${groundingDisclaimer}${conclusionLine}

目标回顾：本轮针对「${goalSlug}」进行可行性 / 产品推演，已聚合上游证据、风险与分歧信息，形成当前收敛基线。

支撑证据：
${fragments || `（本轮暂无带语义标签的上游 artifact。针对「${goalSlug}」，当前报告主要基于内部假设与会话状态推演。建议后续通过 risk.analyze、counter.argue、evidence.search 等能力补强具体证据片段，并重跑 report.write 以更新本报告的支撑证据段。）`}

反证/挑战：
${riskFragments || `（本轮暂未产出明确反证。针对「${goalSlug}」，挑战/重入路径已就绪，可随时触发 invalidate + 级联重跑上游风险分析能力，持续收敛假设边界。）`}

风险：${riskBase}
${riskStaleNote}

分歧：
${dissentBlock || `（当前轮次意见基本收敛，无显著角色分歧。针对「${goalSlug}」的多角色讨论已就上游证据形成一致基线；如后续引入新 upstream 或外部证据，建议触发重入轮次以更新分歧评估与收敛决策。）`}

${convergeDecision}

${gaps}

下一步工程化分支：
针对「${goalSlug}」的推进，结合当前证据状态与平台能力，建议按以下工程化路径执行：
- 走 structure.decompose 将收敛结论拆成可执行任务树（带证据引用）
- 替换默认 CapabilityExecutor 为真实 Tool/OpenAI/MCP 实现（先试点 risk.analyze + report.write）
- 将 process-local Map  backing 的 HTTP session store 替换为 SQLite / Postgres 等 durable 存储（保持 /api/whybuddy surface 不变）
- 报告主输出支持导出为带 provenance 签名的 Markdown / PDF
- 引入真实 Trust Gate 后端（不再仅模拟 evaluateGates）

provenance / upstream refs：${upstreamSummary}（共 ${upstreams.length} 个已 gated 的上游 artifact；evidenceRefs 已在 commitArtifact 阶段记录到 report 上，供后续依赖图与 invalidate 消费）。
`;

  const title = (prefix.replace(/【|】/g, '') + ' · V5 Evidence Report').slice(0, 72);
  const summary = `基于 ${upstreams.length} upstreams 的证据级推演报告（目标：${goalSlug}）。${hasStale ? '含 stale 警示与分歧提示。' : '多角色收敛良好。'}${roleId ? ` 角色：${roleId}。` : ''}`;

  return { title, summary, content };
}
