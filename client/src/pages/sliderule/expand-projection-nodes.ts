import type {
  BrainstormReasoningEdge,
  BrainstormReasoningNode,
} from "@shared/blueprint/brainstorm-reasoning-graph";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { TurnStep, UiTurn } from "./types";
import type { ProjectionDensity } from "./sliderule-projection-constants";
import { eventsByRun } from "@shared/blueprint/sliderule-reasoning-events.js"; // V5.3 P3 for role_critique from events
import type { ReasoningEvent } from "@shared/blueprint/sliderule-reasoning-events";

const MAX_EVIDENCE_CHILDREN = 8;
const MAX_TREE_DEPTH = 4;
const MAX_PHASE_CHILDREN = 3;

function isProjectionChildId(id: string): boolean {
  return (
    id.includes("::ev-") ||
    id.includes("::phase-") ||
    id.includes("::tree-") ||
    id.includes("::role-")
  );
}

const MAX_PANEL_ROLES = 5;

/** R2.5 多角色面板投影：每角色立场一个子节点 + 一个收敛/分歧裁决节点（DERIVE only）。
 * V5.3 P3: support defaultExpanded for collaboration view; generate non-depends_on "challenges" edges from role_critique events or payload.
 */
function expandPanelRoleChildren(
  state: V5SessionState,
  parent: BrainstormReasoningNode,
  opts: { defaultExpanded?: boolean } = {}
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  const art = artifactForNode(state, parent as any);
  const raw = (art?.payload || {}) as any;

  // Support two shapes:
  // 1. Critique panel artifact: { panel: true, positions: [...], convergenceScore, ... }
  // 2. Synthesis artifact (after forwarding): { panel: { positions: [...], convergenceScore, consensusReached, dissent }, ... }
  let pl: any = raw;
  if (raw.panel && typeof raw.panel === "object" && !raw.positions) {
    pl = { panel: true, ...raw.panel };
  }

  const hasPanelFlag = !!pl?.panel;
  const positions = Array.isArray(pl?.positions) ? pl.positions : [];
  const hasConvergence = typeof pl?.convergenceScore === "number";

  // Allow rendering at least the verdict if we have convergence data (even without full positions on this artifact)
  if (!hasPanelFlag && !hasConvergence && positions.length === 0) {
    return { nodes: [], edges: [] };
  }

  // V5.3 P3.1: in overview mode (defaultExpanded false) we can skip children (caller decides);
  // for collaboration we expand by default.
  if (opts.defaultExpanded === false) {
    // still return empty to let caller control; in practice derive calls with flag=true for collab
  }

  const nodes: BrainstormReasoningNode[] = [];
  const edges: BrainstormReasoningEdge[] = [];

  for (const pos of positions.slice(0, MAX_PANEL_ROLES)) {
    const v5 = String(pos.v5Role || pos.roleId || "角色");
    const childId = `${parent.id}::role-${String(pos.roleId || v5)}`;
    nodes.push({
      id: childId,
      type: "decision",
      title: `${v5} · 立场`,
      body: String(pos.content || "").slice(0, 200),
      status: "resolved",
      roleId: v5,
      roleLabel: v5,
      conclusionBadge: "立场",
      derivedFrom: [parent.id],
    });
    edges.push({
      id: `${parent.id}-role-${childId}`,
      source: parent.id,
      target: childId,
      type: "refines",
      label: "立场",
    });
  }

  if (hasConvergence) {
    const consensus = Boolean(pl.consensusReached ?? pl.consensus);
    const dissentArr = Array.isArray(pl.dissent) ? pl.dissent : [];
    const dissentCount = dissentArr.length;
    const childId = `${parent.id}::role-_verdict`;
    nodes.push({
      id: childId,
      type: consensus ? "synthesis" : "risk",
      title: consensus ? "共识" : "分歧",
      body: `收敛分 ${Number(pl.convergenceScore).toFixed(2)}${dissentCount ? ` · ${dissentCount} 条保留异议` : ""}`,
      status: "resolved",
      roleId: "综合",
      roleLabel: "裁决",
      conclusionBadge: consensus ? "共识" : "分歧",
      derivedFrom: [parent.id],
    });
    edges.push({
      id: `${parent.id}-role-verdict`,
      source: parent.id,
      target: childId,
      type: "refines",
      label: consensus ? "共识" : "分歧",
    });
  }

  // V5.3 P3.2: generate "challenges" (non-depends_on) edges from role_critique events or payload.critiques
  // (avoids G-ROOT-2 single-parent check)
  const runId = (parent as any).capabilityRunId;
  let critiquesSrc: any[] = [];
  if (runId) {
    const evs = eventsByRun(state).get(runId) || [];
    critiquesSrc = evs.filter((e: any) => e.kind === "role_critique").map((e: any) => ({
      fromRole: e.roleId,
      targetRole: e.targetRoleId,
      content: e.text,
    }));
  }
  if (critiquesSrc.length === 0 && Array.isArray(pl?.critiques)) {
    critiquesSrc = pl.critiques;
  }
  for (const c of critiquesSrc) {
    const from = String(c.fromRole || c.challengerRoleId || c.roleId || "");
    const to = String(c.targetRole || c.targetRoleId || "");
    if (!from || !to) continue;
    const fromId = `${parent.id}::role-${from}`;
    const toId = `${parent.id}::role-${to}`;
    // only if role nodes exist
    if (nodes.some(n => n.id === fromId) && nodes.some(n => n.id === toId)) {
      edges.push({
        id: `${parent.id}-challenge-${from}-to-${to}`,
        source: fromId,
        target: toId,
        type: "challenges" as any,  // non-depends_on !
        label: "质疑",
      });
    }
  }

  return { nodes, edges };
}

