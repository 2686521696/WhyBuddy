/**
 * blueprint-wall-process-graph-hud-2026-05-31 Task 6.3 — 空态测试（empty state）。
 *
 * Task 6.3 把 HUD 的空态从内联 `<div>` 正式化为纯组件 `BlueprintWallEmptyState`：
 * 无活动蓝图作业时，墙面渲染一块**干净的空图状态**，**不**落任何 mission-first 兜底
 * 数据（无终端日志 / 截图 / 任务摘要 / 臆造节点边）。
 *
 * 本文件沿用同目录既有约定（live FlowGraph 静态依赖 `@ant-design/graphs` / G6，在 node
 * 测试环境无法完整渲染，故在 **deriver / 数据层 + 纯组件 SSR + 源码护栏**层面验证）：
 *
 *  (A) 数据层（Req 4.2）：`job: null`（且无其它输入）时，deriver 产出零节点、零边、
 *      `emptyReason === "no-job"`、空 console / 空 preview——即「干净空图」，无任何
 *      mission/sandbox 兜底内容渗入。
 *
 *  (B) 纯组件 SSR（Req 4.2 / 10.6）：`BlueprintWallEmptyState` 渲染稳定可测的空态 DOM
 *      （`data-wall-empty-state` + `data-empty-reason`），本地化文案正确，且不渲染任何
 *      节点 / 边 / 日志内容。
 *
 *  (C) HUD 接线源码护栏：HUD 在空态走 `EMPTY_GRAPH_DATA`（不臆造节点/边），挂载
 *      `BlueprintWallEmptyState` 并透传 `emptyReason`，且 fit/zoom 控件在空态禁用
 *      （`disabled={isEmpty}`）。
 *
 *  (D) 作用域护栏（Req 3.7 / 4.4 / 4.5）：空态组件不读 `useSandboxStore`、不 import
 *      `SandboxMonitor` / `MissionWallTaskPanel`。
 *
 * 覆盖：Req 4.2（无活动作业 → 干净空图、无 mission 兜底）/ Req 10.6（空态渲染测试）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BlueprintWallEmptyState } from "../BlueprintWallEmptyState";
import { deriveBlueprintWallProcessData } from "../blueprint-wall-process-data";

// ─── Source readers (HUD wiring + scope guards) ──────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const readScene = (file: string) => readFileSync(resolve(here, "..", file), "utf8");

const hudSource = readScene("BlueprintWallProcessGraphHud.tsx");
const emptyStateSource = readScene("BlueprintWallEmptyState.tsx");

/** 剥离行注释 / 块注释（含 JSX `{/* ... *\/}`）后的源码，避免 JSDoc 护栏文字误命中。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** 收集源码里与 import 语句相关的行（`import` 起始行 + `from "..."` 收尾行）。 */
function importLines(source: string): string {
  return source
    .split("\n")
    .filter(
      (line) => line.trim().startsWith("import") || /\bfrom\s+["']/.test(line)
    )
    .join("\n");
}

// ─── (A) Data layer: null job yields a clean empty graph (Req 4.2) ───────────

describe("Empty state data layer: null job → clean empty graph (Req 4.2)", () => {
  it("job: null（无其它输入）产出零节点 / 零边 / no-job，无 mission 兜底内容", () => {
    const result = deriveBlueprintWallProcessData({ job: null });

    // 干净空图：无节点、无边（不臆造任何 mission/sandbox 兜底节点）。
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.emptyReason).toBe("no-job");

    // 无 console 行、preview 空态：墙面空态下不落终端日志 / 截图等 mission 兜底。
    expect(result.consoleLines).toEqual([]);
    expect(result.previewSummary.status).toBe("empty");

    // minimap 也空（无图节点）。
    expect(result.minimap.nodes).toEqual([]);

    // 遥测字段保持干净的 null 基线（无臆造数值）。
    expect(result.metrics.tokenBurn).toBeNull();
    expect(result.metrics.sourceCount).toBeNull();
    expect(result.metrics.remainingPoints).toBeNull();
    expect(result.metrics.elapsedMs).toBeNull();
    expect(result.metrics.activeRoles).toBe(0);
    expect(result.metrics.artifacts).toBe(0);
  });

  it("job: undefined 同样产出干净空图（no-job）", () => {
    const result = deriveBlueprintWallProcessData({ job: undefined });

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.emptyReason).toBe("no-job");
  });
});

// ─── (B) Pure component SSR: empty state renders cleanly (Req 4.2 / 10.6) ────

