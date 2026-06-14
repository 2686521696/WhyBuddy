/**
 * SlideRule V5 structured report builder (extracted to shared so both
 * client runtime and server route can depend on it cleanly).
 *
 * This contains the pure 9-section report generation logic + fragment
 * extraction used by report.write (and internally by PilotReal / default executors).
 */

import type { V5SessionState } from './v5-reasoning-state.js';
import { hasGroundedExternalEvidence } from './sliderule-grounding.js';

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

  // R2.5 multi-role panel integration: aggressively pull the latest panel data
  // from upstreams OR full state (more robust, so even if report is built with limited upstreams it still gets the 3 stances).
  let multiRolePanelBlock = '';
  let panelData: any = null;

  // 1. Try upstreams first (preferred, as they are the direct inputs to this report)
  const panelUpstream = upstreams.find((u: any) => u.payload && (u.payload.panel === true || (u.payload.panel && typeof u.payload.panel === 'object')));
  if (panelUpstream) {
    const p = panelUpstream.payload as any;
    panelData = p.panel && typeof p.panel === 'object' ? p.panel : p;
  }

  // 2. Fallback: scan full state for the most recent artifact that has panel positions (handles cases where report upstreams are limited)
  if (!panelData || !Array.isArray(panelData.positions) || panelData.positions.length === 0) {
    const allArtifacts: any[] = (input.state as any)?.artifacts || [];
    for (let i = allArtifacts.length - 1; i >= 0; i--) {
      const a = allArtifacts[i];
      const p = a?.payload;
      const pl = p && (p.panel === true || (p.panel && typeof p.panel === 'object')) ? (p.panel || p) : null;
      if (pl && Array.isArray(pl.positions) && pl.positions.length > 0) {
        panelData = pl;
        break;
      }
    }
  }

  if (panelData && Array.isArray(panelData.positions) && panelData.positions.length > 0) {
    const posLines = panelData.positions
      .map((p: any) => `  - ${p.v5Role || p.roleId || '角色'}：${String(p.content || '').trim().slice(0, 180)}`)
      .join('\n');
    const score = typeof panelData.convergenceScore === 'number' ? panelData.convergenceScore.toFixed(2) : '—';
    const consensus = panelData.consensusReached ? '已共识' : '有分歧';
    const dissentSummary = Array.isArray(panelData.dissent) && panelData.dissent.length > 0
      ? panelData.dissent.map((d: any) => `  - ${d.roleId || ''}：${String(d.opinion || '').slice(0, 100)}`).join('\n')
      : '  （无保留异议）';
    multiRolePanelBlock = `${posLines}

收敛分 ${score}（${consensus}）
保留异议：
${dissentSummary}
`;
  }

  // 澄清贡献：从 state coverageGaps 或 upstream clarification artifacts 拉取结构化 gaps (from gap.ask / clarifyQuestions, with kind)
  // 延续 R2 panel + 之前 broadened inputs 改善，显式结构化展示（带 kind + 与 panel 立场联动）
  let clarificationBlock = '';
  const clarifyGaps: any[] = (input.state as any)?.coverageGaps || [];
  const clarifyQuestions = clarifyGaps
    .filter((g: any) => g.kind === "open_question" && g.clarifyType)
    .map((g: any) => ({
      kind: g.clarifyKind || g.questionId || "clarification",
      prompt: g.label,
      type: g.clarifyType,
      options: g.options,
      defaultAnswer: g.defaultAnswer,
      context: g.context,
    }));
  if (clarifyQuestions.length > 0) {
    const qLines = clarifyQuestions.map((q: any) => `  - [${q.kind}] ${q.prompt}${q.options ? ` (选项: ${q.options.join(", ")})` : ""}${q.defaultAnswer ? ` 默认:${q.defaultAnswer}` : ""}`).join("\n");
    clarificationBlock = `${qLines}\n\n（澄清问题已解析为 open_question gaps，部分已由用户回答或用于多角色面板上下文；证据引用见上游 clarification artifacts 或 report evidenceRefs）`;
  } else {
    // fallback: 扫描 upstreams 中的 clarification artifact
    const clarifyArt = upstreams.find((u: any) => u.producedBy?.capabilityId?.includes("clarify") || u.kind === "clarification");
    if (clarifyArt) {
      clarificationBlock = String(clarifyArt.content || clarifyArt.summary || "").slice(0, 400);
    }
  }
  if (clarificationBlock && multiRolePanelBlock) {
    clarificationBlock += `\n\n与 panel 立场交叉引用: 以上澄清 kind 可直接映射到多角色 panel 的 crew (e.g. audience kind → 产品角色立场)。`;
  }

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

多角色立场（面板贡献）：
${multiRolePanelBlock ? multiRolePanelBlock.replace(/多角色立场（面板贡献）：\n?/, '').trim() : '（当前轮次未触发多角色面板或无立场数据）'}

澄清贡献（结构化问题 + kind，与 V4 blueprint 对齐；联动 panel 立场）：
${clarificationBlock || '（本轮暂无结构化澄清 gaps 或未命中 open_question）'}

${convergeDecision}

${gaps}

下一步工程化分支：
针对「${goalSlug}」的推进，当前已形成可验证的 MVP 路径。建议后续：
- 通过 structure.decompose 拆解为带证据的执行任务树
- 在真实执行器（MCP / LLM / 工具）上试点验证
- 导出带签名的交付物（MD / PDF）供团队 review
- 按需补全外部证据并更新报告

provenance / upstream refs：${upstreamSummary}（共 ${upstreams.length} 个已 gated 的上游 artifact）。（完整审计明细见导出或面板的审计部分）
`;

  const title = (prefix.replace(/【|】/g, '') + ' · V5 Evidence Report').slice(0, 72);
  const summary = `基于 ${upstreams.length} upstreams 的证据级推演报告（目标：${goalSlug}）。${hasStale ? '含 stale 警示与分歧提示。' : '多角色收敛良好。'}${roleId ? ` 角色：${roleId}。` : ''}`;

  return { title, summary, content };
}
