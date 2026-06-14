import { extractArtifactFragments } from "@shared/blueprint/sliderule-report-builder";
import type { Artifact } from "@shared/blueprint/v5-reasoning-state";

export type ReportSection = {
  id: string;
  label: string;
  body: string;
  evidenceRefs: string[];
};

const SECTION_LABEL_PATTERN =
  "结论(?:（待补证）)?|支撑证据|反证\\/挑战|反证|证据|风险|分歧|多角色立场（面板贡献）|多角色立场|收敛决策|未解缺口|下一步工程化分支|下一步|provenance\\s*\\/\\s*upstream refs";

function normalizeReportContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/^【[^】]+】\s*/gm, "")
    .trim();
}

function labelFromMatch(raw: string): string {
  return raw.replace(/\s*\/\s*upstream refs/i, "溯源");
}

// LLM「扩写」报告常用 Markdown 段标(## 支撑证据 / **支撑证据** / **支撑证据：**),
// 也有模板的冒号式(支撑证据：…)。三种形式都要识别成段标,否则整篇塞进一段→排版乱。
const MD_HEADING_HEADER = new RegExp(`^\\s*#{1,4}\\s*(${SECTION_LABEL_PATTERN})\\s*[：:]?\\s*(.*)$`, "i");
const BOLD_HEADER = new RegExp(`^\\s*\\*\\*\\s*(${SECTION_LABEL_PATTERN})\\s*[：:]?\\s*\\*\\*\\s*[：:]?\\s*(.*)$`, "i");
const COLON_HEADER = new RegExp(`^\\s*(${SECTION_LABEL_PATTERN})\\s*[：:]\\s*(.*)$`, "i");

function matchSectionHeader(line: string): { label: string; rest: string } | null {
  for (const re of [MD_HEADING_HEADER, BOLD_HEADER, COLON_HEADER]) {
    const m = line.match(re);
    if (m) return { label: m[1], rest: (m[2] || "").trim() };
  }
  return null;
}

function splitByHeaders(content: string): ReportSection[] {
  const normalized = normalizeReportContent(content);
  if (!normalized) return [];

  const sections: ReportSection[] = [];
  let current: ReportSection | null = null;

  for (const line of normalized.split("\n")) {
    const match = matchSectionHeader(line);
    if (match) {
      if (current?.body.trim()) sections.push(current);
      current = {
        id: `sec-${sections.length}`,
        label: labelFromMatch(match.label),
        body: match.rest,
        evidenceRefs: [],
      };
      continue;
    }
    if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }

  if (current?.body.trim()) sections.push(current);
  return sections;
}

/** Parse report.write artifact into named sections for DeliverablesPanel (and md export). */
export function parseReportSections(report: Artifact): ReportSection[] {
  const content = String(report.content || report.summary || "");
  const fromHeaders = splitByHeaders(content);
  if (fromHeaders.length >= 3) {
    return fromHeaders.map((s) => ({
      ...s,
      evidenceRefs: [...(report.evidenceRefs || [])],
    }));
  }

  const fragments = extractArtifactFragments(report, 800);
  if (fragments.length > 0) {
    return fragments.map((f, i) => ({
      id: `frag-${i}`,
      label: f.label,
      body: f.text,
      evidenceRefs: i === 0 ? [...(report.evidenceRefs || [])] : [],
    }));
  }

  return [
    {
      id: "full",
      label: "报告全文",
      body: content.trim() || report.title || "",
      evidenceRefs: [...(report.evidenceRefs || [])],
    },
  ];
}