/** V5.3 P4: turn a cap's think/observe/tool/subtask events into ordered sub-step nodes + "step" edges (non-depends_on). */
export function expandReasoningChain(
  parent: BrainstormReasoningNode,
  events: ReasoningEvent[]
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  const subEvents = (events || [])
    .filter((e: any) => ["think", "observe", "tool_call", "subtask"].includes(e.kind))
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

  const nodes: BrainstormReasoningNode[] = [];
  const edges: BrainstormReasoningEdge[] = [];

  subEvents.forEach((ev: any, i: number) => {
    const childId = `${parent.id}::step-${i}`;
    nodes.push({
      id: childId,
      type: "decision" as any,
      title: ev.kind,
      body: String(ev.text || "").slice(0, 200),
      // projection-only derived fields
      ...( { eventKind: ev.kind } as any ),
      derivedFrom: [parent.id],
    });
    edges.push({
      id: `${parent.id}-step-${i}`,
      source: parent.id,
      target: childId,
      type: "step" as any, // non-depends_on per red line
      label: ev.kind,
    });
  });

  return { nodes, edges };
}

function artifactForNode(
  state: V5SessionState,
  node: BrainstormReasoningNode & {
    producedArtifactId?: string;
    capabilityRunId?: string;
  }
) {
  const id = node.producedArtifactId;
  if (id) {
    return (state.artifacts || []).find((a) => a.id === id);
  }
  const runId = node.capabilityRunId;
  if (!runId) return undefined;
  return (state.artifacts || []).find((a) => a.producedBy?.capabilityRunId === runId);
}

function resolveCapabilityRunId(
  state: V5SessionState,
  parent: BrainstormReasoningNode & { capabilityRunId?: string; producedArtifactId?: string }
): string | undefined {
  if (parent.capabilityRunId) return parent.capabilityRunId;
  const art = artifactForNode(state, parent);
  return art?.producedBy?.capabilityRunId;
}

type PhaseKind = "thinking" | "acting" | "observing" | "completed" | "failed";

type PhaseFact = {
  kind: PhaseKind;
  label: string;
  body: string;
  sourceKey: string;
};

const PHASE_LABEL: Record<PhaseKind, string> = {
  thinking: "思考",
  acting: "执行",
  observing: "观察",
  completed: "完成",
  failed: "失败",
};

function progressTypeToPhaseKind(
  progressType?: "thinking" | "acting" | "observing" | "completed" | "failed"
): PhaseKind | null {
  if (!progressType) return null;
  if (progressType === "failed") return "failed";
  if (progressType === "acting") return "acting";
  if (progressType === "observing") return "observing";
  if (progressType === "completed") return "completed";
  return "thinking";
}

