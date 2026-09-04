/**
 * 工厂选材决策投影（2026-09-04 阶段 2）。
 *
 * 数据早就写在 decisionLedger 里，产品面没人看——选材器通电之前
 * 全绿是靠 grep 日志才发现的。这里只投影，不发明：没有账本条目就
 * 返回 null，不许端出「按默认编排」这种假理由。
 */
import type {
  SchedulingDecision,
  V5SessionState,
} from "@shared/blueprint/v5-reasoning-state";
import { FACTORY_HOPS, hopFromFactoryCapability, type FactoryHop } from "@/lib/factory-hops";

/** 短标签。跟 Python `capability_plan.TOOL_LABELS` 同一套。 */
export const FACTORY_TOOL_SHORT_LABELS: Record<FactoryHop, string> = {
  spec: "起草 SPEC",
  pages: "页面生成",
  structure: "数据结构",
  bind: "权限工作流",
  closure: "完整性检查",
};

export type FactoryDecisionSource =
  | "llm"
  | "heuristic_fallback"
  | "local_heuristic";

export type FactoryDecisionView = {
  saw: string[];
  chose: string[];
  rationale: string;
  source: FactoryDecisionSource;
  /** 回落规则版。不许装成模型挑的。 */
  degraded: boolean;
  /** 1-based。账本 turnId=loop-0 → 1。解析不出就是 null。 */
  loopIndex: number | null;
  maxLoops: number | null;
};

export function publicFactoryName(raw: string): FactoryHop | null {
  const cap = String(raw || "").trim();
  const hop = hopFromFactoryCapability(cap);
  if (hop) return hop;
  return (FACTORY_HOPS as readonly string[]).includes(cap)
    ? (cap as FactoryHop)
    : null;
}

export function labelFactoryTools(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const hop = publicFactoryName(raw);
    if (!hop) continue;
    const label = FACTORY_TOOL_SHORT_LABELS[hop];
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

function loopIndexFromTurnId(turnId: string | undefined): number | null {
  const m = /^loop-(\d+)$/.exec(String(turnId || "").trim());
  if (!m) return null;
  return Number(m[1]) + 1;
}

function isFactoryPickEntry(d: SchedulingDecision): boolean {
  const id = String(d.id || "");
  if (id.includes("agentic-pick")) return true;
  if (d.source === "llm" || d.source === "heuristic_fallback") {
    return Boolean(d.rationale || (d.chose && d.chose.length));
  }
  return false;
}

/**
 * 最近一条工厂选材。没有就 null——名单里有 decisionLedger 不等于埋点在。
 */
export function deriveFactoryDecisionView(
  state: Pick<V5SessionState, "decisionLedger" | "runConditions"> | null | undefined,
  opts?: { maxLoops?: number | null }
): FactoryDecisionView | null {
  const ledger = state?.decisionLedger || [];
  let entry: SchedulingDecision | undefined;
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (isFactoryPickEntry(ledger[i])) {
      entry = ledger[i];
      break;
    }
  }
  if (!entry) return null;
  const rationale = String(entry.rationale || "").trim();
  const chose = labelFactoryTools(entry.chose || []);
  if (!rationale && chose.length === 0) return null;
  const source: FactoryDecisionSource =
    entry.source === "heuristic_fallback" || entry.source === "local_heuristic"
      ? entry.source
      : "llm";
  const fallbackCondition = (state?.runConditions || []).some(
    (c: { reason?: string }) => c.reason === "AgenticPickFallback"
  );
  const degraded = source !== "llm" || fallbackCondition;
  return {
    saw: labelFactoryTools(entry.saw || []),
    chose,
    rationale,
    source: degraded && source === "llm" ? "heuristic_fallback" : source,
    degraded,
    loopIndex: loopIndexFromTurnId(entry.turnId),
    maxLoops:
      typeof opts?.maxLoops === "number" && opts.maxLoops > 0
        ? opts.maxLoops
        : null,
  };
}
