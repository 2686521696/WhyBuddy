// @vitest-environment jsdom
/**
 * 宿主交付判定挂在「工程此刻」出自的那一轮，不是最新一轮。
 *
 * ⚠ 2026-09-28 隔离真机第 80 轮 sr-20260928014044-76AFAFC2M1（读书打卡网页，追问「用
 *   webapp-testing 技能把新增、勾选完成、删除这几步真的点一遍测一下」）：首轮收尾时卡上是
 *   「验收没能在这个环境里跑起来」。追问一行代码没改（跑命令、停进程、重启浏览器），不出卡；
 *   判定按最新一轮挂，落在追问上，首轮那张卡拿到 delivered=undefined，翻成绿勾「任务已完成」。
 *   服务端同一时刻落的是 goal_not_delivered（「这一轮还没有达到可交付」），截图里两句挨着。
 *
 * 夹具是那两次 control run 的原样事件（去掉末尾带整份 state 的 complete），经真 hook 回放。
 * 把 SlideRule.tsx 里 verdictTurnId 换回 latestTurnId，最后一条变红；
 * 把 latestDeliveringTurnId 改成「最后一轮」，第一条变红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialSessionState } from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { latestDeliveringTurnId, resultCardModel } from "../turn-result-card";
import { useSlideRuleSession } from "../useSlideRuleSession";

vi.hoisted(async () => {
  const web = await import("node:stream/web");
  const g = globalThis as Record<string, unknown>;
  g.TransformStream ??= web.TransformStream;
  g.WritableStream ??= web.WritableStream;
});

vi.mock("@/lib/use-auth", () => ({ useAuth: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/sliderule-narrator", () => ({
  fetchNarration: async () => ({ text: "", source: "fallback" }),
}));
vi.mock("@/pages/agent-loop/dashboard/SidebarSessions", () => ({
  notifySessionsUpdated: vi.fn(),
}));

const load = (name: string): Array<Record<string, unknown>> =>
  JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf8"));
const BUILD = load("round80-build-events.json");
const FOLLOWUP = load("round80-followup-events.json");
// 第 80 轮追问收尾时 /delivery 给的判定形状
const VERDICT = { eligible: false, blockedReasons: ["project_verification_environment_blocked"] };

const SID = "verdict-follows-the-delivering-turn";
let current: ReturnType<typeof useSlideRuleSession>;
let root: Root;
let container: HTMLDivElement;
let saved: V5SessionState;
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;

function Harness() {
  current = useSlideRuleSession({ sessionId: SID });
  return null;
}

const encode = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ReadableStream", NodeReadableStream);
  localStorage.clear();
  saved = createInitialSessionState("读书打卡网页", SID);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/sessions/${SID}`)) {
        return init?.method === "PUT" ? Response.json({ ok: true }) : Response.json({ state: saved, backend: "python" });
      }
      if (url.includes("/runs/active?")) return Response.json({ active: null });
      if (url.endsWith("/control-turn-stream")) {
        return new Response(new ReadableStream({ start(c) { stream = c; } }));
      }
      return Response.json({});
    })
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function replay(text: string, events: Array<Record<string, unknown>>) {
  let running: Promise<void> | undefined;
  stream = undefined;
  await act(async () => {
    running = current.sendMessage(text);
    await vi.waitFor(() => expect(stream).toBeDefined());
  });
  await act(async () => {
    for (const e of events) stream!.enqueue(encode(e));
    stream!.enqueue(encode({ type: "complete", state: saved }));
    stream!.close();
    await running;
  });
}

async function bothTurns() {
  await act(async () => { root.render(<Harness />); });
  await expect.poll(() => current.sessionHydrated).toBe(true);
  await replay("批准计划并执行", BUILD);
  await replay("用 webapp-testing 技能把新增、勾选完成、删除这几步真的点一遍测一下", FOLLOWUP);
  const turns = current.uiTurns;
  const build = turns.find(t => t.user === "批准计划并执行")!;
  const followup = turns.at(-1)!;
  expect(build && followup && build.id !== followup.id).toBe(true);
  return { turns, build, followup };
}

const card = (turn: Parameters<typeof resultCardModel>[0], verdict?: typeof VERDICT) =>
  resultCardModel(turn, {
    runtimeKind: "project",
    projectRevision: "prv-round80",
    delivered: verdict ? verdict.eligible : undefined,
    deliveryBlockedReasons: verdict ? verdict.blockedReasons : undefined,
  });

describe("第 80 轮：追问没改代码", () => {
  it("判定挂在首轮（工程出自它），不是追问", async () => {
    const { turns, build, followup } = await bothTurns();
    expect(latestDeliveringTurnId(turns, "web-app")).toBe(build.id);
    expect(latestDeliveringTurnId(turns, "web-app")).not.toBe(followup.id);
  });

  it("首轮那张卡照判定说「没能在这个环境里跑起来」，追问不出卡", async () => {
    const { build, followup } = await bothTurns();
    const model = card(build, VERDICT);
    expect(model?.status).toBe("undelivered");
    expect(model?.undeliveredWhy).toBe("environment");
    expect(card(followup, VERDICT)).toBeNull();
  });

  it("反向：拿不到判定的那张卡就是会说「任务已完成」——所以判定必须落在它身上", async () => {
    const { build } = await bothTurns();
    expect(card(build)?.status).toBe("done");
  });

  it("SlideRule 把判定和截图按 verdictTurnId 挂，不按 latestTurnId", () => {
    const source = readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).toMatch(/delivered=\{\s*turn\.id === ctx\.verdictTurnId/);
    expect(source).toMatch(/deliveryBlockedReasons=\{\s*turn\.id === ctx\.verdictTurnId/);
    expect(source).toMatch(/thumbnailUrl=\{\s*turn\.id === ctx\.verdictTurnId/);
    expect(source).toMatch(/verdictTurnId: latestDeliveringTurnId\(uiTurns, deliverableKind\)/);
  });
});
