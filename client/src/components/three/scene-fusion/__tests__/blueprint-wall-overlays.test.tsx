/**
 * blueprint-wall-process-graph-hud-2026-05-31 Task 5.4 —
 * 墙面 overlay **整合 / 源码护栏**测试（consolidation guard）。
 *
 * Task 5.1 / 5.2 / 5.3 已分别为三块 overlay 写了单组件测试：
 *  - `blueprint-wall-metrics-rail.test.tsx`（左侧遥测栏：四行 / 占位基线 / 真值前向兼容）
 *  - `blueprint-wall-console-overlay.test.tsx`（底部 console：空壳 / 非空 / tone / 行数）
 *  - `blueprint-wall-graph-controls.test.tsx` + `blueprint-wall-minimap-controls-config.test.ts`
 *    （右上控件 + 右下 minimap 插件配置 + HUD 接线）
 *
 * 本文件**不重复**这些单组件断言，只补 Task 5.4 真正缺失的「整合层」保证：
 *
 *  (A) HUD 宿主把**三块 overlay 一起挂载**，并且它们都由**同一份**
 *      `deriveBlueprintWallProcessData(...)` 输出（`wallData`）喂养——这样未来重构
 *      无法静默丢掉其中任意一块、也无法把它们接到第二套数据源。读 HUD 源码文本断言
 *      （沿用同目录 `blueprint-wall-process-graph-hud.test.tsx` 的源码护栏约定，不在
 *      node 环境真正渲染静态依赖 `@ant-design/graphs` / G6 的重型 HUD）。
 *
 *  (B) 行为级：用**真实 deriver 输出**驱动两块纯 overlay 的 SSR，证明
 *      metrics 占位（Req 7.1-7.3）与 console 空/非空（Req 7.4-7.7）在「单一数据源」
 *      端到端口径下成立——而不是只用手搓 fixture 验证单组件。
 *
 *  (C) 作用域护栏（Req 3.7 / 4.4 / 4.5 / 10.2）：三块 overlay 组件源码都**不得**读取
 *      mission-first 沙箱状态（`useSandboxStore`），也不得 import 可视组件
 *      `SandboxMonitor` / `MissionWallTaskPanel`。HUD 本身已有此护栏
 *      （`blueprint-wall-process-graph-hud.test.tsx`），这里把同一护栏下推到各 overlay。
 *
 * 覆盖：Req 7.1-7.7（overlay 数据消费）/ Req 10.2（HUD 用 @ant-design/graphs + 单一
 * deriver、不读沙箱）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type { CapabilityStatus } from "@/lib/blueprint-realtime-store";

import { BlueprintWallConsoleOverlay } from "../BlueprintWallConsoleOverlay";
import {
  BlueprintWallMetricsRail,
  METRIC_PLACEHOLDER,
} from "../BlueprintWallMetricsRail";
import { deriveBlueprintWallProcessData } from "../blueprint-wall-process-data";

// ─── Source readers (consolidation / scope guards) ───────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const readScene = (file: string) =>
  readFileSync(resolve(here, "..", file), "utf8");

const hudSource = readScene("BlueprintWallProcessGraphHud.tsx");
const metricsRailSource = readScene("BlueprintWallMetricsRail.tsx");
const consoleOverlaySource = readScene("BlueprintWallConsoleOverlay.tsx");
const controlsSource = readScene("BlueprintWallGraphControls.tsx");

/**
 * 剥离行注释 / 块注释（含 JSX `{/* ... *\/}`）后的源码。
 *
 * 三块 overlay 与 HUD 的 JSDoc 里都**记录**了护栏文字（如「不得读取 useSandboxStore」），
 * 直接对整段源码做 `includes` 会误命中这些文档说明，因此先剥注释再查实际代码。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** 收集源码里与 import 语句相关的行（`import` 起始行 + `from "..."` 收尾行）。 */
