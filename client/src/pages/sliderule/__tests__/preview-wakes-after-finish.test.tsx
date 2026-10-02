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
 *   去掉「人没钉别的档」→ 第四条红；叫过不收回（不 setFinishedWhileWatching(false)）→ 第一、五条红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import { dispatchFollowComputer } from "../project-computer-view";
import type { TurnStep, UiTurn } from "../types";

const ROUND184_TAIL = [
  "project_create", "file_write", "project_exec", "project_status", "project_start",
  "project_verify", "project_status", "browser_navigate", "browser_view",
  "file_str_replace", "project_exec", "project_status", "browser_navigate",
  "browser_view", "project_verify", "project_status",
];
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

async function mount(turns: UiTurn[], isRunning: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (/\/preview$/.test(url)) return json(STOPPED);
    return json({});
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render(turns, isRunning);
  await settle();
}

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
});
