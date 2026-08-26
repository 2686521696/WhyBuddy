/**
 * PR-1 / M5：质疑进作曲家 + persist fail-closed。
 *
 * ⚠ 先剥注释再匹配。本仓踩过：判据 grep 源码标识符，而那个词同时出现在
 * 文档字符串里，变异后照样绿。
 *
 * 反向：
 *   · 把 persist 闸改回 `catch { 仍继续驱动 }`，本文件必须红（挑战夹具
 *     会 POST /drive-full-stream）。
 *   · 质疑按钮改回直接 challengeTurn / window.prompt，预填断言必须红。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { persistPreparedStateForDrive } from "../useSlideRuleSession";
import {
  applyChallengePrefillToComposer,
  CHALLENGE_COMPOSER_PREFIX,
  CHALLENGE_PREFILL_EVENT,
  composeChallengePrefill,
  DEFAULT_CHALLENGE_BODY,
  isChallengeComposerText,
} from "../ComposerDock";
import { ClaudeChatSurface } from "../../SlideRule";
import type { UiTurn } from "../types";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function readRel(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const SESSION_SRC = stripComments(readRel("../useSlideRuleSession.ts"));
const DOCK_SRC = stripComments(readRel("../ComposerDock.tsx"));
const PAGE_SRC = stripComments(readRel("../../SlideRule.tsx"));
const DEV_SRC = readRel("../../SlideRuleDev.tsx");

function persistGateWindow(): string {
  const loadingAt = SESSION_SRC.indexOf('setDriveFullStatus("loading")');
  expect(loadingAt, "找不到 drive-full 点火前的 loading 闸").toBeGreaterThan(-1);
  const persistAt = SESSION_SRC.indexOf("persistPreparedStateForDrive", loadingAt);
  expect(
    persistAt,
    "drive-full 点火前没有 persistPreparedStateForDrive —— 改回 catch { 仍继续驱动 } 就会这样"
  ).toBeGreaterThan(loadingAt);
  const driveAt = SESSION_SRC.indexOf("driveFullViaPythonStream", persistAt + 1);
  expect(driveAt, "找不到 persist 之后的 driveFullViaPythonStream").toBeGreaterThan(
    persistAt
  );
  // 只取闸函数调用后的一小段：后面 onLlmDelta 里也有 return，吞进去会假绿。
  return SESSION_SRC.slice(persistAt, persistAt + 1600);
}

function fnBody(src: string, needle: string, endNeedle: string): string {
  const at = src.indexOf(needle);
  expect(at, `${needle} 不见了`).toBeGreaterThan(-1);
  const end = src.indexOf(endNeedle, at + needle.length);
  expect(end, `${endNeedle} 收尾不见了`).toBeGreaterThan(at);
  return src.slice(at, end);
}

describe("产品面剥注释后不准再弹 window.prompt", () => {
  it("useSlideRuleSession / ComposerDock / SlideRule 无 window.prompt(", () => {
    expect(SESSION_SRC).not.toContain("window.prompt(");
    expect(DOCK_SRC).not.toContain("window.prompt(");
    expect(PAGE_SRC).not.toContain("window.prompt(");
  });

  it("反向：Dev 页仍可保留 prompt，标 legacy（不是产品面）", () => {
    expect(DEV_SRC).toContain("window.prompt(");
    expect(DEV_SRC).toMatch(/legacy/);
  });
});

describe("挑战 persist 失败夹具：零 POST /drive-full-stream", () => {
  it("persistSession rejects + intent challenge → 不得点火", async () => {
    const posts: string[] = [];
    const gate = await persistPreparedStateForDrive({
      persist: () => Promise.reject(new Error("disk full")),
      intent: "challenge",
    });
    if (gate.ok) {
      posts.push("/drive-full-stream");
    }
    expect(gate.ok).toBe(false);
    expect(posts).toEqual([]);
  });

  it("persist 成功 → 允许点火（整轮工厂，不是局部重跑）", async () => {
    const posts: string[] = [];
    const gate = await persistPreparedStateForDrive({
      persist: async () => undefined,
      intent: "challenge",
    });
    if (gate.ok) posts.push("/drive-full-stream");
    expect(gate.ok).toBe(true);
    expect(posts).toEqual(["/drive-full-stream"]);
  });

  it("非挑战 persist 失败仍 fail-open（请求体兜底），不把增强路径写成 fail-closed", async () => {
    const posts: string[] = [];
    const gate = await persistPreparedStateForDrive({
      persist: () => Promise.reject(new Error("disk full")),
      intent: "clarify",
    });
    if (gate.ok) posts.push("/drive-full-stream");
    expect(gate.ok).toBe(true);
    expect(posts).toEqual(["/drive-full-stream"]);
  });

  it("通电：runTurn 在 driveFullViaPythonStream 之前消费 persist 闸，失败则 return", () => {
    const loadingAt = SESSION_SRC.indexOf('setDriveFullStatus("loading")');
    const persistAt = SESSION_SRC.indexOf(
      "persistPreparedStateForDrive",
      loadingAt
    );
    const driveAt = SESSION_SRC.indexOf("driveFullViaPythonStream", persistAt + 1);
    expect(persistAt).toBeGreaterThan(loadingAt);
    expect(driveAt).toBeGreaterThan(persistAt);

    const block = persistGateWindow();
    expect(block).toMatch(/intent:\s*intervention\?\.intent/);
    expect(block).toMatch(/!persisted\.ok/);
    expect(block).toMatch(/\breturn\b/);
    expect(block).toContain("质疑未生效");
    // 反向：闸窗里不许已经点着 stream（失败 return 必须在点火前）
    expect(block).not.toContain("driveFullViaPythonStream");
    expect(block).not.toContain("driveMarathon");
  });

  it("反向：挑战路径不得发明 pendingRuns / 能力级重跑", () => {
    expect(SESSION_SRC).not.toContain("pendingRuns");
  });
});

describe("质疑按钮预填作曲家，而不是立刻点火", () => {
  it("composeChallengePrefill 以「质疑：」开头", () => {
    expect(composeChallengePrefill()).toBe(
      `${CHALLENGE_COMPOSER_PREFIX}${DEFAULT_CHALLENGE_BODY}`
    );
    expect(composeChallengePrefill("可行性报告")).toBe("质疑：可行性报告");
    expect(isChallengeComposerText("质疑：这段不对")).toBe(true);
    expect(isChallengeComposerText("做一个请假系统")).toBe(false);
  });

  it("applyChallengePrefillToComposer 写入作曲家文本", () => {
    const seen: string[] = [];
    const next = applyChallengePrefillToComposer(t => seen.push(t), {});
    expect(next.startsWith("质疑：")).toBe(true);
    expect(seen).toEqual([next]);
  });

  it("ComposerDock 监听 challenge-prefill 并调用 applyChallengePrefillToComposer", () => {
    expect(DOCK_SRC).toContain("addEventListener(CHALLENGE_PREFILL_EVENT");
    expect(DOCK_SRC).toContain("applyChallengePrefillToComposer");
    expect(DOCK_SRC).toContain("textareaRef.current?.focus()");
  });

  it("产品面质疑按钮接到 dispatchChallengePrefill，不是 challengeTurn / prompt", () => {
    const unified = PAGE_SRC.slice(
      PAGE_SRC.indexOf("function SlideRuleUnified"),
      PAGE_SRC.indexOf("function SlideRuleSplitEngineering")
    );
    expect(unified).toContain("dispatchChallengePrefill");
    expect(unified).not.toMatch(/onChallenge=\{challengeTurn\}/);
    expect(PAGE_SRC).toContain("sliderule-challenge-turn");
    expect(PAGE_SRC).toContain("质疑本轮");
    const challengeBtn = PAGE_SRC.slice(
      PAGE_SRC.indexOf("质疑本轮") - 400,
      PAGE_SRC.indexOf("质疑本轮")
    );
    expect(challengeBtn).toContain("onChallenge(turn.main");
    expect(challengeBtn).toContain("sliderule-challenge-turn");
  });

  it("静态渲染：质疑本轮按钮在完成轮上出现", () => {
    const turn: UiTurn = {
      id: "t1",
      user: "做一个宠物医院预约系统",
      status: "complete",
      steps: [],
      routeFacts: { turnId: "t1" },
      routeExpanded: false,
      routeLitCount: 0,
      assistant: "推演完成",
      assistantSource: "llm",
      main: { artifactId: "a1", kind: "report", realLlm: true },
      actions: [],
    };
    const html = renderToStaticMarkup(
      React.createElement(ClaudeChatSurface, {
        uiTurns: [turn],
        isRunning: false,
        liveAction: null,
        latestTurn: turn,
        onChallenge: () => {},
      })
    );
    expect(html).toContain("质疑本轮");
    expect(html).toContain('data-testid="sliderule-challenge-turn"');
    expect(html).not.toContain("window.prompt");
  });
});

describe("persist 成功后仍是整轮 runTurn + intent challenge", () => {
  it("challengeTurn 有理由时走 runTurn，不是局部重跑", () => {
    const body = fnBody(
      SESSION_SRC,
      "const challengeTurn = async",
      "const resetSession"
    );
    expect(body).toContain("runTurn");
    expect(body).toContain('intent: "challenge"');
    expect(body).toContain("dispatchChallengePrefill");
    expect(body).not.toContain("pendingRuns");
    expect(body).not.toContain("forcedTool");
    expect(body).not.toContain("window.prompt(");
  });

  it("sendMessage 在预填质疑文本 / pending 时带 intent challenge", () => {
    const body = fnBody(
      SESSION_SRC,
      "const sendMessage = async",
      "const repairGaps"
    );
    expect(body).toContain("isChallengeComposerText");
    expect(body).toContain('intent: "challenge"');
    expect(body).toContain("runTurn");
  });

  it("本 PR 不发明 Python 半套 invalidate", () => {
    expect(SESSION_SRC).not.toContain("invalidate_for_intervention");
    expect(SESSION_SRC).not.toContain("apply_user_intervention_invalidation");
    expect(PAGE_SRC).not.toContain("invalidate_for_intervention");
    const runtime = stripComments(
      readFileSync(
        fileURLToPath(new URL("../../../lib/sliderule-runtime.ts", import.meta.url)),
        "utf8"
      )
    );
    expect(runtime).toContain("function invalidateForIntervention");
    expect(runtime).toContain("working = invalidateForIntervention(working, intervention)");
  });
});
