/**
 * 控制流被关掉、还没见过收尾：回头问后台，还在跑就从断点接上——不许报「推演连接中断」。
 *
 * ⚠ 2026-10-10 线上 sr-20261010071235-QJPAENTX80（采购审批应用，执行那一轮 ctr-a521…）：页面在第三次
 *   `npm run build`（seq 86）之后报「推演连接中断，后台仍在进行」，库里那条 run 一直是 running、事件写到
 *   100 多条、执行锁按时续。断的只是页面这条流（sliderule-marathon-driver.stallAwareControlReader 头注）。
 *   事件的类型、工具、序号照那一轮 seq 79～99 的真实行；用户写的内容一律换成占位。
 *
 * 变异（逐条实测过）：读到 done 不回头问后台（直接交出去）→ 第一、二、四条红；
 *   不看「已经见过收尾」→ 第三条红（多问了后台；stall-resync 的反向那条也红）；
 *   后台查不到时不设上限 → 第四条超时红；主动停止也去重接 → 第五条红。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { consumeControlStreamResponse } from "../../../lib/sliderule-marathon-driver";

const RUN = "ctr-a521df99d76c544abf21c6507de6f18e";
const STATE = { sessionId: "sr-20261010071235-QJPAENTX80", goal: { text: "（占位）采购审批应用", status: "active" } };
const project = (seq: number, call: string) =>
  ({ type: "control_project_state", controlRunId: RUN, seq, toolCallId: call, projectId: "prj-1", projectRevision: `rev-${seq}`, runtimeKind: "project", sessionId: STATE.sessionId });
const shell = (seq: number, call: string, command: string) => [
  { type: "control_tool_start", controlRunId: RUN, seq, tool: "shell_exec", toolCallId: call, summary: command },
  { type: "control_tool_start", controlRunId: RUN, seq: seq + 1, tool: "shell_exec", toolCallId: call, summary: command, operationId: `pop-${seq}` },
  project(seq + 2, call),
  { type: "control_tool_result", controlRunId: RUN, seq: seq + 3, tool: "shell_exec", toolCallId: call, command, commandFinished: true,
    exitCode: 1, errorCode: "command_failed", excerpt: "（占位）", hint: "（占位）", cancelRequested: false },
];
const edit = (seq: number, tool: string, call: string) => [
  { type: "control_tool_start", controlRunId: RUN, seq, tool, toolCallId: call, summary: "src/main.tsx" },
  project(seq + 1, call),
  { type: "control_tool_result", controlRunId: RUN, seq: seq + 2, tool, toolCallId: call, ok: true, revision: `rev-${seq}` },
];
const BEFORE_BREAK = [...shell(79, "c79", "npm run check"), ...shell(83, "c83", "npm run build")];           // 页面最后看到 seq 86
const AFTER_BREAK = [
  { type: "control_text", controlRunId: RUN, seq: 87, text: "（占位）检查仍指向同一行，我直接搜索全部用法再替换。" },
  ...edit(88, "file_find_in_content", "c88"), ...edit(91, "file_str_replace", "c91"),
  ...edit(94, "file_read", "c94"), ...edit(97, "file_str_replace", "c97"),
];
const ENDING = [{ type: "complete", controlRunId: RUN, seq: 100, toolCallId: "c97", state: STATE }];
const frame = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

/** 吐完这些就关掉、不带收尾的流——页面那条。 */
function closedAfter(events: unknown[]): Response {
  return new Response(frame({ type: "control_run_started", controlRunId: RUN }) + events.map(frame).join(""),
    { headers: { "Content-Type": "text/event-stream", "X-Control-Run-Id": RUN } });
}

afterEach(() => vi.unstubAllGlobals());

function stubBackend(run: () => { status: string; lastSeq: number } | null, rest: unknown[]) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked.push(url);
    if (url.endsWith(`/control-runs/${RUN}`)) {
      const now = run();
      if (!now) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ runId: RUN, ...now }));
    }
    const after = Number(new URL(url, "http://x").searchParams.get("afterSeq"));
    const events = rest.filter(e => (e as { seq: number }).seq > after);
    return new Response(frame({ type: "control_run_started", controlRunId: RUN }) + events.map(frame).join("")
      + frame({ type: "control_run_settled", controlRunId: RUN, status: "completed", error: null, lastSeq: 100 }));
  }));
  return asked;
}

const opts = (extra: object = {}) => ({ controlStallMs: 60_000, controlClosedRetryMs: 5, ...extra }) as any;

describe("控制流被关掉时回头对一下后台", () => {
  it("线上那一轮：流在 seq 86 被关、后台还在跑 → 从 86 接上，后面的话和收尾都收到，不报中断", async () => {
    const asked = stubBackend(() => ({ status: "running", lastSeq: 99 }), [...AFTER_BREAK, ...ENDING]);
    const texts: string[] = [];
    const out = await consumeControlStreamResponse(closedAfter(BEFORE_BREAK), opts({ onControlText: (t: string) => texts.push(t) }));
    expect(asked).toContain(`/api/sliderule/control-runs/${RUN}/stream?afterSeq=86`);
    expect(texts.join("")).toContain("直接搜索全部用法");
    expect(out?.finalState?.sessionId).toBe(STATE.sessionId);
  }, 3000);

  it("后台一时没新事件、接上的流又被关：后台还活着就接着等着接，直到拿到收尾", async () => {
    let calls = 0;
    // 前两次接上时后台还在跑那条长命令，一条新事件都没有；第三次才写出后面的事件和收尾
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      if (url.endsWith(`/control-runs/${RUN}`)) return new Response(JSON.stringify({ runId: RUN, status: "running", lastSeq: 86 }));
      calls += 1;
      const tail = calls < 3 ? "" : [...AFTER_BREAK, ...ENDING].map(frame).join("")
        + frame({ type: "control_run_settled", controlRunId: RUN, status: "completed", error: null, lastSeq: 100 });
      return new Response(frame({ type: "control_run_started", controlRunId: RUN }) + tail);
    }));
    const out = await consumeControlStreamResponse(closedAfter(BEFORE_BREAK), opts());
    expect(calls).toBe(3);
    expect(out?.finalState?.sessionId).toBe(STATE.sessionId);
  }, 3000);

  it("反向：已经收到 complete 之后流才关——那是正常结束，不再去问后台", async () => {
    const asked = stubBackend(() => ({ status: "completed", lastSeq: 100 }), []);
    const out = await consumeControlStreamResponse(closedAfter([...BEFORE_BREAK, ...AFTER_BREAK, ...ENDING]), opts());
    expect(out?.finalState?.sessionId).toBe(STATE.sessionId);
    expect(asked).toEqual([]);
  }, 3000);

  it("反向：后台也查不到（网络整个断了）——试几次就如实交出去，不无限等", async () => {
    const asked = stubBackend(() => null, []);
    const out = await consumeControlStreamResponse(closedAfter(BEFORE_BREAK), opts());
    expect(out).toBeNull();
    expect(asked.filter(u => u.endsWith(`/control-runs/${RUN}`)).length).toBe(4);
    expect(asked.some(u => u.includes("/stream"))).toBe(false);
  }, 3000);

  it("反向：用户点了停止——不重接", async () => {
    const asked = stubBackend(() => ({ status: "running", lastSeq: 99 }), [...AFTER_BREAK, ...ENDING]);
    const stop = new AbortController();
    stop.abort();
    await consumeControlStreamResponse(closedAfter(BEFORE_BREAK), opts({ stopSignal: stop.signal }));
    expect(asked.some(u => u.includes("/stream"))).toBe(false);
  }, 3000);
});