function ledgerMatchesRun(
  text: string,
  runId: string,
  capId?: string,
  turnId?: string
): boolean {
  if (text.includes(runId)) return true;
  if (turnId && text.includes(turnId)) return true;
  if (capId && text.includes(capId)) return true;
  return false;
}

/** Derive phase facts from uiTurn → capabilityRun + ledger (no decoration). */
function derivePhaseFacts(
  state: V5SessionState,
  parent: BrainstormReasoningNode,
  latestUiTurn?: UiTurn | null
): PhaseFact[] {
  const capId = parent.capabilityId;
  const runId = resolveCapabilityRunId(state, parent as any);
  // K6.3: when runId cannot be resolved, skip run-based ledger / phase兜底 (宁缺毋滥, no cross-run pollution)
  const facts: PhaseFact[] = [];
  const seen = new Set<string>();

  const push = (fact: PhaseFact) => {
    const key = `${fact.kind}:${fact.sourceKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push(fact);
  };

  if (latestUiTurn?.steps?.length && capId) {
    for (const step of latestUiTurn.steps) {
      if (step.kind !== "chip" || !step.progressType) continue;
      if (step.capabilityId !== capId) continue;
      if (
        runId &&
        "capabilityRunId" in step &&
        step.capabilityRunId &&
        step.capabilityRunId !== runId
      ) {
        continue;
      }
      const kind = progressTypeToPhaseKind(step.progressType);
      if (!kind) continue;
      push({
        kind,
        label: PHASE_LABEL[kind],
        body: step.label,
        sourceKey: `ui:${step.id}`,
      });
    }
  }

  // K6.4: support failed from traces (make failed steps visible for "可挑战" narrative)
  if (facts.length === 0 && latestUiTurn?.actions?.length && runId) {
    const turnId = latestUiTurn.id;
    for (const trace of latestUiTurn.actions as ActionTrace[]) {
      if (trace.turnId && trace.turnId !== turnId) continue;
      let kind: PhaseKind = trace.ok ? "completed" : "observing";
      if (!trace.ok && /fail|error|失败|reject|打回/i.test(String(trace.label || ""))) {
        kind = "failed";
      }
      push({
        kind,
        label: PHASE_LABEL[kind],
        body: trace.label,
        sourceKey: `trace:${trace.label}:${trace.turnId ?? turnId}`,
      });
    }
  }

  // Do not early-return here. Steps/traces give good live labels during a turn.
  // We *always* also process the run block below so that for resolved parents (new topic
  // after reset), the "完成" fact gets the rich artifact title/summary/risk list etc
  // instead of only the short chip label from latestUiTurn.steps.
  // K6.3: strict - only use exact runId, no capId fallback for phase/ledger (宁缺毋滥)
  const run = runId
    ? (state.capabilityRuns || []).find((r) => r.id === runId)
    : undefined;

  if (run) {
    const ground = run.gateResults?.find((g) => g.gateId === "ground" || g.gateId === "G-GROUND");
    if (ground) {
      const checked = ground.checkedArtifactIds?.length || run.inputs?.length || 0;
      const ev = ground.evidenceRefs?.length || 0;
      const detail = ground.detail || ground.reason || "";
      const obsBody = detail
        ? `观察 · 接地检查${ground.status === "passed" ? "通过" : "未过"}\n检查对象：${(ground.checkedArtifactIds || run.inputs || []).slice(0, 2).join(", ") || "上游产物"}${checked ? ` · ${checked} 引用` : ""}${ev ? ` · 证据 ${ev}` : ""}${detail ? `\n${detail.slice(0, 80)}` : ""}`
        : `观察 · 接地检查${ground.status === "passed" ? "通过" : "未过"}\n检查 ${checked || "上游"} 产物 · 证据完整性`;
      push({
        kind: "observing",
        label: "观察",
        body: obsBody,
        sourceKey: `run:${run.id}:ground`,
      });
    }
    const commitGate = run.gateResults?.find((g) => g.gateId === "commit" || g.gateId === "T_GATE");
    if (commitGate) {
      const detail = commitGate.detail || commitGate.reason || "";
      const thkBody = detail
        ? `思考 · 提交闸判断\n${detail.slice(0, 140)}`
        : `思考 · 提交闸判断\nartifact 非空 · 具 title/summary · passedGates 包含 ground`;
      push({
        kind: "thinking",
        label: "思考",
        body: thkBody,
        sourceKey: `run:${run.id}:commit`,
      });
    }

    // Rich completed: resolve real artifacts for summary instead of raw ids (core of content thickness fix)
    if (run.outputs?.length > 0) {
      const arts = run.outputs
        .map((oid) => (state.artifacts || []).find((a) => a.id === oid))
        .filter(Boolean) as any[];
      if (arts.length > 0) {
        const a0 = arts[0];
        const k = a0?.kind || "synthesis";
        const t = (a0?.title || "").trim();
        const s = (a0?.summary || "").trim();
        const c = (a0?.content || "").trim();
        let compBody = "";
        if (k === "risk") {
          // risk specific: list first risks
          const risks = (a0?.payload as any)?.risks || [];
          const riskLines = Array.isArray(risks)
            ? risks.slice(0, 3).map((r: any) => `• ${String(r.title || r.label || r).slice(0, 48)}`).join("\n")
            : "";
          compBody = `完成 · 风险分析\n${t || "识别风险"}\n${riskLines || (s ? s.slice(0, 120) : (c ? c.split("\n").slice(0, 3).join(" ") : ""))}`;
        } else if (k === "report" || k === "synthesis") {
          compBody = `完成 · ${k === "report" ? "报告" : "综合"}\n${t || "产出"}\n${(s || c.split("\n")[0] || "").slice(0, 140)}`;
        } else if (k === "evidence") {
          compBody = `完成 · 证据\n${t || "外部证据"}\n引用 ${a0?.evidenceRefs?.length || 0} 源 · ${(s || c).slice(0, 100)}`;
        } else {
          compBody = `完成 · ${k}\n${t || run.outputs[0]}\n${(s || c.slice(0, 120) || "可用产物").slice(0, 140)}`;
        }
        push({
          kind: "completed",
          label: "完成",
          body: compBody,
          sourceKey: `run:${run.id}:outputs`,
        });
      } else {
        // fallback thin only if no artifacts resolved
        push({
          kind: "completed",
          label: "完成",
          body: `产出 ${run.outputs.join(", ")}`,
          sourceKey: `run:${run.id}:outputs`,
        });
      }
    }
  }

  if (runId) {
    // decisionLedger rationale for "思考" depth (prefer over thin gate)
    const ledgers = (state.decisionLedger || []).filter((d: any) =>
      ledgerMatchesRun(String(d.rationale || d.id || ""), runId, capId, run?.turnId) ||
      (d.turnId && d.turnId === run?.turnId)
    );
    for (const ld of ledgers.slice(0, 1)) {
      const rat = String(ld.rationale || "").trim();
      if (rat) {
        push({
          kind: "thinking",
          label: "思考",
          body: `思考 · 调度判断\n${rat.slice(0, 160)}`,
          sourceKey: `dledger:${ld.id || runId}`,
        });
      }
    }

    for (const c of state.conversation || []) {
      const text = String(c.text || "");
      if (!/\[T_LEDGER\]|\[G-GROUND\]/i.test(text)) continue;
      if (!ledgerMatchesRun(text, runId, capId, run?.turnId)) continue;
      const kind: PhaseKind = /\[G-GROUND\]/i.test(text) ? "observing" : "thinking";
      push({
        kind,
        label: PHASE_LABEL[kind],
        body: text.slice(0, 160),
        sourceKey: `ledger:${c.id}`,
      });
    }
  }

  // Prefer rich run/artifact/ledger facts over short step chip labels for the same kind.
  // After reset + republish new topic, steps may give "LLM 推演完成", but we want the
  // artifact-enriched body ("完成 · 风险分析\n识别出 3 类 MVP 风险：...") for the phase cards.
  const bestByKind = new Map<PhaseKind, PhaseFact>();
  for (const f of facts) {
    const prev = bestByKind.get(f.kind);
    const isRich = /风险|报告|综合|证据|非空|title|引用|检查对象|调度判断/i.test(f.body) || f.body.length > 35;
    if (!prev || isRich || f.body.length > prev.body.length) {
      bestByKind.set(f.kind, f);
    }
  }
  const finalFacts = Array.from(bestByKind.values());

  return finalFacts.slice(0, MAX_PHASE_CHILDREN);
}

function expandEvidenceChildren(
  state: V5SessionState,
  parent: BrainstormReasoningNode
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  const art = artifactForNode(state, parent as any);
  const refs = (art?.evidenceRefs || []).slice(0, MAX_EVIDENCE_CHILDREN);
  const nodes: BrainstormReasoningNode[] = [];
  const edges: BrainstormReasoningEdge[] = [];

  for (const refId of refs) {
    const upstream = (state.artifacts || []).find((a) => a.id === refId);
    const childId = `${parent.id}::ev-${refId}`;
    nodes.push({
      id: childId,
      type: "evidence",
      title: upstream?.title || `来源 ${refId}`,
      body: (upstream?.summary || upstream?.content || "").slice(0, 160),
      status: "resolved",
      roleId: upstream?.producedBy?.roleId || "接地",
      roleLabel: "来源",
      conclusionBadge: "来源",
      producedArtifactId: refId,
      derivedFrom: [parent.id],
    });
    edges.push({
      id: `${parent.id}-ev-${refId}`,
      source: parent.id,
      target: childId,
      type: "cites",
      label: "来源",
    });
  }
  return { nodes, edges };
}

function isSpecTreeMetaLine(trimmed: string): boolean {
  if (!trimmed) return true;
  if (trimmed.startsWith("【SPEC Tree")) return true;
  if (/^(C_[A-Z]|G_[A-Z])/.test(trimmed)) return true;
  if (/G_SCHEMA:|G_INV:|C_REDACT:|C_SFALL:/.test(trimmed)) return true;
  return false;
}

/**
 * K6.1 修复：专为 formatTreeContent 真实产出格式增加可靠分支。
 * 跳过 gateNote + 头行； [root] 明确 depth=1；├─ =2；│  └─ =3。
 * 保留原 markdown - 兜底（其他来源的树序列化）。
 */
function parseSpecTreeLines(content: string): Array<{ id: string; title: string; depth: number }> {
  const rows: Array<{ id: string; title: string; depth: number }> = [];
  const typeCounts = new Map<string, number>();

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (isSpecTreeMetaLine(trimmed)) continue;

    // 优先：真实 formatTreeContent 产出格式（[type] title: summary）
    // 显式识别 root / ├─ / │  └─ 前缀来决定 depth
    const fmt = rawLine.match(/^(\s*(?:├─\s*|│\s*└─\s*)?)\[([^\]]+)\]\s*([^:]+):\s*(.+)$/);
    if (fmt) {
      const prefix = fmt[1] || "";
      let depth = 1;
      if (/│\s*└─/.test(prefix)) depth = 3;
      else if (/├─/.test(prefix)) depth = 2;
      // 根行无前缀 → 1（显式）
      if (fmt[2].trim() === "root") depth = 1;

      const nodeType = fmt[2].trim();
      const title = fmt[3].trim().slice(0, 80);
      const count = (typeCounts.get(nodeType) ?? 0) + 1;
      typeCounts.set(nodeType, count);
      const id = nodeType === "root" && count === 1 ? "root" : `${nodeType}-${count}`;

      rows.push({ id, title, depth: Math.min(MAX_TREE_DEPTH, depth) });
      if (rows.length >= 12) break;
      continue;
    }

    // 兜底：旧 markdown 列表风格（- [id] title ...）
    const md = rawLine.match(/^(\s*)-\s*(?:\[([^\]]+)\]\s*)?(.+)$/);
    if (md) {
      const depth = Math.min(MAX_TREE_DEPTH, Math.floor(md[1].length / 2) + 1);
      const id = (md[2] || `line-${rows.length}`).replace(/\s+/g, "-");
      rows.push({ id, title: md[3].trim().slice(0, 80), depth });
      if (rows.length >= 12) break;
      continue;
    }
  }
  return rows;
}

function expandSpecTreeChildren(
  state: V5SessionState,
  parent: BrainstormReasoningNode
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  const art = artifactForNode(state, parent as any);
  if (art?.kind !== "spec_tree") return { nodes: [], edges: [] };

  const rows = parseSpecTreeLines(String(art.content || ""));
  const nodes: BrainstormReasoningNode[] = [];
  const edges: BrainstormReasoningEdge[] = [];
  const parentStack: Array<{ nodeId: string; depth: number }> = [
    { nodeId: parent.id, depth: 0 },
  ];

  for (const row of rows) {
    while (parentStack.length > 1 && parentStack[parentStack.length - 1].depth >= row.depth) {
      parentStack.pop();
    }
    const parentEntry = parentStack[parentStack.length - 1];
    const childId = `${parent.id}::tree-${row.id}`;
    nodes.push({
      id: childId,
      type: row.depth <= 1 ? "clarification" : "hypothesis",
      title: row.title,
      body: `SPEC Tree · depth ${row.depth}`,
      status: "resolved",
      roleId: "架构",
      roleLabel: "结构",
      conclusionBadge: "结构",
      derivedFrom: [parentEntry.nodeId],
    });
    edges.push({
      id: `${parentEntry.nodeId}-tree-${row.id}`,
      source: parentEntry.nodeId,
      target: childId,
      type: "refines",
      label: parentEntry.nodeId === parent.id ? "拆解" : "子项",
    });
    parentStack.push({ nodeId: childId, depth: row.depth });
  }
  return { nodes, edges };
}

function buildPhaseChild(
  parent: BrainstormReasoningNode,
  fact: PhaseFact
): BrainstormReasoningNode {
  // Semantic type mapping so phase children are not all "clarification" (visual + meaning alignment)
  let nodeType: BrainstormReasoningNode["type"] = "clarification";
  if (fact.kind === "thinking") nodeType = "decision";
  else if (fact.kind === "observing") nodeType = "evidence";
  else if (fact.kind === "completed") nodeType = "synthesis";
  else if (fact.kind === "failed") nodeType = "risk";
  else if (fact.kind === "acting") nodeType = "hypothesis";

  return {
    id: `${parent.id}::phase-${fact.kind}-${fact.sourceKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    type: nodeType,
    title: fact.label,
    body: fact.body,
    status: fact.kind === "failed" ? "failed" : "resolved",
    roleId: parent.roleId,
    roleLabel: parent.roleLabel,
    conclusionBadge: fact.label,
    derivedFrom: [parent.id],
  };
}

/** Knife B: expand main projection nodes with evidence/tree/phase children (DERIVE only). */
export function expandProjectionNodes(
  state: V5SessionState,
  baseNodes: BrainstormReasoningNode[],
  baseEdges: BrainstormReasoningEdge[],
  density: ProjectionDensity,
  latestUiTurn?: UiTurn | null
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  if (density === "compact") {
    return { nodes: baseNodes, edges: baseEdges };
  }

  const extraNodes: BrainstormReasoningNode[] = [];
  const extraEdges: BrainstormReasoningEdge[] = [];

  const mains = baseNodes.filter((n) => !isProjectionChildId(n.id));

  for (const parent of mains) {
    if (parent.type === "question") continue;

    const { nodes: evNodes, edges: evEdges } = expandEvidenceChildren(state, parent);
    extraNodes.push(...evNodes);
    extraEdges.push(...evEdges);

    const { nodes: treeNodes, edges: treeEdges } = expandSpecTreeChildren(state, parent);
    extraNodes.push(...treeNodes);
    extraEdges.push(...treeEdges);

    // V5.3 P3.1: default expand for collaboration view (pass flag; derive/viewMode will drive in full)
    const { nodes: panelNodes, edges: panelEdges } = expandPanelRoleChildren(state, parent, { defaultExpanded: true });
    extraNodes.push(...panelNodes);
    extraEdges.push(...panelEdges);

    // Relaxed: phases for resolved or completed capability nodes (fresh new topics after reset
    // often have status "completed" from enrichNodeStatus once art is gated_pass, not "resolved").
    // This ensures after 重置 + new topic, the ::phase- children still get generated.
    const isFinished = (parent.status as any) === "resolved" || (parent.status as any) === "completed" || (parent.status as any) === "done";
    if (parent.capabilityId && isFinished) {
      const phaseFacts = derivePhaseFacts(state, parent, latestUiTurn);
      for (const fact of phaseFacts) {
        const child = buildPhaseChild(parent, fact);
        extraNodes.push(child);
        extraEdges.push({
          id: `${parent.id}-phase-${child.id}`,
          source: parent.id,
          target: child.id,
          type: "refines",
          label: fact.label,
        });
      }
    }
  }

  return {
    nodes: [...baseNodes, ...extraNodes],
    edges: [...baseEdges, ...extraEdges],
  };
}