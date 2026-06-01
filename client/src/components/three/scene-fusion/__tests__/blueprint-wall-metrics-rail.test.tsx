/**
 * blueprint-wall-process-graph-hud-2026-05-31 Task 5.1 —
 * `BlueprintWallMetricsRail` 的 SSR / source 输出测试。
 *
 * 测试技术沿用同目录 `blueprint-wall-graph-node-card.test.tsx` 的约定：用
 * `react-dom/server` 的 `renderToStaticMarkup` 渲染纯组件，对静态 HTML 字符串断言，
 * 不引入 jsdom / @testing-library。
 *
 * 覆盖（对应 Req 7.1 / 7.2 / 7.3）：
 *  1. 四行遥测类目（BURN/SOURCES/REMAINING/TIME）渲染（7.1）。
 *  2. 缺失（null/undefined）字段渲染 muted 占位 `--`，不臆造数值（7.2）。
 *  3. 首版口径：token/source/remaining/time 全为 null → 四项均占位（7.3）。
 *  4. 字段存在时展示真实数值而非占位（为后续遥测 spec 扩展兜底验证）。
 *  5. en-US / zh-CN 双语标签都能渲染。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BlueprintWallMetricsRail,
  METRIC_PLACEHOLDER,
} from "../BlueprintWallMetricsRail";
import type { BlueprintWallMetrics } from "../blueprint-wall-process-data";

// ─── Fixture helper ──────────────────────────────────────────────────────────

/**
 * 构造一个合法的 `BlueprintWallMetrics`。默认四个遥测字段全为 `null`（对齐当前
 * deriver 的首版口径，Req 7.3），其余非遥测计数为 0；通过 `overrides` 覆盖。
 */
function makeMetrics(
  overrides: Partial<BlueprintWallMetrics> = {}
): BlueprintWallMetrics {
  return {
    tokenBurn: null,
    sourceCount: null,
    remainingPoints: null,
    elapsedMs: null,
    activeRoles: 0,
    capabilities: { total: 0, running: 0, completed: 0, failed: 0 },
    artifacts: 0,
    ...overrides,
  };
}

describe("BlueprintWallMetricsRail / SSR output", () => {
  it("renders the four telemetry rows (burn/sources/remaining/time) (Req 7.1)", () => {
    const markup = renderToStaticMarkup(
      <BlueprintWallMetricsRail metrics={makeMetrics()} locale="en-US" />
    );

    expect(markup).toContain("data-wall-metrics-rail");
    expect(markup).toContain('data-metric-key="burn"');
    expect(markup).toContain('data-metric-key="sources"');
    expect(markup).toContain('data-metric-key="remaining"');
    expect(markup).toContain('data-metric-key="time"');

    // English category labels.
    expect(markup).toContain("BURN");
    expect(markup).toContain("SOURCES");
    expect(markup).toContain("REMAINING");
    expect(markup).toContain("TIME");
  });

  it("renders muted placeholders for missing (null) metrics and does not fabricate values (Req 7.2)", () => {
    const markup = renderToStaticMarkup(
      <BlueprintWallMetricsRail metrics={makeMetrics()} locale="en-US" />
    );

    // Every telemetry row is in the placeholder state.
    const placeholderRows = markup.match(/data-metric-state="placeholder"/g);
    expect(placeholderRows).toHaveLength(4);
    // None of the rows are in the value state.
    expect(markup).not.toContain('data-metric-state="value"');
    // The muted placeholder glyph is present.
    expect(markup).toContain(METRIC_PLACEHOLDER);
  });

  it("renders all four telemetry fields as placeholders for the current deriver baseline (Req 7.3)", () => {
    // The current deriver always returns null for these four fields, so the
    // first implementation must render all four as placeholders.
    const markup = renderToStaticMarkup(
      <BlueprintWallMetricsRail
        metrics={makeMetrics({
          tokenBurn: null,
          sourceCount: null,
          remainingPoints: null,
          elapsedMs: null,
        })}
      />
    );

    const placeholderRows = markup.match(/data-metric-state="placeholder"/g);
    expect(placeholderRows).toHaveLength(4);
  });

  it("renders real values (not placeholders) when telemetry fields are present", () => {
    // Forward-compat: when a later telemetry spec supplies real values, the rail
    // must show them instead of the placeholder.
    const markup = renderToStaticMarkup(
      <BlueprintWallMetricsRail
        metrics={makeMetrics({
          tokenBurn: 189116,
          sourceCount: 371,
          remainingPoints: 1057,
          elapsedMs: 342000,
        })}
        locale="en-US"
      />
    );

    expect(markup).toContain("189116");
    expect(markup).toContain("371");
    expect(markup).toContain("1057");
    // 342000 ms → 5.7 min.
    expect(markup).toContain("5.7");
    // No placeholders when all four values exist.
    expect(markup).not.toContain('data-metric-state="placeholder"');
    expect(markup).toContain('data-metric-state="value"');
  });

  it("renders zh-CN labels by default", () => {
    const markup = renderToStaticMarkup(
      <BlueprintWallMetricsRail metrics={makeMetrics()} />
    );

    expect(markup).toContain("消耗");
    expect(markup).toContain("来源");
    expect(markup).toContain("剩余");
    expect(markup).toContain("用时");
  });
});
