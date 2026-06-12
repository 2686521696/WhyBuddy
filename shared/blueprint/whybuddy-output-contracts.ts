/**
 * K2 · 输出契约（单一真相源）。
 *
 * 目标：让 report.write / structure.decompose / document.draft / requirement.write
 * 在 server-llm 路径下有**机械可验证**的结构与厚度要求。
 *
 * 契约取值翻译自：
 * - V5 既有 buildStructuredReport 9 段 + 每段 ≥120 字 + 支撑证据 ≥2 evidenceRef
 * - server/routes/blueprint/llm-spec-prompts.ts 的 outputSchema + exampleOutline（design 含 mermaid/interface/Validates）
 * - V4 Skill 包 check_content_quality.py 的结构要求（EARS、用户故事、≥200 字等）
 * - structure 链的 validateSpecTreeInvariants（节点数/深度/evidenceRef）
 *
 * 契约对象可被 K3 quality gate 直接消费（单一真相）。
 * prompt 端只负责“把要求说清楚”；是否达标由机械门裁决（不在这里失败执行）。
 */

import type { V5CapabilityId } from "./contracts.js";
import { REPORT_CANONICAL_SECTIONS } from "./whybuddy-report-builder.js";

export type EmbeddedKind = "mermaid" | "ts_interface";

export interface OutputContract {
  capabilityId: V5CapabilityId | string;
  requiredHeadings: string[]; // 必备 ## / # 段标（大小写宽松匹配）
  minChildBlocks?: { heading: string; pattern: RegExp; min: number };
  requiredEmbedded?: EmbeddedKind[];
  earsSections?: string[]; // 这些段下的条目必须出现 EARS 句式
  minContentChars: number; // 正文下限（不含标题/元数据）
  minSectionChars?: Record<string, number>; // 特定段的最小正文长度
  notes?: string;
}

// Single source of truth for the 9段 report skeleton (imported from the builder that actually emits them).
export const REPORT_WRITE_CONTRACT: OutputContract = {
  capabilityId: "report.write",
  requiredHeadings: [...REPORT_CANONICAL_SECTIONS],
  minChildBlocks: {
    heading: "支撑证据",
    pattern: /evidenceRef|证据|来自 .*risk|来自 .*counter|来自 .*synthesis/i,
    min: 2,
  },
  earsSections: [],
  minContentChars: 2400,
  minSectionChars: {
    支撑证据: 300,
    风险: 200,
    收敛决策: 150,
  },
  notes: "9 段结构必须保留；BASE 骨架事实 + evidenceRefs 不可改写语义；Expand 增加深度与洞见。",
};

export const STRUCTURE_DECOMPOSE_CONTRACT: OutputContract = {
  capabilityId: "structure.decompose",
  requiredHeadings: [], // 树形而非 markdown heading 为主
  minChildBlocks: undefined,
  earsSections: ["requirement"], // requirement 节点必须带 EARS acceptance
  minContentChars: 800,
  notes: "节点数 ≥ max(8, 成功标准数×2)；深度 ≥3；每个 requirement 节点必须有 EARS 风格验收 + evidenceRef；design 节点建议带 mermaid 或关键接口。",
};

export const DOCUMENT_DRAFT_CONTRACT: OutputContract = {
  capabilityId: "document.draft",
  requiredHeadings: ["## 简介", "## 术语表", "## 需求", "## 设计", "## 任务"],
  minChildBlocks: {
    heading: "## 需求",
    pattern: /### 需求\s*\d|用户故事|验收标准|EARS/i,
    min: 3,
  },
  requiredEmbedded: ["mermaid", "ts_interface"],
  earsSections: ["## 需求"],
  minContentChars: 1600,
  notes: "对齐旧管线 llm-spec-prompts outputSchema：需求 ≥3 个 ### 需求 N + 用户故事 + EARS 编号验收；design 七 heading + mermaid + interface + ≥3 Validates 属性。",
};

export const REQUIREMENT_WRITE_CONTRACT: OutputContract = {
  capabilityId: "requirement.write",
  requiredHeadings: ["## 简介", "## 术语表", "## 需求"],
  minChildBlocks: {
    heading: "## 需求",
    pattern: /### 需求\s*\d|用户故事|#### 验收标准|\d+\.\d+\s+(THE|WHEN|IF|AS)/i,
    min: 3,
  },
  earsSections: ["## 需求"],
  minContentChars: 1400,
  notes: "需求部分必须包含用户故事 + EARS 格式验收标准（WHEN/IF/AS ... SHALL/SHOULD）。",
};

const ALL_CONTRACTS: OutputContract[] = [
  REPORT_WRITE_CONTRACT,
  STRUCTURE_DECOMPOSE_CONTRACT,
  DOCUMENT_DRAFT_CONTRACT,
  REQUIREMENT_WRITE_CONTRACT,
];

export function getOutputContract(capabilityId: string): OutputContract | undefined {
  return ALL_CONTRACTS.find((c) => c.capabilityId === capabilityId);
}

export function getAllOutputContracts(): OutputContract[] {
  return [...ALL_CONTRACTS];
}

/**
 * 把契约渲染为适合注入 LLM prompt 的自然语言描述（+ 简要 schema）。
 * 沿用旧管线 "schema 进 userPayload" 精神。
 */
export function renderContractForPrompt(contract: OutputContract): string {
  const lines: string[] = [];
  lines.push(`【OUTPUT CONTRACT for ${contract.capabilityId}】`);
  if (contract.requiredHeadings.length > 0) {
    lines.push(`Required headings (must appear): ${contract.requiredHeadings.join(" | ")}`);
  }
  if (contract.minChildBlocks) {
    lines.push(
      `Under "${contract.minChildBlocks.heading}" require at least ${contract.minChildBlocks.min} blocks matching: ${contract.minChildBlocks.pattern}`
    );
  }
  if (contract.requiredEmbedded && contract.requiredEmbedded.length > 0) {
    lines.push(`Must embed: ${contract.requiredEmbedded.map((e) => (e === "mermaid" ? "```mermaid" : "```ts interface")).join(" + ")}`);
  }
  if (contract.earsSections && contract.earsSections.length > 0) {
    lines.push(`EARS format required in sections: ${contract.earsSections.join(", ")} (use WHEN/IF/AS + SHALL/SHOULD)`);
  }
  lines.push(`Minimum content length: ${contract.minContentChars} chars (core body).`);
  if (contract.minSectionChars) {
    Object.entries(contract.minSectionChars).forEach(([h, n]) => lines.push(`  - ${h} ≥ ${n} chars`));
  }
  if (contract.notes) lines.push(`Notes: ${contract.notes}`);
  lines.push(`Return strictly {title, summary, content} JSON. Expand depth; preserve facts/refs from base.`);
  return lines.join("\n");
}

export function renderContractSchema(contract: OutputContract): Record<string, unknown> {
  // 轻量 schema 片段，供 prompt 携带（可扩展为 zod 稍后）
  return {
    requiredHeadings: contract.requiredHeadings,
    minContentChars: contract.minContentChars,
    minChildBlocks: contract.minChildBlocks ? { heading: contract.minChildBlocks.heading, min: contract.minChildBlocks.min } : undefined,
    requiredEmbedded: contract.requiredEmbedded,
    earsSections: contract.earsSections,
  };
}
