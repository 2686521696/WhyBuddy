/**
 * 控制流开着却不再来数据：回头问一次后台，落后了就从断点接上——不许永远停在「正在加载技能」。
 *
 * ⚠ 2026-10-08 用户本机 sr-20261008061932-ZTM3RR7M5X（@ui-ux-pro-max @office-skills 采购审批应用方案）：后台 4 分钟跑完
 *   （lastSeq 9，waiting_user），前端停在 seq 5「正在加载技能 doc-coauthoring」，「已等待 92 分 6 秒」
 *   （sliderule-marathon-driver.stallAwareControlReader 头注）。事件的类型、顺序、字段照那一轮的真实行（内容换成占位）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { consumeControlStreamResponse } from "../../../lib/sliderule-marathon-driver";

const RUN = "ctr-2ff2cc5ed6c05f1c96d38ffe27a5089f";
const STATE = { sessionId: "sr-20261008061932-ZTM3RR7M5X", goal: { text: "采购审批应用方案", status: "clear" } };
const skill = (seq: number, name: string) => [
  { type: "control_tool_start", controlRunId: RUN, seq, tool: "skill", toolCallId: `c${seq}`, summary: name },
  { type: "control_tool_result", controlRunId: RUN, seq: seq + 1, tool: "skill", toolCallId: `c${seq}`, ok: true, skill: name, skill_message: "…", seedBytes: 1 },
];
const EVENTS = [
  ...skill(1, "ui-ux-pro-max"), ...skill(3, "office-skills"), ...skill(5, "doc-coauthoring"),
  { type: "control_text", controlRunId: RUN, seq: 7, text: "我会先把交付形态、业务边界和权限规则问清楚。" },
  { type: "control_ask_user", controlRunId: RUN, seq: 8, reqId: "q1", toolCallId: "c8", question: "交付形态？", questions: [], options: [] },
  { type: "complete", controlRunId: RUN, seq: 9, toolCallId: "c8", state: STATE },
];
const frame = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

/** 吐完前几条就挂住、永不关闭的流——截图里那条连接。 */
function hangingAfter(events: unknown[], later?: Promise<unknown[]>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(frame({ type: "control_run_started", controlRunId: RUN }) + events.map(frame).join("")));
      later?.then(rest => { controller.enqueue(enc.encode(rest.map(frame).join(""))); controller.close(); });
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "X-Control-Run-Id": RUN } });
}

afterEach(() => vi.unstubAllGlobals());

function stubBackend(run: { status: string; lastSeq: number }) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked.push(url);
    if (url.endsWith(`/control-runs/${RUN}`)) return new Response(JSON.stringify({ runId: RUN, ...run }));
    const after = Number(new URL(url, "http://x").searchParams.get("afterSeq"));
    const rest = EVENTS.filter(e => e.seq > after);
    return new Response(frame({ type: "control_run_started", controlRunId: RUN }) + rest.map(frame).join("")
      + frame({ type: "control_run_settled", controlRunId: RUN, status: run.status, error: null, lastSeq: 9 }));
  }));
  return asked;
}

describe("控制流不说话时回头对一下后台", () => {
  it("r 那一轮：后台已经 waiting_user / lastSeq 9，前端停在 seq 5 → 从 5 接上，收齐问题卡和收尾", async () => {
    const asked = stubBackend({ status: "waiting_user", lastSeq: 9 });
    const texts: string[] = [];
    const out = await consumeControlStreamResponse(hangingAfter(EVENTS.slice(0, 5)), {
      controlStallMs: 20, onControlText: (t: string) => texts.push(t),
    } as any);
    expect(out?.finalState?.sessionId).toBe(STATE.sessionId);
    expect(asked).toContain(`/api/sliderule/control-runs/${RUN}/stream?afterSeq=5`);
    expect(texts.join("")).toContain("业务边界");
  }, 3000);

  it("反向：后台还在跑、事件也没比我们多——安静不是卡住，不重连，等原来的流", async () => {
    const asked = stubBackend({ status: "running", lastSeq: 5 });
    let release!: (v: unknown[]) => void;
    const later = new Promise<unknown[]>(r => { release = r; });
    const pending = consumeControlStreamResponse(hangingAfter(EVENTS.slice(0, 5), later), { controlStallMs: 20 } as any);
    await new Promise(r => setTimeout(r, 120));                     // 问过几次后台，都说「还在跑」
    release(EVENTS.slice(5));
    const out = await pending;
    expect(out?.finalState?.sessionId).toBe(STATE.sessionId);
    expect(asked.some(u => u.includes("/stream"))).toBe(false);
    expect(asked.length).toBeGreaterThan(0);
  }, 3000);
});