function importLines(source: string): string {
  return source
    .split("\n")
    .filter(
      line => line.trim().startsWith("import") || /\bfrom\s+["']/.test(line)
    )
    .join("\n");
}

// ─── Fixtures (real deriver output) ──────────────────────────────────────────

function makeJob(
  overrides: Partial<BlueprintGenerationJob> = {}
): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {},
    status: "running",
    stage: "spec_tree",
    ...overrides,
  } as unknown as BlueprintGenerationJob;
}

function makeReasoning(
  overrides: Partial<AgentReasoningEntry> & { id: string; jobId: string }
): AgentReasoningEntry {
  return {
    iteration: 0,
    iterationLabel: "#0",
    phase: "thinking",
    timestamp: "2026-05-31T00:00:00.000Z",
    ...overrides,
  } as AgentReasoningEntry;
}

// ─── (A) HUD mounts all three overlays from a single deriver output ──────────

describe("BlueprintWallProcessGraphHud consolidates all three overlays (source guard)", () => {
  const hudCode = stripComments(hudSource);
  const hudImports = importLines(hudSource);

  it("imports all three overlay components (Req 7.1 / 7.4 / 2.4)", () => {
    // 三块 overlay 的 import 都必须存在——这条护栏保证未来重构不会删掉某块 overlay 的引入。
    expect(hudImports).toContain("BlueprintWallMetricsRail");
    expect(hudImports).toContain("BlueprintWallConsoleOverlay");
    expect(hudImports).toContain("BlueprintWallGraphControls");
    expect(/from\s+["']\.\/BlueprintWallMetricsRail["']/.test(hudImports)).toBe(
      true
    );
    expect(
      /from\s+["']\.\/BlueprintWallConsoleOverlay["']/.test(hudImports)
    ).toBe(true);
    expect(
      /from\s+["']\.\/BlueprintWallGraphControls["']/.test(hudImports)
    ).toBe(true);
  });

  it("mounts (renders) all three overlays in the same host", () => {
    // JSX 挂载点都在：metrics rail + console + 外部 fit/zoom 控件。
    expect(hudCode).toContain("<BlueprintWallMetricsRail");
    expect(hudCode).toContain("<BlueprintWallConsoleOverlay");
    expect(hudCode).toContain("<BlueprintWallGraphControls");
  });

  it("computes graph data from exactly one deriveBlueprintWallProcessData call (single source)", () => {
    // 单一数据源：HUD 只调用一次 deriver（import 标识符不带 `(`，故只数到真正的调用）。
    const calls = hudCode.match(/deriveBlueprintWallProcessData\(/g);
    expect(calls).toHaveLength(1);
  });

  it("feeds the metrics rail AND the console from the SAME wallData output", () => {
    // 两块数据型 overlay 都从同一份 `wallData`（deriver 输出）取数，不各自造数据源。
    expect(hudCode).toContain("metrics={wallData.metrics}");
    expect(hudCode).toContain("consoleLines={wallData.consoleLines}");
  });

  it("wires the minimap plugin into the same FlowGraph that the controls drive (Req 2.3 / 2.4)", () => {
    // minimap 经 plugins 接到 FlowGraph；右上控件经转发 ref 命令式驱动同一张图。
    expect(hudCode).toContain("FlowGraph");
    expect(hudCode).toContain("plugins={BLUEPRINT_WALL_PLUGINS}");
    expect(hudCode).toContain("ref={graphRef}");
    expect(hudCode).toContain("onFitView=");
  });
});

// ─── (B) Behavioral: real deriver output drives the overlays end-to-end ──────

describe("Overlays consume the single deriver output (behavioral consolidation)", () => {
  it("metrics rail renders all four telemetry fields as placeholders for real has-data deriver output (Req 7.1-7.3)", () => {
    // 真实 has-data 路径（job + capabilityStatuses）：deriver 的四个遥测字段恒为 null，
    // 故遥测栏四行全部渲染为 muted 占位（首版口径，Req 7.3），不臆造数值。
    const wallData = deriveBlueprintWallProcessData({
      job: makeJob(),
      capabilityStatuses: { c1: "invoking" } as Record<
        string,
        CapabilityStatus
      >,
    });

    // 单一数据源前置确认：四个遥测字段确实是 null。
    expect(wallData.metrics.tokenBurn).toBeNull();
    expect(wallData.metrics.sourceCount).toBeNull();
    expect(wallData.metrics.remainingPoints).toBeNull();
    expect(wallData.metrics.elapsedMs).toBeNull();

    const markup = renderToStaticMarkup(
      <BlueprintWallMetricsRail metrics={wallData.metrics} locale="en-US" />
    );

    const placeholders = markup.match(/data-metric-state="placeholder"/g);
    expect(placeholders).toHaveLength(4);
    expect(markup).not.toContain('data-metric-state="value"');
    expect(markup).toContain(METRIC_PLACEHOLDER);
  });

  it("console renders the non-empty lines produced by the deriver for the current job (Req 7.4 / 7.5)", () => {
    // 真实 deriver：当前 job 的 reasoning entry → 一条 console 行（id / 文本来自 deriver）。
    const wallData = deriveBlueprintWallProcessData({
      job: makeJob(),
      agentReasoningEntries: [
        makeReasoning({
          id: "r1",
          jobId: "job-1",
          iterationLabel: "#1",
          thought: "thinking about routes",
        }),
      ],
    });

    // 单一数据源前置确认：console 行确实由 deriver 产出且非空。
    expect(wallData.consoleLines.length).toBeGreaterThan(0);
    expect(wallData.consoleLines[0]?.id).toBe("console:reasoning:r1");

    const markup = renderToStaticMarkup(
      <BlueprintWallConsoleOverlay
        consoleLines={wallData.consoleLines}
        locale="en-US"
      />
    );

    expect(markup).toContain('data-console-state="lines"');
    expect(markup).toContain('data-console-line-id="console:reasoning:r1"');
    expect(markup).toContain("thinking about routes");
    expect(markup).not.toContain("data-console-empty");
  });

  it("console renders the empty shell for the deriver's no-job output (Req 7.5)", () => {
    // 真实 deriver：无 job → consoleLines === []，overlay 渲染空 console 壳，不臆造行。
    const wallData = deriveBlueprintWallProcessData({ job: null });
    expect(wallData.consoleLines).toEqual([]);

    const markup = renderToStaticMarkup(
      <BlueprintWallConsoleOverlay
        consoleLines={wallData.consoleLines}
        locale="en-US"
      />
    );

    expect(markup).toContain('data-console-state="empty"');
    expect(markup).toContain("data-console-empty");
    expect(markup).not.toContain("data-console-line-id");
  });
});

// ─── (C) Per-overlay scope guards (no mission-first sandbox leakage) ─────────

describe("Overlay components do not leak mission-first sandbox sources (Req 3.7 / 4.4 / 4.5 / 10.2)", () => {
  const overlays: Array<{ name: string; source: string }> = [
    { name: "BlueprintWallMetricsRail", source: metricsRailSource },
    { name: "BlueprintWallConsoleOverlay", source: consoleOverlaySource },
    { name: "BlueprintWallGraphControls", source: controlsSource },
  ];

  for (const { name, source } of overlays) {
    it(`${name} never references useSandboxStore in code`, () => {
      // 剥注释后检查实际代码（JSDoc 里记录了该护栏文字，避免误命中）。
      expect(stripComments(source).includes("useSandboxStore")).toBe(false);
    });

    it(`${name} does not import SandboxMonitor / MissionWallTaskPanel`, () => {
      const imports = importLines(source);
      expect(imports.includes("SandboxMonitor")).toBe(false);
      expect(imports.includes("MissionWallTaskPanel")).toBe(false);
    });
  }
});
