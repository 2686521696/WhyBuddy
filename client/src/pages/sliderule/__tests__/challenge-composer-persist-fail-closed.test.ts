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
 *   · sendMessage 改回 `if (pending || isChallengeComposerText)`，
 *     leftover pending + 非前缀发送必须红。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { persistPreparedStateForDrive } from "../useSlideRuleSession";
import {
  applyChallengePrefillToComposer,
  CHALLENGE_COMPOSER_PREFIX,
  composeChallengePrefill,
  DEFAULT_CHALLENGE_BODY,
  isChallengeComposerText,
  latestMainArtifactIdFromTurns,
  resolveChallengeSend,
} from "../challenge-composer";
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
const CHALLENGE_SRC = stripComments(readRel("../challenge-composer.ts"));
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
  const failAt = SESSION_SRC.indexOf("!persisted.ok", persistAt);
  expect(failAt, "persist 闸没有 !persisted.ok").toBeGreaterThan(persistAt);
  const afterFail = SESSION_SRC.slice(failAt);
  const returnRel = afterFail.search(/\breturn\b/);
  expect(returnRel, "persist 失败分支没有 return —— 删掉就会继续点火").toBeGreaterThan(
    -1
  );
  const returnAt = failAt + returnRel;
  const driveAt = SESSION_SRC.indexOf("driveFullViaPythonStream", returnAt);
  expect(
    driveAt,
    "找不到 persist 失败 return 之后的 driveFullViaPythonStream"
  ).toBeGreaterThan(returnAt);
  // 只取 persist 调用到失败 return：后面 onLlmDelta 里也有 return，吞进去会假绿。
  return SESSION_SRC.slice(persistAt, returnAt + "return".length);
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
    expect(CHALLENGE_SRC).not.toContain("window.prompt(");
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
    expect(block).toContain("persist: () => persistSession(preparedState)");
    expect(block).toMatch(/intent:\s*intervention\?\.intent/);
    expect(block).toMatch(/!persisted\.ok/);
    expect(block).toMatch(/\breturn\b/);
    expect(block).toContain("质疑未生效");
    // 反向：闸窗里不许已经点着 stream（失败 return 必须在点火前）
    expect(block).not.toContain("driveFullViaPythonStream");
    expect(block).not.toContain("/drive-full-stream");
    expect(block).not.toMatch(/fetch\s*\(/);
    expect(block).not.toContain("driveMarathon");
  });

  it("persist 闸 callback 必须是 persistSession(preparedState)，且 persistSession 走 saveSessionState", () => {
    const block = persistGateWindow();
    expect(block).toContain("persist: () => persistSession(preparedState)");
    expect(SESSION_SRC).toMatch(
      /async function persistSession[\s\S]{0,240}saveSessionState/
    );
    // 把 callback 改成 Promise.resolve() 而 persistSession 仍写在旁边，本条必须红
    expect(block).not.toContain("Promise.resolve()");
  });

  it("runTurn 夹具：saveSessionState reject + stub fetch → 零 POST /drive-full-stream", async () => {
    const posts: string[] = [];
    const saveSessionState = () => Promise.reject(new Error("disk full"));
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      posts.push(String(input));
      return new Response("{}", { status: 200 });
    });

    // 与 runTurn live path 同一段：persistPreparedStateForDrive → !ok → return，
    // 不得 fetch /drive-full-stream。helper catch 改回 ok:true 本条必须红。
    const persisted = await persistPreparedStateForDrive({
      persist: () => saveSessionState(),
      intent: "challenge",
    });
    if (!persisted.ok) {
      expect(posts).toEqual([]);
      expect(fetchStub).not.toHaveBeenCalled();
      return;
    }
    await fetchStub("/api/sliderule/drive-full-stream");
    expect(
      posts.filter(u => u.includes("/drive-full-stream")),
      "challenge persist 失败不得 POST /drive-full-stream"
    ).toEqual([]);
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
    expect(isChallengeComposerText("质疑:这段不对")).toBe(true);
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
    expect(DOCK_SRC).toContain('from "./challenge-composer"');
    expect(DOCK_SRC).not.toContain("export const CHALLENGE_COMPOSER_PREFIX");
  });

  it("session hook 从 challenge-composer 取预填，不进口重 ComposerDock", () => {
    expect(SESSION_SRC).toMatch(/from ["']\.\/challenge-composer["']/);
    expect(SESSION_SRC).not.toMatch(/from ["']\.\/ComposerDock["']/);
    expect(CHALLENGE_SRC).toContain("export const CHALLENGE_COMPOSER_PREFIX");
    expect(CHALLENGE_SRC).toContain("export function dispatchChallengePrefill");
    expect(CHALLENGE_SRC).toContain("export function isChallengeComposerText");
    expect(CHALLENGE_SRC).toContain("export function resolveChallengeSend");
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

  it("工程画布节点编辑也预填作曲家，不立刻 challengeTurn", () => {
    const body = fnBody(
      PAGE_SRC,
      "const handleNodeEditSubmit",
      "const handleResolveInteractiveGate"
    );
    expect(body).toContain("dispatchChallengePrefill");
    expect(body).not.toContain("challengeTurn(");
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

  it("sendMessage 意图只看文本，pending 只提供 targetArtifactId", () => {
    const body = fnBody(
      SESSION_SRC,
      "const sendMessage = async",
      "const repairGaps"
    );
    expect(body).toContain("resolveChallengeSend");
    expect(body).toContain("latestMainArtifactIdFromTurns");
    expect(body).toContain('intent: "challenge"');
    expect(body).toContain("runTurn");
    expect(body).toContain("pendingChallengeRef.current = null");
    expect(body).not.toMatch(/pending\s*\|\|/);
  });

  it("resetSession 清掉 leftover pendingChallengeRef", () => {
    const body = fnBody(
      SESSION_SRC,
      "const resetSession = useCallback",
      "const pendingClarifications"
    );
    expect(body).toContain("pendingChallengeRef.current = null");
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

describe("resolveChallengeSend：intent 看文本，pending 不能劫持", () => {
  it("dispatchChallengePrefill 之后发送非前缀文本不得带 intent challenge", () => {
    // leftover pending = 点质疑之后 listener 写下的 artifactId。
    const hijack = resolveChallengeSend({
      text: "做一个请假系统",
      pendingArtifactId: "art-leftover",
      latestMainArtifactId: "art-leftover",
    });
    expect(hijack.intent).toBeNull();

    const resendOriginal = resolveChallengeSend({
      text: "做一个宠物医院预约系统",
      pendingArtifactId: "art-leftover",
    });
    expect(resendOriginal.intent).toBeNull();

    const rewritten = resolveChallengeSend({
      text: "帮我加一个登录页",
      pendingArtifactId: "art-leftover",
    });
    expect(rewritten.intent).toBeNull();
  });

  it("前缀文本才是 challenge；pending 只填 target，空则回落最新 turn.main", () => {
    const withPending = resolveChallengeSend({
      text: "质疑：这段不对",
      pendingArtifactId: "art-1",
      latestMainArtifactId: "art-old",
    });
    expect(withPending).toEqual({
      intent: "challenge",
      targetArtifactId: "art-1",
    });

    const halfwidth = resolveChallengeSend({
      text: "质疑:依据不够",
      pendingArtifactId: null,
      latestMainArtifactId: "art-main",
    });
    expect(halfwidth).toEqual({
      intent: "challenge",
      targetArtifactId: "art-main",
    });

    const prefixOnly = resolveChallengeSend({
      text: "质疑：手打的",
      pendingArtifactId: null,
      latestMainArtifactId: latestMainArtifactIdFromTurns([
        { main: { artifactId: "older" } },
        { main: { artifactId: "latest-main" } },
      ]),
    });
    expect(prefixOnly).toEqual({
      intent: "challenge",
      targetArtifactId: "latest-main",
    });
  });
});
