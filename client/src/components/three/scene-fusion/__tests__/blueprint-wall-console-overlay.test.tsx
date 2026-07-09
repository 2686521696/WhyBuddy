/**
 * blueprint-wall-process-graph-hud-2026-05-31 Task 5.2 —
 * `BlueprintWallConsoleOverlay` 的 SSR / source 输出测试。
 *
 * 测试技术沿用同目录 `blueprint-wall-metrics-rail.test.tsx` 的约定：用
 * `react-dom/server` 的 `renderToStaticMarkup` 渲染纯组件，对静态 HTML 字符串断言，
 * 不引入 jsdom / @testing-library。
 *
 * 覆盖（对应 Req 7.4 / 7.5 / 7.6 / 7.7）：
 *  1. 空 console 状态：consoleLines 为空时渲染空 console 壳、不臆造行（7.5）。
 *  2. 非空 console：渲染传入的每一行文本、行 id 与 tone（7.4 / 7.5）。
 *  3. tone → 状态着色：每行带 `data-console-tone`，覆盖全部 tone 取值。
 *  4. en-US / zh-CN 双语标题 / 空态文案都能渲染。
 *  5. 行数受控：组件按传入行数原样渲染（截断由 deriver 负责，Req 7.7）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BlueprintWallConsoleOverlay } from "../BlueprintWallConsoleOverlay";
import type { BlueprintWallConsoleLine } from "../blueprint-wall-process-data";

// ─── Fixture helper ──────────────────────────────────────────────────────────

/** 构造一条合法的 `BlueprintWallConsoleLine`（默认 info tone）。 */
function makeLine(
  overrides: Partial<BlueprintWallConsoleLine> = {}
): BlueprintWallConsoleLine {
  return {
    id: "console:reasoning:r1",
    text: "analyzing user goal",
    tone: "info",
    ...overrides,
  };
}

describe("BlueprintWallConsoleOverlay / SSR output", () => {
  it("renders an empty console shell when there are no console lines (Req 7.5)", () => {
    const markup = renderToStaticMarkup(
      <BlueprintWallConsoleOverlay consoleLines={[]} locale="en-US" />
    );

    expect(markup).toContain("data-wall-console");
    expect(markup).toContain('data-console-state="empty"');
    expect(markup).toContain("data-console-empty");
    // English empty-state copy renders.
    expect(markup).toContain("No console output");
    // No fabricated line content leaks in.
    expect(markup).not.toContain("data-console-line-id");
    expect(markup).not.toContain("undefined");
  });

  it("renders the supplied console lines with their text, id and tone (Req 7.4/7.5)", () => {
    const lines: BlueprintWallConsoleLine[] = [
      makeLine({ id: "console:reasoning:r1", text: "thinking about routes" }),
      makeLine({
        id: "console:preview-log:p1",
        text: "browser preview ready",
        tone: "success",
      }),
    ];

    const markup = renderToStaticMarkup(
      <BlueprintWallConsoleOverlay consoleLines={lines} locale="en-US" />
    );

    expect(markup).toContain('data-console-state="lines"');
    expect(markup).toContain('data-console-line-id="console:reasoning:r1"');
    expect(markup).toContain('data-console-line-id="console:preview-log:p1"');
    expect(markup).toContain("thinking about routes");
    expect(markup).toContain("browser preview ready");
    // Empty marker must not render when lines exist.
    expect(markup).not.toContain("data-console-empty");
  });

  it("renders a data-console-tone attribute for every supported tone", () => {
    const tones: BlueprintWallConsoleLine["tone"][] = [
      "muted",
      "info",
      "success",
      "warning",
      "error",
    ];
    const lines = tones.map((tone, index) =>
      makeLine({
        id: `console:reasoning:r${index}`,
        tone,
        text: `line-${tone}`,
      })
    );

    const markup = renderToStaticMarkup(
      <BlueprintWallConsoleOverlay consoleLines={lines} locale="en-US" />
    );

    for (const tone of tones) {
      expect(markup).toContain(`data-console-tone="${tone}"`);
    }
  });

  it("renders zh-CN title and empty-state copy by default", () => {
    const emptyMarkup = renderToStaticMarkup(
      <BlueprintWallConsoleOverlay consoleLines={[]} />
    );
    expect(emptyMarkup).toContain("流程控制台");
    expect(emptyMarkup).toContain("暂无日志");

    const linesMarkup = renderToStaticMarkup(
      <BlueprintWallConsoleOverlay consoleLines={[makeLine()]} />
    );
    expect(linesMarkup).toContain("流程控制台");
  });

  it("renders exactly the supplied number of lines without adding or capping (Req 7.7)", () => {
    // Capping is the deriver's responsibility; the overlay renders what it gets.
    const lines = Array.from({ length: 6 }, (_unused, index) =>
      makeLine({ id: `console:reasoning:r${index}`, text: `line ${index}` })
    );

    const markup = renderToStaticMarkup(
      <BlueprintWallConsoleOverlay consoleLines={lines} locale="en-US" />
    );

    const rendered = markup.match(/data-console-line-id="/g);
    expect(rendered).toHaveLength(6);
  });
});
