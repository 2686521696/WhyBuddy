import type { V5CapabilityId } from "@shared/blueprint/contracts";
import { CAPABILITY_PROCESS_LABELS } from "@shared/blueprint/capability-process-labels";

function resolveLiveLabel(capabilityId: V5CapabilityId): string {
  const entry = CAPABILITY_PROCESS_LABELS[capabilityId];
  const raw = entry?.liveLabel;
  if (typeof raw === "string") return raw;
  return "分析";
}

function completionLabel(capabilityId: V5CapabilityId): string {
  const live = resolveLiveLabel(capabilityId);
  if (live.startsWith("正在")) return live.replace(/^正在/, "");
  if (live.startsWith("⚡ 正在")) return live.replace(/^⚡ 正在/, "");
  return live;
}

function firstSummarySentence(summary?: string): string | null {
  if (!summary?.trim()) return null;
  const sentence = summary
    .split(/[。.!?\n]/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!sentence) return null;
  if (sentence.length > 120) return `${sentence.slice(0, 117)}…`;
  return sentence.endsWith("。") ? sentence : `${sentence}。`;
}

/** S8: step-level narration — LLM artifacts may cite summary; rule artifacts must not. */
export function buildStepNarration(args: {
  capabilityId: V5CapabilityId;
  realLlm: boolean;
  summary?: string;
}): string {
  if (args.realLlm) {
    const sentence = firstSummarySentence(args.summary);
    if (sentence) return sentence;
  }
  return `已完成${completionLabel(args.capabilityId)}。`;
}

export function buildOpeningPlanNarration(rationale?: string, source?: string): string | null {
  const text = String(rationale || "").trim();
  if (!text || source === "heuristic_fallback") return null;
  if (text.length > 180) return `${text.slice(0, 177)}…`;
  return text.endsWith("。") ? text : `${text}。`;
}