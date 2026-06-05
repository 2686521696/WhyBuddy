/**
 * `blueprint-v4-full-alignment` Module A/B — companion_log 交付导出（A.12）。
 *
 * 把 job.companionFindings 导出为交付包结构。warn/error 级发现单独高亮区块
 * （R2.8/R3.8 露出）。
 */

import type { CompanionFinding } from "../../../../shared/blueprint/companion/types.js";

export interface CompanionLogExport {
  jobId: string;
  exportedAt: string;
  findings: CompanionFinding[];
  /** warn/error 级别的高亮子集，供评审优先查看 */
  highlighted: CompanionFinding[];
}

/**
 * 构造 companion_log.json 导出对象。
 */
export function buildCompanionLogExport(
  jobId: string,
  findings: CompanionFinding[],
  now: () => Date,
): CompanionLogExport {
  const highlighted = findings.filter(
    (f) => f.severity === "warn" || f.severity === "error",
  );
  return {
    jobId,
    exportedAt: now().toISOString(),
    findings,
    highlighted,
  };
}

/**
 * 渲染 companion 发现为 Markdown，warn/error 以醒目区块呈现。
 */
export function renderCompanionMarkdown(findings: CompanionFinding[]): string {
  if (findings.length === 0) {
    return "## 伴随审查 (Companion Review)\n\n暂无伴随发现。\n";
  }

  const lines: string[] = ["## 伴随审查 (Companion Review)", ""];

  const highlighted = findings.filter(
    (f) => f.severity === "warn" || f.severity === "error",
  );
  if (highlighted.length > 0) {
    lines.push("### ⚠️ 需要关注的发现（warn / error）", "");
    for (const f of highlighted) {
      const icon = f.severity === "error" ? "❌" : "⚠️";
      lines.push(`- ${icon} **[${f.role} @ ${f.stage}]** ${f.findings.join("; ")}`);
      if (f.suggestedActions.length > 0) {
        lines.push(`  - 建议：${f.suggestedActions.join("; ")}`);
      }
    }
    lines.push("");
  }

  lines.push("### 全部发现", "");
  lines.push("| 角色 | 阶段 | 严重度 | 发现 |");
  lines.push("|------|------|--------|------|");
  for (const f of findings) {
    lines.push(
      `| ${f.role} | ${f.stage} | ${f.severity} | ${f.findings.join("; ").slice(0, 120)} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
