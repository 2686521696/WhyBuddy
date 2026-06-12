import { extractArtifactFragments } from "@shared/blueprint/whybuddy-report-builder";
import type { Artifact } from "@shared/blueprint/v5-reasoning-state";

export type ReportSection = {
  id: string;
  label: string;
  body: string;
  evidenceRefs: string[];
};

const SECTION_LABEL_PATTERN =
  "结论(?:（待补证）)?|支撑证据|反证\\/挑战|反证|证据|风险|分歧|收敛决策|未解缺口|下一步工程化分支|下一步|provenance\\s*\\/\\s*upstream refs";

function normalizeReportContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/^【[^】]+】\s*/gm, "")
    .trim();
}

function labelFromMatch(raw: string): string {
  return raw.replace(/\s*\/\s*upstream refs/i, "溯源");
}

function splitByHeaders(content: string): ReportSection[] {
  const normalized = normalizeReportContent(content);
  if (!normalized) return [];

  const headerRe = new RegExp(`(${SECTION_LABEL_PATTERN})[：:]`, "gi");
  const markers: Array<{ label: string; headerStart: number; bodyStart: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headerRe.exec(normalized)) !== null) {
    markers.push({
      label: labelFromMatch(match[1]),
      headerStart: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  if (markers.length === 0) return [];

  const sections: ReportSection[] = [];
  for (let i = 0; i < markers.length; i++) {
    const bodyEnd = i + 1 < markers.length ? markers[i + 1].headerStart : normalized.length;
    const body = normalized.slice(markers[i].bodyStart, bodyEnd).trim();
    if (!body) continue;
    sections.push({
      id: `sec-${sections.length}`,
      label: markers[i].label,
      body,
      evidenceRefs: [],
    });
  }

  return sections;
}

/** Parse report.write artifact into named sections for WhyBuddyReportReader. */
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