/**
 * parse-report-sections:报告分段识别。
 * 修复前 bug:只认 `标签：` 冒号式段标,LLM「扩写」报告输出 markdown 段标(## 支撑证据 / **风险**)
 * 时匹配不到 → 整篇塞进一段 → 交付物报告排版乱。本测试覆盖三种段标形式都能分段。
 */
import { describe, it, expect } from "vitest";
import type { Artifact } from "@shared/blueprint/v5-reasoning-state";
import { parseReportSections } from "../parse-report-sections";

function reportOf(content: string): Artifact {
  return {
    id: "r1",
    kind: "report",
    title: "可行性报告",
    content,
    trustLevel: "gated_pass",
    producedBy: { capabilityRunId: "run", capabilityId: "report.write", roleId: "综合" },
  } as Artifact;
}

describe("parseReportSections 段标识别", () => {
  it("识别 markdown ## 段标(LLM 扩写输出)", () => {
    const md = [
      "# 可行性报告",
      "## 支撑证据",
      "- 来自风险分析:越权风险已识别",
      "## 风险",
      "权限扩散在多团队下易失控。",
      "## 收敛决策",
      "MVP 优先 RBAC。",
    ].join("\n");
    const secs = parseReportSections(reportOf(md));
    const labels = secs.map((s) => s.label);
    expect(labels).toContain("支撑证据");
    expect(labels).toContain("风险");
    expect(labels).toContain("收敛决策");
    expect(secs.length).toBeGreaterThanOrEqual(3);
  });

  it("识别 **粗体** 段标", () => {
    const md = ["**支撑证据**", "证据正文", "**风险：**", "风险正文", "**收敛决策**", "决策正文"].join("\n");
    const labels = parseReportSections(reportOf(md)).map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(["支撑证据", "风险", "收敛决策"]));
  });

  it("仍兼容冒号式段标(模板/BASE 报告)", () => {
    const txt = ["支撑证据：证据", "风险：风险正文", "收敛决策：决策"].join("\n");
    const labels = parseReportSections(reportOf(txt)).map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(["支撑证据", "风险", "收敛决策"]));
  });
});