describe("BlueprintWallEmptyState SSR (Req 4.2 / 10.6)", () => {
  it("无 job 的 deriver 输出驱动空态：渲染 no-job 空态 DOM，无节点/日志内容", () => {
    const result = deriveBlueprintWallProcessData({ job: null });

    const markup = renderToStaticMarkup(
      <BlueprintWallEmptyState reason={result.emptyReason} locale="en-US" />
    );

    expect(markup).toContain("data-wall-empty-state");
    expect(markup).toContain('data-empty-reason="no-job"');
    expect(markup).toContain("Blueprint process graph");
    expect(markup).toContain("No active blueprint job");
    // 空态不渲染任何图节点 / console 行内容。
    expect(markup).not.toContain("data-console-line-id");
  });

  it("默认（缺省 locale）渲染中文空态文案", () => {
    const markup = renderToStaticMarkup(<BlueprintWallEmptyState />);

    expect(markup).toContain('data-empty-reason="no-job"');
    expect(markup).toContain("蓝图流程图");
    expect(markup).toContain("暂无进行中的蓝图作业");
  });

  it("透传 no-blueprint-data 时反映该 reason（语义完备）", () => {
    const markup = renderToStaticMarkup(
      <BlueprintWallEmptyState reason="no-blueprint-data" locale="en-US" />
    );

    expect(markup).toContain('data-empty-reason="no-blueprint-data"');
  });
});

// ─── (C) HUD wiring source guards (EMPTY_GRAPH_DATA + empty overlay) ─────────

describe("HUD wires the empty state (source guard)", () => {
  const hudCode = stripComments(hudSource);
  const hudImports = importLines(hudSource);

  it("空态下完全不挂载 <FlowGraph>（不臆造节点 / 边，且不初始化 G6）", () => {
    // Fix 3：空态不再靠传空 data 给 FlowGraph（`isEmpty({nodes:[],edges:[]})===false`，
    // 空 data 仍会挂载 G6/Graphin 画布与 minimap）。改为在 JSX 层直接 gate：
    // `isEmpty ? null : (<FlowGraph ...）`，空态根本不渲染图。
    expect(hudCode).toMatch(/isEmpty\s*\?\s*null\s*:\s*\(\s*<FlowGraph/);
    // 非空态把映射结果 flowGraph.data 喂给 FlowGraph。
    expect(hudCode).toContain("data={flowGraph.data}");
    // 旧的 EMPTY_GRAPH_DATA 常量 / 三元已移除（不再传空 data 试图阻止挂载）。
    expect(hudCode).not.toContain("EMPTY_GRAPH_DATA");
    expect(hudCode).not.toContain("isEmpty ? EMPTY_GRAPH_DATA : flowGraph.data");
  });

  it("挂载 BlueprintWallEmptyState 并透传 deriver 的 emptyReason（Req 4.2 / 10.6）", () => {
    expect(hudImports).toContain("BlueprintWallEmptyState");
    expect(/from\s+["']\.\/BlueprintWallEmptyState["']/.test(hudImports)).toBe(true);
    expect(hudCode).toContain("<BlueprintWallEmptyState");
    expect(hudCode).toContain("reason={wallData.emptyReason}");
    // 仅在空态分支挂载。
    expect(hudCode).toMatch(/isEmpty\s*\?\s*\(\s*<BlueprintWallEmptyState/);
  });

  it("空态下禁用 fit/zoom 控件（disabled={isEmpty}）", () => {
    expect(hudCode).toContain("disabled={isEmpty}");
  });

  it("不再保留内联空态 <div> 的硬编码文案（已抽到空态组件）", () => {
    // 旧内联文案三元已被组件取代：HUD 源码不应再直接出现成对内联文案。
    expect(hudCode).not.toContain('"Blueprint process graph"');
  });
});

// ─── (D) Empty-state component scope guards (no mission-first leakage) ───────

describe("BlueprintWallEmptyState scope guards (Req 3.7 / 4.4 / 4.5)", () => {
  it("never references useSandboxStore in code", () => {
    expect(stripComments(emptyStateSource).includes("useSandboxStore")).toBe(false);
  });

  it("does not import SandboxMonitor / MissionWallTaskPanel", () => {
    const imports = importLines(emptyStateSource);
    expect(imports.includes("SandboxMonitor")).toBe(false);
    expect(imports.includes("MissionWallTaskPanel")).toBe(false);
  });
});
