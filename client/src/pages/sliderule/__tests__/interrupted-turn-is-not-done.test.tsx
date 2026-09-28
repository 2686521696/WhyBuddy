// @vitest-environment jsdom
/**
 * 被错误打断的一轮，结果卡不许画「✓ 任务已完成」。
 *
 * ⚠ 2026-09-28 隔离真机第 98 轮 sr-20260928102234-1H36JF36XP（社区超市月度经营分析 Excel）：
 *   模型改完脚本、重新生成了一版、正在核验（待办 3/4）时服务商网关 502；run 记为 failed，
 *   会话停在 awaitReason=error。卡片却画「✓ 任务已完成 5m 30s」，下面紧挨着「推演中断：LLM
 *   服务商网关 502……本轮工程任务已停止」。办公文件的卡只看产物库里有没有——停之前写出过一版就算。
 *
 * 夹具是那次 control run 的原样事件（去掉末尾带整份 state 的 complete），经真 hook 回放，
 * 最后一发 complete 的 state 照真机停在 awaitReason=error。
 * 把 resultCardModel 里 interrupted 那支删掉，第一条变红；
 * 把 SlideRule.tsx 里 stoppedByError / stoppedTurnId 的接线拿掉，最后一条变红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialSessionState } from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { resultCardModel } from "../turn-result-card";
import { TurnResultCard } from "../TurnResultCard";
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

const EVENTS: Array<Record<string, unknown>> = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures", "round98-interrupted-events.json"), "utf8")
);
const SID = "interrupted-turn-is-not-done";
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
  saved = createInitialSessionState("社区超市月度经营分析 Excel", SID);
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

async function replayInterrupted() {
  await act(async () => { root.render(<Harness />); });
  await expect.poll(() => current.sessionHydrated).toBe(true);
  let running: Promise<void> | undefined;
  await act(async () => {
    running = current.sendMessage("批准计划并执行");
    await vi.waitFor(() => expect(stream).toBeDefined());
  });
  // 真机收尾：complete 带着停在 error 的会话
  const stopped = { ...saved, awaitReason: "error", awaitDetail: "llm_unavailable" } as V5SessionState;
  await act(async () => {
    for (const e of EVENTS) stream!.enqueue(encode(e));
    stream!.enqueue(encode({ type: "complete", state: stopped }));
    stream!.close();
    await running;
  });
  return current.uiTurns.at(-1)!;
}

const officeCard = (turn: Parameters<typeof resultCardModel>[0], interrupted?: boolean) =>
  resultCardModel(turn, {
    runtimeKind: "project",
    projectRevision: "prv-67c6566be9744e69a9012861fd498af2",
    deliverableKind: "office-file",
    hasOfficeArtifact: true,
    interrupted,
  });

describe("第 98 轮：核验到一半网关 502", () => {
  it("被打断的那张卡说「中途停了」，不是「任务已完成」", async () => {
    const turn = await replayInterrupted();
    expect(officeCard(turn, true)?.status).toBe("interrupted");
  });

  it("反向：不告诉它被打断，这一轮就会被画成完成——所以打断必须传到它身上", async () => {
    const turn = await replayInterrupted();
    expect(officeCard(turn)?.status).toBe("done");
  });

  it("真 hook 回放后，会话确实停在 error（SlideRule 读的就是它）", async () => {
    await replayInterrupted();
    expect(current.sessionState.awaitReason).toBe("error");
  });

  it("画出来的是那句实话，没有绿勾", async () => {
    const turn = await replayInterrupted();
    await act(async () => {
      root.render(
        <TurnResultCard turn={turn} runtimeKind="project" projectRevision="prv-67c6566be9744e69a9012861fd498af2"
          deliverableKind="office-file" hasOfficeArtifact interrupted />
      );
    });
    expect(container.textContent).toContain("中途停了");
    expect(container.textContent).not.toContain("任务已完成");
  });

  it("SlideRule 把会话的 error 接到最新一轮的卡上", () => {
    const source = readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).toMatch(/stoppedByError=\{sessionState\.awaitReason === "error"\}/);
    expect(source).toMatch(/stoppedTurnId: stoppedByError && !isRunning \? latestTurn\?\.id/);
    expect(source).toMatch(/interrupted=\{Boolean\(ctx\.stoppedTurnId\) && turn\.id === ctx\.stoppedTurnId\}/);
  });
});
