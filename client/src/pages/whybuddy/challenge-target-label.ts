import type { Artifact } from "@shared/blueprint/v5-reasoning-state";

const KIND_LABELS: Record<string, string> = {
  report: "可行性报告",
  synthesis: "综合判断",
  risk: "风险分析",
  decision: "决策结论",
  spec_tree: "SPEC Tree",
  preview: "效果预览",
};

/** User-facing challenge target — no capability ids. */
export function challengeTargetLabel(artifact: Artifact | undefined): string | null {
  if (!artifact) return null;
  const title = String(artifact.title || "").trim();
  if (title && !title.includes(".")) return title;
  const kindLabel = KIND_LABELS[artifact.kind] || "结论";
  const version = (artifact as { version?: number }).version;
  if (typeof version === "number" && version > 0) {
    return `${kindLabel} · 第 ${version} 版`;
  }
  return kindLabel;
}