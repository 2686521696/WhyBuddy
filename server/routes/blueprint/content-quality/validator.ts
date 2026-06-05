/**
 * `blueprint-content-quality-check` spec Task 3.1–3.3：核心校验逻辑（纯函数）。
 */

import type { BlueprintCheckStatus } from "../../../../shared/blueprint/checks-ledger/types.js";
import { containsEarsKeyword, extractAcceptanceCriteria } from "./ears-patterns.js";

export interface SubstanceCheckResult {
  status: BlueprintCheckStatus;
  output: string;
}

export interface EarsCheckResult {
  status: BlueprintCheckStatus;
  output: string;
}

/**
 * 文档实质性校验。
 */
export function checkDocumentSubstance(
  content: string,
  documentType: string,
): SubstanceCheckResult {
  const lines = content.split("\n");
  const issues: string[] = [];
  let worstStatus: BlueprintCheckStatus = "pass";

  // 去除标题行，计算正文字符数
  const bodyLines = lines.filter((l) => !/^#+\s/.test(l.trim()));
  const bodyText = bodyLines.join("\n").trim();

  if (bodyText.length < 100) {
    return { status: "fail", output: "document body too short" };
  }

  // 检查是否有二级/三级标题
  const hasSubHeadings = lines.some((l) => /^#{2,3}\s/.test(l.trim()));
  if (!hasSubHeadings) {
    issues.push("missing section headings");
    worstStatus = "warn";
  }

  // 检查是否有散文段落（≥50 字符的非标题/非列表/非代码/非空行）
  const proseLines = bodyLines.filter((l) => {
    const t = l.trim();
    return (
      t.length >= 50 &&
      !t.startsWith("-") &&
      !t.startsWith("*") &&
      !t.startsWith("|") &&
      !t.startsWith("```") &&
      !/^\d+\./.test(t)
    );
  });
  if (proseLines.length === 0) {
    issues.push("no prose paragraphs found");
    if (worstStatus !== "fail") worstStatus = "warn";
  }

  // tasks.md: 需要有 checkbox
  if (documentType === "tasks") {
    const hasCheckbox = lines.some((l) => /- \[[ x]\]/.test(l));
    if (!hasCheckbox) {
      return { status: "fail", output: "no task checkboxes found" };
    }
  }

  // design.md: 需要有代码块或图
  if (documentType === "design") {
    const hasCodeBlock = lines.some((l) => l.trim().startsWith("```"));
    const hasMermaid = content.includes("mermaid");
    if (!hasCodeBlock && !hasMermaid) {
      issues.push("no code blocks or diagrams");
      if (worstStatus !== "fail") worstStatus = "warn";
    }
  }

  if (issues.length === 0) {
    return { status: "pass", output: "all substance checks passed" };
  }

  return { status: worstStatus, output: issues.join("; ") };
}

/**
 * EARS 句式合规校验（仅用于 requirements 类型文档）。
 */
export function checkEarsCompliance(content: string): EarsCheckResult {
  const criteria = extractAcceptanceCriteria(content);

  if (criteria.length === 0) {
    return { status: "skip", output: "no acceptance criteria section found" };
  }

  const nonCompliant: Array<{ index: number; text: string }> = [];

  for (let i = 0; i < criteria.length; i++) {
    if (!containsEarsKeyword(criteria[i])) {
      nonCompliant.push({ index: i + 1, text: criteria[i].slice(0, 80) });
    }
  }

  if (nonCompliant.length === 0) {
    return { status: "pass", output: `all ${criteria.length} criteria contain EARS keywords` };
  }

  const ratio = nonCompliant.length / criteria.length;
  const details = nonCompliant
    .slice(0, 5)
    .map((nc) => `#${nc.index}: "${nc.text}"`)
    .join("; ");

  if (ratio > 0.5) {
    return {
      status: "fail",
      output: `${nonCompliant.length}/${criteria.length} criteria lack EARS keywords: ${details}`,
    };
  }

  return {
    status: "warn",
    output: `${nonCompliant.length}/${criteria.length} criteria lack EARS keywords: ${details}`,
  };
}
