/**
 * K1 · 分级上下文供给（截断阀门解除）。
 *
 * 原则：
 * - 收敛类（report.write / synthesis.merge / document.draft / requirement.write）：给**完整 content**。
 *   单产物上限 6000 字符，总预算 ~24000 字符，超限按「最新优先 + risk/counter 优先」裁剪并**显式标注** `…[truncated N chars]`。
 * - 分析类（risk.analyze / counter.argue / critique.generate）：每产物 800 字符。
 * - 其余轻能力：维持 220 字符（不加料，省成本）。
 *
 * 截断必须显式可见（provenance 诚实性）。
 * 此模块纯函数，不写 STATE；供 server/routes/whybuddy.ts 与 pilot 复用。
 */

import type { V5SessionState } from "./v5-reasoning-state.js";

export type CapabilityContextTier = "convergence" | "analysis" | "light";

export interface CapabilityContextEntry {
  id: string;
  kind?: string;
  title?: string;
  content: string;
  truncated?: boolean;
  originalLength?: number;
}

const CONVERGENCE_CAPS: string[] = [
  "report.write",
  "synthesis.merge",
  "document.draft",
  "requirement.write",
];

const ANALYSIS_CAPS: string[] = [
  "risk.analyze",
  "counter.argue",
  "critique.generate",
];

export function classifyCapabilityTier(capabilityId: string): CapabilityContextTier {
  if (CONVERGENCE_CAPS.includes(capabilityId)) return "convergence";
  if (ANALYSIS_CAPS.some((c) => capabilityId === c || capabilityId.includes(c.split(".")[0]))) {
    return "analysis";
  }
  return "light";
}

function getPrioritizedPool(
  artifacts: any[],
  inputArtifactIds: string[]
): any[] {
  let pool = inputArtifactIds.length > 0
    ? artifacts.filter((a: any) => inputArtifactIds.includes(a.id))
    : [...artifacts].slice(-6);

  // For convergence, prioritize risk/counter + most recent (stable order: risk first then original recency)
  const isRiskOrCounter = (a: any) =>
    a.kind === "risk" ||
    String(a.producedBy?.capabilityId || (a as any).capability || "").includes("risk") ||
    String(a.producedBy?.capabilityId || (a as any).capability || "").includes("counter") ||
    String(a.producedBy?.capabilityId || (a as any).capability || "").includes("argue");

  pool = [...pool].sort((a, b) => {
    const ap = isRiskOrCounter(a) ? 10 : 0;
    const bp = isRiskOrCounter(b) ? 10 : 0;
    if (ap !== bp) return bp - ap; // risk higher first
    // secondary: keep later in original array as "newer"
    return 0;
  });

  // Hard cap count for prompt sanity
  return pool.slice(0, 8);
}

function truncateWithMark(raw: string, max: number): { content: string; truncated: boolean; originalLength: number } {
  const originalLength = raw.length;
  if (originalLength <= max) {
    return { content: raw, truncated: false, originalLength };
  }
  const head = raw.slice(0, max);
  return {
    content: `${head}…[truncated ${originalLength - max} chars]`,
    truncated: true,
    originalLength,
  };
}

/**
 * 核心：按能力分级返回上游产物上下文。
 * 返回的 content 已做可见截断处理。
 */
export function buildCapabilityContext(
  state: V5SessionState,
  capabilityId: string,
  inputArtifactIds: string[] = []
): CapabilityContextEntry[] {
  const artifacts: any[] = (state as any)?.artifacts || [];
  const tier = classifyCapabilityTier(capabilityId);
  const pool = getPrioritizedPool(artifacts, inputArtifactIds);

  let perArtifactMax = 220;
  if (tier === "convergence") perArtifactMax = 6000;
  else if (tier === "analysis") perArtifactMax = 800;

  const totalBudget = tier === "convergence" ? 24000 : 999999;
  let used = 0;

  const result: CapabilityContextEntry[] = [];
  for (const a of pool) {
    const raw = String(a?.content || a?.summary || a?.title || "").trim();
    if (!raw) continue;

    const t = truncateWithMark(raw, perArtifactMax);
    if (used + t.content.length > totalBudget && tier === "convergence") {
      // budget exhausted — stop adding more (explicit)
      break;
    }
    used += t.content.length;

    result.push({
      id: a.id,
      kind: a.kind,
      title: a.title,
      content: t.content,
      truncated: t.truncated,
      originalLength: t.originalLength,
    });
  }

  return result;
}

/**
 * 便捷：把上下文数组序列化为适合 prompt 注入的紧凑字符串（带标注）。
 * 供 server 侧 userPrompt 直接使用。
 */
export function formatContextForPrompt(entries: CapabilityContextEntry[]): string {
  if (!entries.length) return "(no upstream artifacts)";
  return entries
    .map((e) => {
      const head = `[${e.kind || "artifact"}] ${e.title || e.id}`;
      const truncNote = e.truncated ? ` (orig ${e.originalLength} chars)` : "";
      return `${head}${truncNote}:\n${e.content}`;
    })
    .join("\n\n---\n\n");
}
