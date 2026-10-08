// @vitest-environment jsdom
/**
 * 预览里应用自己抛的错 → 预览面板上一条提示 →「让 Agent 修复」把原话发进对话（bolt.diy 的 Ask Bolt）。
 *
 * 走真 SandboxPreviewSurface + 真取票流程，消息从框里发出来（跟 shared/project-preview-selection.mjs 发的同形）。
 * 页面那一侧的消息是生成的应用发的：来源、版本、通道不对的一律不认；发给 Agent 的话里不带预览主机。
 */
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import { previewRuntimeError } from "../project-runtime/preview-selection-bridge";
import { previewErrorPrompt, withoutPreviewHost } from "../project-runtime/preview-runtime-errors";

const ORIGIN = "https://preview.example";
const CRASH = {
  kind: "uncaught_exception",
  message: "Cannot read properties of undefined (reading 'map')",
  stack: `TypeError: Cannot read properties of undefined (reading 'map')\n    at BudgetList (${ORIGIN}/src/App.tsx?t=1791442119:12:23)`,
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(crypto, "randomUUID").mockReturnValue("channel-1" as `${string}-${string}-${string}-${string}-${string}`);
  const snapshot = {
    operationId: "operation-one", available: true, reason: null,
    descriptor: { kind: "project", projectId: "project-one", runtimeId: "runtime-one", revision: "revision-one",
      status: "ready", entryUrl: null, expiresAt: null, capabilities: [] },
  };
  const ticket = {
    projectId: "project-one", operationId: "operation-one", runtimeId: "runtime-one", revision: "revision-one",
    entryUrl: `${ORIGIN}/entry?ticket=one-use`,
    ticketExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json(init?.method === "POST" ? ticket : snapshot)));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openPreview(props: { onAskAgent?: (text: string) => void; isRunning?: boolean }) {
  await act(async () => {
    root.render(<SandboxPreviewSurface projectId="project-one" projectRevision="revision-one" appTitle="月度预算" {...props} />);
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="project-preview-open"]')!.click();
  });
  await act(async () => {
    container.querySelector("iframe")!.dispatchEvent(new Event("load"));
  });
}

function fromFrame(data: Record<string, unknown>, origin = ORIGIN) {
  const frame = container.querySelector("iframe")!;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      origin, source: frame.contentWindow,
      data: { type: "whybuddy:runtime:error", schemaVersion: 1, projectId: "project-one", runtimeId: "runtime-one",
        revision: "revision-one", channelId: "channel-1", error: CRASH, ...data },
    }));
  });
}

const banner = () => container.querySelector('[data-testid="project-preview-runtime-error"]');
const fixButton = () => container.querySelector<HTMLButtonElement>('[data-testid="project-preview-runtime-error-fix"]');

describe("预览报错回到工作台", () => {
  it("报错显示在预览上，一键交给 Agent：原话和调用栈在，预览主机不在", async () => {
    const ask = vi.fn();
    await openPreview({ onAskAgent: ask });
    expect(banner()).toBeNull();
    fromFrame({});
    expect(banner()?.textContent).toContain("reading 'map'");
    act(() => fixButton()!.click());
    expect(ask).toHaveBeenCalledTimes(1);
    const text: string = ask.mock.calls[0][0];
    expect(text).toContain("预览里的应用报错了");
    expect(text).toContain("reading 'map'");
    expect(text).toContain("at BudgetList (/src/App.tsx?t=1791442119:12:23)");
    expect(text).not.toContain("preview.example");
    expect(banner(), "交出去之后收起").toBeNull();
  });

  it("不是这个框、这一版、这条通道发来的，一律不认", async () => {
    await openPreview({ onAskAgent: vi.fn() });
    fromFrame({}, "https://evil.example");
    for (const field of ["projectId", "runtimeId", "revision", "channelId"]) fromFrame({ [field]: "wrong" });
    fromFrame({ error: { kind: "rm -rf", message: "x" } });
    fromFrame({ error: { kind: "uncaught_exception", message: 42 } });
    expect(banner()).toBeNull();
  });

  it("Agent 正在干活时按钮置灰；应用中心（没有对话）只显示、不给按钮", async () => {
    await openPreview({ onAskAgent: vi.fn(), isRunning: true });
    fromFrame({});
    expect(fixButton()?.disabled).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await openPreview({});
    fromFrame({});
    expect(banner()).not.toBeNull();
    expect(fixButton()).toBeNull();
  });

  it("同一个错只算一条", async () => {
    await openPreview({ onAskAgent: vi.fn() });
    fromFrame({});
    fromFrame({});
    fromFrame({ error: { ...CRASH, kind: "unhandled_rejection", message: "保存失败：/api/budget 500" } });
    expect(banner()?.textContent).toContain("另有 1 条");
  });
});

describe("预览报错的形状与转述", () => {
  it("长度封顶，形状不对就丢", () => {
    expect(previewRuntimeError({ kind: "uncaught_exception", message: "x".repeat(5000), stack: "y".repeat(9000) }))
      .toEqual({ kind: "uncaught_exception", message: "x".repeat(500), stack: "y".repeat(2000) });
    expect(previewRuntimeError({ kind: "uncaught_exception", message: "  " })).toBeNull();
    expect(previewRuntimeError(null)).toBeNull();
  });

  it("别的写法的预览主机也剥掉，路径留着", () => {
    expect(withoutPreviewHost("at f (https://5173-abc.e2b.app/src/a.ts:1:2)")).toBe("at f (/src/a.ts:1:2)");
    expect(previewErrorPrompt([{ ...CRASH, kind: "uncaught_exception" } as never])).not.toContain("https://");
  });

  it("§三：会话工作台真的把「发给 Agent」接到了预览上", () => {
    const strip = (file: string) => readFileSync(resolve(__dirname, file), "utf-8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    expect(strip("../../SlideRule.tsx")).toContain("onAskAgent={text => void sendMessage(text)}");
    expect(strip("../SlideRuleStudio.tsx")).toContain("onAskAgent={onAskAgent}");
  });
});
