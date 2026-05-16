/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — useAutopilotSandboxBridge 单测
 *
 * 测试范围与口径：
 *
 *   本仓 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`（NFR-1：
 *   不扩张工具链）。`useAutopilotSandboxBridge` 内部的 useEffect 副作用
 *   依赖真实 DOM runtime，因此本文件**不**直接驱动 hook，而是通过 hook 模块
 *   暴露的 `__testing__` 命名导出覆盖以下两条纯数据变换链路：
 *
 *     1. agentReasoning entry → LogLine（通过 `entryToLogLine`）
 *     2. effectPreview.runtimeProjection.logTimeline entry → LogLine
 *        （通过 `logTimelineEntryToLogLine`）
 *
 *   这是覆盖率最高、回归风险最大的两条变换；hook 自身的 useEffect 流程
 *   （setActiveMission / 增量 dedupe / cleanup）由 manual-verification 与
 *   既有 SSR 集成测试间接覆盖，与本仓 `use-autopilot-right-rail-data.test.ts`
 *   等其它 hook 测试的策略保持一致。
 *
 * 测试覆盖：
 * 1. thinking phase → "[iter] THINKING <thought>" / stdout
 * 2. acting phase → "[iter] ACTING → <toolId>" / stdout
 * 3. observing(success=true) → "[iter] OBSERVING ✓ <summary>" / stdout
 * 4. observing(success=false) → "[iter] OBSERVING ✗ <summary>" / stdout
 * 5. error phase → stderr 流（让 wall 终端用 ANSI 红色渲染）
 * 6. completed phase → reason 体写入 data
 * 7. logTimeline level=info → stdout，data 带 "[runtime]" 前缀
 * 8. logTimeline level=warning → stderr
 * 9. logTimeline level=success → stdout
 */

import { describe, expect, it } from "vitest";

import { __testing__ } from "../useAutopilotSandboxBridge";

const { entryToLogLine, logTimelineEntryToLogLine } = __testing__;

const BASE_TIMESTAMP = "2026-05-16T07:00:00.000Z";

describe("useAutopilotSandboxBridge / entryToLogLine", () => {
  it("thinking phase 推到 stdout，文本含 phase + thought", () => {
    const line = entryToLogLine({
      id: "t-1",
      iteration: 1,
      iterationLabel: "iter-1",
      phase: "thinking",
      thought: "正在分析仓库结构",
      timestamp: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stdout");
    expect(line.data).toContain("[iter-1]");
    expect(line.data).toContain("THINKING");
    expect(line.data).toContain("正在分析仓库结构");
    expect(line.timestamp).toBe(BASE_TIMESTAMP);
    expect(line.stepIndex).toBe(0);
  });

  it("acting phase 文本含 toolId 箭头格式", () => {
    const line = entryToLogLine({
      id: "a-1",
      iteration: 1,
      iterationLabel: "iter-1",
      phase: "acting",
      actionToolId: "github.get_repository",
      timestamp: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stdout");
    expect(line.data).toContain("ACTING");
    expect(line.data).toContain("→ github.get_repository");
  });

  it("observing(success=true) 用 ✓ 前缀", () => {
    const line = entryToLogLine({
      id: "o-1",
      iteration: 1,
      iterationLabel: "iter-1",
      phase: "observing",
      observationSuccess: true,
      observationSummary: "扫描完成 12 个文件",
      timestamp: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stdout");
    expect(line.data).toContain("OBSERVING");
    expect(line.data).toContain("✓");
    expect(line.data).toContain("扫描完成 12 个文件");
  });

  it("observing(success=false) 用 ✗ 前缀", () => {
    const line = entryToLogLine({
      id: "o-2",
      iteration: 1,
      iterationLabel: "iter-1",
      phase: "observing",
      observationSuccess: false,
      observationSummary: "仓库扫描失败",
      timestamp: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stdout");
    expect(line.data).toContain("OBSERVING");
    expect(line.data).toContain("✗");
    expect(line.data).toContain("仓库扫描失败");
  });

  it("error phase 走 stderr 让墙面终端用 ANSI 红色", () => {
    const line = entryToLogLine({
      id: "e-1",
      iteration: 1,
      iterationLabel: "iter-1",
      phase: "error",
      error: "LLM 调用失败:Insufficient balance",
      timestamp: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stderr");
    expect(line.data).toContain("ERROR");
    expect(line.data).toContain("Insufficient balance");
  });

  it("completed phase 写入 reason 文本", () => {
    const line = entryToLogLine({
      id: "c-1",
      iteration: 1,
      iterationLabel: "iter-1",
      phase: "completed",
      reason: "阶段完成",
      timestamp: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stdout");
    expect(line.data).toContain("COMPLETED");
    expect(line.data).toContain("阶段完成");
  });

  it("缺失 iterationLabel 时不带 [iter-X] 前缀但 phase 仍写入", () => {
    const line = entryToLogLine({
      id: "n-1",
      iteration: 1,
      iterationLabel: "",
      phase: "thinking",
      thought: "no label",
      timestamp: BASE_TIMESTAMP,
    });

    expect(line.data).not.toMatch(/^\[/);
    expect(line.data).toContain("THINKING");
    expect(line.data).toContain("no label");
  });
});

describe("useAutopilotSandboxBridge / logTimelineEntryToLogLine", () => {
  it("level=info 推到 stdout，data 带 [runtime] 前缀", () => {
    const line = logTimelineEntryToLogLine({
      id: "lt-1",
      level: "info",
      message: "前端构建启动",
      occurredAt: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stdout");
    expect(line.data).toContain("[runtime]");
    expect(line.data).toContain("前端构建启动");
    expect(line.timestamp).toBe(BASE_TIMESTAMP);
    expect(line.stepIndex).toBe(1);
  });

  it("level=warning 走 stderr", () => {
    const line = logTimelineEntryToLogLine({
      id: "lt-2",
      level: "warning",
      message: "依赖版本不一致",
      occurredAt: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stderr");
    expect(line.data).toContain("依赖版本不一致");
  });

  it("level=success 仍走 stdout（与 info 同流，区分由 message 自身承担）", () => {
    const line = logTimelineEntryToLogLine({
      id: "lt-3",
      level: "success",
      message: "构建产物已生成",
      occurredAt: BASE_TIMESTAMP,
    });

    expect(line.stream).toBe("stdout");
    expect(line.data).toContain("构建产物已生成");
  });

  it("stepIndex=1 与 entryToLogLine 的 0 区分，便于墙面终端按行业归一渲染时分组", () => {
    const reasoningLine = entryToLogLine({
      id: "t-step",
      iteration: 1,
      iterationLabel: "iter-1",
      phase: "thinking",
      thought: "x",
      timestamp: BASE_TIMESTAMP,
    });
    const timelineLine = logTimelineEntryToLogLine({
      id: "lt-step",
      level: "info",
      message: "y",
      occurredAt: BASE_TIMESTAMP,
    });

    expect(reasoningLine.stepIndex).toBe(0);
    expect(timelineLine.stepIndex).toBe(1);
  });
});
