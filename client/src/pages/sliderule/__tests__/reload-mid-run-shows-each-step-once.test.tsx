// @vitest-environment jsdom
/**
 * 跑着（或问卷挂着）时刷新页面：左栏每一段话、每一枚技能芯片只出现一次。
 *
 * ⚠ 2026-10-10 用户（sr-20261010045052-CEJE3FR66F）：刷新后「我先按 Word 方案的交付要求确认文档结构…」
 *   +「加载技能 2 次 office-skills / doc-coauthoring」整段出现两遍；库里那段只有一份。
 *   成因：最后一轮先从持久化状态（host 日志 / 叙述）灌回左栏，续播再把同一条 run 的事件日志从第 0 条
 *   补播进同一轮。隔离真机第 193 轮复现了两种时机——问卷挂着刷新（run 停在 waiting_user、书签还在）
 *   →「加载技能 4 次」；答完问卷、续跑中刷新 → 开场白两条。
 *
 * 走真 useSlideRuleSession + 真 deriveTurnsFromState + 真续播解析，只把 HTTP 换桩。
 * 会话日志、叙述、两条 run 的事件日志都是第 193 轮本地库原样导出（fixtures/round193-reload-mid-run.json）。
 *
 * 变异（逐条实测过）：续播不带 replaysLastTurn（effect 里不调 runStartedLastTurn）→ 第一、二条红；
 *   appendStep 不让位（照旧往后接）→ 第一、二条红；runStartedLastTurn 恒真 → 第三条红；
 *   让位不等第一条补播、一进续播就清空 → 第四条红。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSessionState } from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { useSlideRuleSession } from "../useSlideRuleSession";
import { saveActiveRun } from "../active-run-store";
import type { UiTurn } from "../types";
import round193 from "./fixtures/round193-reload-mid-run.json";

const authentication = vi.hoisted(() => ({ ready: true, user: { id: "iso-admin" } }));
vi.mock("@/lib/use-auth", () => ({ useAuth: () => ({ refresh: vi.fn(), ...authentication }) }));
vi.mock("@/lib/sliderule-narrator", () => ({
  fetchNarration: async () => ({ text: "", source: "fallback" }),
}));
vi.mock("@/pages/agent-loop/dashboard/SidebarSessions", () => ({ notifySessionsUpdated: vi.fn() }));

type Run = { runId: string; createdAt: string; status: string; events: Array<Record<string, unknown>> };
const SID = round193.sessionId;
const QUESTIONNAIRE_RUN = round193.questionnaireRun as Run;
const ANSWER_RUN = round193.answerRun as Run;
const PLANNING = String(QUESTIONNAIRE_RUN.events.find(e => e.type === "control_text")!.text);
const ANSWER_OPENING = String(ANSWER_RUN.events.find(e => e.type === "control_text")!.text);
const STYLE_ALIGNED = String(ANSWER_RUN.events.filter(e => e.type === "control_text").at(-1)!.text);

function stateWith(rows: number): V5SessionState {
  return {
    ...createInitialSessionState(String(round193.goal?.text || ""), SID),
    goal: round193.goal as V5SessionState["goal"],
    controlTranscript: round193.transcript.slice(0, rows) as V5SessionState["controlTranscript"],
    // 叙述只写到问卷那一轮：答完问卷那一轮还没收尾，客户端还没写它的叙述
    turnNarrations: [round193.firstNarration] as V5SessionState["turnNarrations"],
  };
}

let current: ReturnType<typeof useSlideRuleSession>;
let root: Root;
let container: HTMLDivElement;
let saved: V5SessionState;
let latest: Run;
let replay: ReadableStreamDefaultController<Uint8Array> | undefined;
let replayRequested: () => void;
let replayed: Promise<void>;
const sse = (event: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

function Harness() {
  current = useSlideRuleSession({ sessionId: SID });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ReadableStream", NodeReadableStream);
  localStorage.clear();
  replay = undefined;
  replayed = new Promise(resolve => { replayRequested = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/control-runs/latest?")) {
      const { events: _events, ...run } = latest;
      return Response.json({ run: { ...run, sessionId: SID, lastSeq: latest.events.length } });
    }
    if (url.endsWith(`/control-runs/${latest.runId}/stream`)) {
      return new Response(new ReadableStream({
        start(controller) {
          replay = controller;
          for (const event of latest.events) {
            controller.enqueue(sse(event.type === "complete" ? { ...event, state: saved } : event));
          }
          replayRequested();
        },
      }));
    }
    if (/\/sessions\/[^/?]+$/.test(url)) {
      if (init?.method === "PUT") return Response.json({ ok: true });
      return Response.json({ state: saved, backend: "python" });
    }
    if (url.includes("/runs/active?")) return Response.json({ active: null });
    return Response.json({ detail: "not_found" }, { status: 404 });
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  // 还在跑的那条：补上它真实的收尾（第 193 轮答问卷那条最后停在 waiting_user），让续播正常落定
  if (replay) {
    await act(async () => {
      replay!.enqueue(sse({ type: "complete", state: saved }));
      replay!.enqueue(sse({ type: "control_run_settled", status: "waiting_user" }));
      replay!.close();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function reloadPage() {
  await act(async () => { root.render(<Harness />); });
  await expect.poll(() => current.sessionHydrated).toBe(true);
  await act(async () => { await replayed; });
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

const speeches = (turns: UiTurn[], text: string) =>
  turns.flatMap(turn => turn.steps).filter(step => step.kind === "model_speech" && step.text === text).length;
const skillChips = (turn: UiTurn | undefined) =>
  (turn?.steps || []).filter(step => step.kind === "chip" && String(step.capabilityId) === "skill").length;

describe("刷新后续播：同一条 run 的东西只出现一次", () => {
  it("问卷挂着时刷新（run 停在 waiting_user、书签还在）：开场白一条、技能芯片跟原来一样多", async () => {
    saved = stateWith(round193.askRowsEnd);
    latest = QUESTIONNAIRE_RUN;
    saveActiveRun(SID, { runId: latest.runId, kind: "control", userText: "", startedAt: latest.createdAt });
    await reloadPage();
    expect(speeches(current.uiTurns, PLANNING)).toBe(1);
    // 原来那一轮（叙述里）是 2 个技能各一开一收 = 4 枚；补播又接 4 枚就是用户看到的「加载技能 4 次」
    expect(skillChips(current.uiTurns.at(-1))).toBe(
      round193.firstNarration.steps.filter(step => step.capabilityId === "skill").length
    );
  });

  it("答完问卷、续跑中刷新：这一轮的开场白和第二段话各一条，上一轮的规划段也还在且只一条", async () => {
    saved = stateWith(round193.transcript.length);
    latest = ANSWER_RUN;
    await reloadPage();
    expect(current.isRunning).toBe(true);
    expect(speeches(current.uiTurns, ANSWER_OPENING)).toBe(1);
    expect(speeches(current.uiTurns, STYLE_ALIGNED)).toBe(1);
    expect(speeches(current.uiTurns, PLANNING)).toBe(1);
  });

  it("反向：run 还在排队、自己那行用户话没写进日志——上一轮的步骤不许被当成它的清掉", async () => {
    // 日志只到问卷那一行（user_answer 还没写），而答问卷那条 run 已经建起来了
    saved = stateWith(round193.askRowsEnd);
    latest = ANSWER_RUN;
    await reloadPage();
    expect(speeches(current.uiTurns, PLANNING)).toBe(1);
    expect(speeches(current.uiTurns, ANSWER_OPENING)).toBe(1);
    expect(skillChips(current.uiTurns[0])).toBeGreaterThanOrEqual(4);
  });

  it("反向：补播一条都没拉到（流开了但还没来数据），灌回来的那一轮原样留着", async () => {
    saved = stateWith(round193.transcript.length);
    latest = { ...ANSWER_RUN, events: [] };
    await reloadPage();
    expect(speeches(current.uiTurns, ANSWER_OPENING)).toBe(1);
    expect(speeches(current.uiTurns, STYLE_ALIGNED)).toBe(1);
  });
});
