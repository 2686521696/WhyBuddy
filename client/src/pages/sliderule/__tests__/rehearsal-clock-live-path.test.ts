/**
 * 产品六步钟必须接在通电的 SSE 投影上。
 *
 * 只测 mapInternalEventToProductStep 会假绿：表写对了、session 没调用
 * advanceRehearsalCursor，真机钟永远停在默认第 2 步。
 *
 * ⚠ 先剥注释再匹配。本文件和被查文件都写着 spec_tree / applyRehearsalEvent，
 * 不剥的话把调用点删了判据照样绿。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function load(rel: string): string {
  return stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));
}

function handlerSlice(src: string, name: string, span = 700): string {
  const at = src.indexOf(`${name}:`);
  expect(at, `${name} 不见了 —— 判据锚点失效`).toBeGreaterThan(-1);
  return src.slice(at, at + span);
}

describe("M8 映射表落在 derive-status-bar（不是文档）", () => {
  it("表里的 spec_tree 是字面 2，不是 1", () => {
    const src = load("../derive-status-bar.ts");
    const table = src.slice(
      src.indexOf("export const REHEARSAL_MODULE_TO_STEP"),
      src.indexOf("} as const")
    );
    expect(table).toMatch(/spec_tree:\s*2/);
    expect(table).not.toMatch(/spec_tree:\s*1/);
    expect(table).toMatch(/spec_page_html:\s*3/);
    expect(table).toMatch(/html_structure:\s*4/);
    expect(table).toMatch(/spec_semantics:\s*5/);
    expect(table).toMatch(/model_assembly:\s*6/);
    expect(table).toMatch(/html_bindings:\s*6/);
    expect(table).toMatch(/v5_model_gate:\s*6/);
    expect(table).toMatch(/evaluate_coverage_gate:\s*6/);
  });

  it("第 1 步 skippable: true 写在步骤表里", () => {
    const src = load("../derive-status-bar.ts");
    const steps = src.slice(
      src.indexOf("export const REHEARSAL_PRODUCT_STEPS"),
      src.indexOf("export const REHEARSAL_MODULE_TO_STEP")
    );
    expect(steps).toMatch(/id:\s*1[\s\S]*skippable:\s*true/);
  });

  it("墙上钟文案只有「大约数分钟」，派生层不写假分钟数", () => {
    const src = load("../derive-status-bar.ts");
    expect(src).toContain('"大约数分钟，第一页会先出现"');
    expect(src).not.toContain("8 分钟");
    expect(src).not.toContain("约 2 分钟");
    expect(src).not.toContain("20 分钟");
    expect(src).not.toMatch(/8–9/);
  });

  it("HUD token 只认 source === server（删掉这行比较必红）", () => {
    const src = load("../derive-status-bar.ts");
    const fn = src.slice(
      src.indexOf("export function deriveContextHudFacts"),
      src.indexOf("export type StatusBarFacts")
    );
    expect(fn).toMatch(/row\.source\s*(?:!==|===)\s*"server"/);
    expect(fn).toContain("publishClosure?.evidencePresentCount ?? 0");
    expect(fn).not.toContain("search_evidence");
  });
});

describe("SSE 投影接在 useSlideRuleSession（删调用点必红）", () => {
  it("reasoning_step / 页 sink / skill_start / heartbeat 都推进钟", () => {
    const src = load("../useSlideRuleSession.ts");
    expect(handlerSlice(src, "onReasoningStep")).toContain(
      "applyRehearsalEvent(capabilityId)"
    );
    expect(handlerSlice(src, "onSpecPage")).toContain(
      'applyRehearsalEvent("spec_page_html")'
    );
    expect(handlerSlice(src, "onSkillActivated")).toContain(
      "applyRehearsalEvent(skillId)"
    );
    expect(handlerSlice(src, "onProgressHeartbeat")).toContain(
      "applyRehearsalEvent(stage)"
    );
  });

  it("llmStreams 默认 collapsed: true", () => {
    const src = load("../useSlideRuleSession.ts");
    const at = src.indexOf("onLlmDelta:");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, at + 1600);
    expect(handler).toContain("collapsed: true");
    expect(handler).not.toContain("collapsed: false");
  });

  it("开流时用 startRehearsalCursor，不另开进度 API", () => {
    const src = load("../useSlideRuleSession.ts");
    expect(src).toContain("startRehearsalCursor()");
    expect(src).not.toContain("/rehearsal-progress");
    expect(src).not.toContain("/progress-clock");
    expect(src).not.toContain("POST /api/sliderule/progress");
  });
});

describe("产品面挂上了钟（不是只写了组件）", () => {
  it("ClaudeChatSurface 真的渲染 RehearsalClockHud", () => {
    const src = load("../../SlideRule.tsx");
    const surface = src.slice(
      src.indexOf("export function ClaudeChatSurface"),
      src.indexOf("function DriveFullStatusBanner")
    );
    expect(surface).toContain("<RehearsalClockHud");
    expect(surface).toContain("clock={rehearsalClock}");
  });

  it("Unified 把 rehearsalFacts 喂给对话列", () => {
    const src = load("../../SlideRule.tsx");
    expect(src).toContain("rehearsalClock={rehearsalFacts.rehearsalClock}");
    expect(src).toContain("hud={rehearsalFacts.hud}");
  });

  it("工程面 StatusBar 吃 rehearsalCursor", () => {
    const src = load("../../SlideRule.tsx");
    expect(src).toContain("rehearsalCursor={rehearsalCursor}");
    const bar = load("../SlideRuleStatusBar.tsx");
    expect(bar).toContain("<RehearsalClockHud");
    expect(bar).toContain("data-skippable=");
  });
});

describe("已有 SSE progress_heartbeat 投影，不另开 API", () => {
  it("marathon driver 把 heartbeat 交给 onProgressHeartbeat", () => {
    const src = load("../../../lib/sliderule-marathon-driver.ts");
    const at = src.indexOf('case "progress_heartbeat"');
    expect(at, "progress_heartbeat 分发不见了").toBeGreaterThan(-1);
    const slice = src.slice(at, at + 280);
    expect(slice).toContain("opts.onProgressHeartbeat");
    expect(slice).not.toContain("appendStreamStep");
  });
});
