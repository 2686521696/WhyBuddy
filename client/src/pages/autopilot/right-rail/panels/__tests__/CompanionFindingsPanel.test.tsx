/**
 * Component tests for `CompanionFindingsView` (task 51). SSR + 字符串断言。
 *
 * 覆盖：card 字段（role/severity/stage/findings/suggestedActions/citations）、
 * repoFilesRead 渲染、严重度排序（error/warn 优先）、按阶段分组、空态。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { CompanionFindingsView } from "../CompanionFindingsPanel";
import type { CompanionFinding } from "../../trust/types";

function finding(overrides?: Partial<CompanionFinding>): CompanionFinding {
  return {
    id: "f1",
    role: "critic",
    stage: "spec_tree",
    targetArtifactId: "artifact-1",
    findings: ["规格树缺少错误分支"],
    severity: "warn",
    suggestedActions: ["补充失败路径"],
    citations: ["R2.7"],
    timestamp: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

const render = (props: Parameters<typeof CompanionFindingsView>[0]) =>
  renderToStaticMarkup(createElement(CompanionFindingsView, props));

describe("CompanionFindingsView", () => {
  it("renders card fields: role/severity/stage/findings/actions/citations", () => {
    const html = render({ locale: "en-US", findings: [finding()] });
    expect(html).toContain('data-testid="companion-findings-panel"');
    expect(html).toContain('data-testid="companion-finding-card"');
    expect(html).toContain('data-role="critic"');
    expect(html).toContain('data-severity="warn"');
    expect(html).toContain('data-stage="spec_tree"');
    expect(html).toContain("规格树缺少错误分支");
    expect(html).toContain('data-testid="companion-finding-actions"');
    expect(html).toContain("补充失败路径");
    expect(html).toContain('data-testid="companion-finding-citations"');
    expect(html).toContain("R2.7");
  });

  it("renders repoFilesRead for grounding findings", () => {
    const html = render({
      locale: "en-US",
      findings: [
        finding({
          id: "g1",
          role: "grounding",
          repoFilesRead: ["server/core/foo.ts", "shared/bar.ts"],
        }),
      ],
    });
    expect(html).toContain('data-role="grounding"');
    expect(html).toContain('data-testid="companion-finding-repofiles"');
    expect(html).toContain("server/core/foo.ts");
    expect(html).toContain("shared/bar.ts");
  });

  it("orders error/warn before info within a stage", () => {
    const html = render({
      locale: "en-US",
      findings: [
        finding({ id: "info1", severity: "info", findings: ["INFO_NOTE"] }),
        finding({ id: "err1", severity: "error", findings: ["ERROR_NOTE"] }),
        finding({ id: "warn1", severity: "warn", findings: ["WARN_NOTE"] }),
      ],
    });
    const errIdx = html.indexOf("ERROR_NOTE");
    const warnIdx = html.indexOf("WARN_NOTE");
    const infoIdx = html.indexOf("INFO_NOTE");
    expect(errIdx).toBeGreaterThanOrEqual(0);
    expect(errIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(infoIdx);
  });

  it("groups findings by stage", () => {
    const html = render({
      locale: "en-US",
      findings: [
        finding({ id: "a", stage: "spec_tree" }),
        finding({ id: "b", stage: "clarification" }),
      ],
    });
    expect(html).toContain('data-testid="companion-stage-spec_tree"');
    expect(html).toContain('data-testid="companion-stage-clarification"');
  });

  it("renders empty state when there are no findings", () => {
    const html = render({ locale: "zh-CN", findings: [] });
    expect(html).toContain('data-testid="companion-empty"');
  });
});
