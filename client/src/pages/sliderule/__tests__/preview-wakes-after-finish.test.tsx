// @vitest-environment jsdom
/**
 * 一轮在眼前跑完、这一轮起过 / 验过应用：右侧预览自己醒一次，不让人再点。
 *
 * ⚠ 2026-10-02 用户截图：左栏「独立验收通过」、结果卡已有缩略图，右侧却是「预览已暂停，点击以唤醒」。
 *   动作序列照隔离真机第 184 轮（记账小网页）原样的尾巴：…project_start → project_verify →
 *   browser_navigate → browser_view → project_verify → project_status。队尾是 project_status（轮询，
 *   不在预览家族），跑完 live=false，shouldAutoWakePreview / shouldAutoOpenPreview 两条都不成立。
 *
 * 走真 SandboxPreviewSurface + 真 useProjectPreview，只把 HTTP 换桩，数 POST /preview/wake。
 * 变异（逐条实测过）：删掉 SandboxPreviewSurface 里叫醒那一句 → 第一、五条红；
 *   去掉 finishedWhileWatching 条件 → 全红；去掉 turnUsedPreview → 第三条红；
 *   去掉「人没钉别的档」→ 第四条红；叫过不收回（不 setFinishedWhileWatching(false)）→ 第一、五条红；
 *   跑完后那一小段不收旗（WAKE_AFTER_FINISH_WINDOW_MS 的 timer 不做事）→ 最后一条红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SandboxPreviewSurface, WAKE_AFTER_FINISH_WINDOW_MS } from "../project-runtime/SandboxPreviewSurface";
import { dispatchFollowComputer } from "../project-computer-view";
import type { TurnStep, UiTurn } from "../types";

const ROUND184_TAIL = [
  "project_create", "file_write", "project_exec", "project_status", "project_start",
  "project_verify", "project_status", "browser_navigate", "browser_view",
  "file_str_replace", "project_exec", "project_status", "browser_navigate",
  "browser_view", "project_verify", "project_status",
];
// 第 192 轮跑着、正在 browser_navigate 那一刻的队尾（跑完以后又补了 browser_view / project_verify / project_status）
const ROUND192_WHILE_NAVIGATING = ROUND184_TAIL.slice(0, ROUND184_TAIL.lastIndexOf("browser_navigate") + 1);
const ANSWER_ONLY = ["project_read", "file_read"];

function turnOf(tools: string[]): UiTurn {
  return {
    id: "t1",
    user: "做一个记账小网页",
    status: "complete",
    steps: tools.map(
      (tool, i) =>
        ({
          id: `s${i}`,
          kind: "chip",
          capabilityId: tool,
          progressType: "completed",
          roleId: "system",
          label: tool,
          realLlm: false,
        }) as unknown as TurnStep
    ),
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "llm",
    main: null,
    actions: [],
  };
}

function liveTurnOf(tools: string[]): UiTurn {
  // 最后一件还在跑（acting）：跟第 192 轮跑着时 browser_navigate 那一刻同形
  const turn = turnOf(tools);
  const last = turn.steps.at(-1) as unknown as { progressType: string };
  last.progressType = "acting";
  return { ...turn, status: "streaming" };
}

const calls: string[] = [];
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  calls.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
async function settle() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
}
// 验收跑完、运行时停着：跟截图里「已暂停」那一面同一个状态
const STOPPED = {
  available: false,
  operationId: null,
  descriptor: { kind: "project", projectId: "p1", runtimeId: "rt1", revision: "rev1", status: "stopped" },
};

function render(turns: UiTurn[], isRunning: boolean) {
  return act(async () => {
    root!.render(
      <SandboxPreviewSurface projectId="p1" revisionMode="current" sessionId="sr-1" turns={turns} isRunning={isRunning} />
    );
  });
}

// 运行时起着、能换票：第 192 轮跑完那一刻的样子
const READY = {
  available: true,
  operationId: "pop-1",
  descriptor: { kind: "project", projectId: "p1", runtimeId: "rt1", revision: "rev1", status: "ready" },
};
const TICKET = {
  operationId: "pop-1", projectId: "p1", runtimeId: "rt1", revision: "rev1",
  entryUrl: "https://rt-pop-1.preview.example.test/",
  ticketExpiresAt: "2099-01-01T00:00:00Z", accessExpiresAt: "2099-01-01T00:00:00Z",
};
let snapshot: unknown = STOPPED;

async function mount(turns: UiTurn[], isRunning: boolean, first: unknown = STOPPED) {
  snapshot = first;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (/\/preview$/.test(url)) return json(snapshot);
    if (url.endsWith("/preview-ticket")) return json(TICKET);
    return json({});
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render(turns, isRunning);
  await settle();
}

const tickets = () => calls.filter(c => c.startsWith("POST") && c.endsWith("/preview-ticket")).length;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const wakes = () => calls.filter(c => c.startsWith("POST") && c.endsWith("/preview/wake")).length;

describe("一轮在眼前跑完，预览自己醒一次", () => {
  it("第 184 轮那条尾巴：跑着 → 跑完，叫醒一次", async () => {
    const turns = [turnOf(ROUND184_TAIL)];
    await mount(turns, true);
    expect(wakes()).toBe(0);
    await render(turns, false);
    await settle();
    expect(wakes()).toBe(1);
  });

  it("反向：打开一个早就跑完的会话，不许把沙箱拉起来", async () => {
    await mount([turnOf(ROUND184_TAIL)], false);
    expect(wakes()).toBe(0);
  });

  it("反向：这一轮没碰过预览工具（只读了文件、答了一句），跑完也不醒", async () => {
    const turns = [turnOf(ANSWER_ONLY)];
    await mount(turns, true);
    await render(turns, false);
    await settle();
    expect(wakes()).toBe(0);
  });

  it("反向：人自己钉在终端档，跑完不替他拉沙箱", async () => {
    const turns = [turnOf(ROUND184_TAIL)];
    await mount(turns, true);
    await act(async () => dispatchFollowComputer()); // 左栏「跳到实时」= 钉在终端
    await render(turns, false);
    await settle();
    expect(wakes()).toBe(0);
  });

  it("只叫一次：叫过之后再重画，不再发第二次", async () => {
    const turns = [turnOf(ROUND184_TAIL)];
    await mount(turns, true);
    await render(turns, false);
    await settle();
    await render([...turns], false);
    await settle();
    expect(wakes()).toBe(1);
  });

  it("第 192 轮：跑完那一刻票还在、不用醒；紧接着票掉了（运行时停了）→ 醒一次", async () => {
    vi.useFakeTimers();
    await mount([liveTurnOf(ROUND192_WHILE_NAVIGATING)], true, READY);
    expect(tickets()).toBe(1); // 跑着时 browser 家族那件工具已经换过票
    // 刚挂上、快照还没回来时，跑着的那条规则会先叫一次——那是原有行为，这里只数跑完以后的
    const before = wakes();
    await render([turnOf(ROUND184_TAIL)], false);
    await settle();
    expect(wakes()).toBe(before);
    snapshot = STOPPED;
    await advance(5_000); // 下一次轮询把票刷掉
    await settle();
    expect(wakes()).toBe(before + 1);
  });

  it("反向：跑完后票一直在，过了这一小段才掉（比如一小时后过期），不再替人拉沙箱", async () => {
    vi.useFakeTimers();
    await mount([liveTurnOf(ROUND192_WHILE_NAVIGATING)], true, READY);
    const before = wakes();
    await render([turnOf(ROUND184_TAIL)], false);
    await settle();
    await advance(WAKE_AFTER_FINISH_WINDOW_MS + 1_000);
    expect(tickets()).toBe(1); // 这一段里票一直在
    snapshot = STOPPED;
    await advance(5_000);
    await settle();
    expect(wakes()).toBe(before);
  });
});
