// @vitest-environment jsdom
/**
 * 完成轮折起来那张脸：用真机那一轮的**原样事件**驱动真 hook，再按 SessionStory
 * 的同一条路（deriveSessionStory → splitClosingSpeech → sessionStoryCollapsedHint）算。
 *
 * ⚠ 2026-09-27 隔离真机第 32 轮 sr-20260927095333-CZW9SMJ1FA（Excel 追问：
 *   安全库存改成按近 30 天日均出库 × 7 天，改完核对公式）。脸上写的是
 *
 *     工作了 7m 39s  已运行 1 个命令 · 读取 3 次 · 编辑了 7 个文件 · 读取 2 …
 *
 *   实际：跑了 8 条命令，只改了 2 份文件（生成脚本 9 次 str_replace + 1 个校验
 *   脚本），其中 1 次 str_replace 没找到原文、什么都没改。两处错：每组摘要串起来
 *   （开口把工具切成七组，「读取」出现两遍，命令只数到第一组）；编辑按次数算文件。
 *
 * 夹具 `fixtures/round32-followup-events.json` 是那一轮追问 control run 的
 * 120 个 SSE 事件原样（去掉末尾那发带整份 state 的 complete）。
 *
 * 把 sessionStoryCollapsedHint 改回逐组摘要串接，或把 editedFiles 改回按行数，
 * 第一条变红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialSessionState } from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import {
  deriveSessionStory,
  sessionStoryCollapsedHint,
  splitClosingSpeech,
} from "../session-story";
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
  readFileSync(resolve(__dirname, "fixtures/round32-followup-events.json"), "utf8")
);

const SID = "collapsed-face-real-events";
let current: ReturnType<typeof useSlideRuleSession>;
let root: Root;
let container: HTMLDivElement;
let saved: V5SessionState;
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
let running: Promise<void> | undefined;

function Harness() {
  current = useSlideRuleSession({ sessionId: SID });
  return null;
}

const encode = (value: unknown) =>
  new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ReadableStream", NodeReadableStream);
  localStorage.clear();
  saved = createInitialSessionState("月度库存管理 Excel", SID);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/sessions/${SID}`)) {
        return init?.method === "PUT"
          ? Response.json({ ok: true })
          : Response.json({ state: saved, backend: "python" });
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
  if (stream) {
    await act(async () => {
      stream!.enqueue(encode({ type: "complete", state: saved }));
      stream!.close();
      stream = undefined;
      await running;
    });
  }
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function replayAll() {
  await act(async () => {
    root.render(<Harness />);
  });
  await expect.poll(() => current.sessionHydrated).toBe(true);
  await act(async () => {
    running = current.sendMessage("把安全库存改成按近30天日均出库×7天自动计算，改完核对一下所有公式是否正确");
    await vi.waitFor(() => expect(stream).toBeDefined());
  });
  await act(async () => {
    for (const e of EVENTS) stream!.enqueue(encode(e));
  });
  await vi.waitFor(() =>
    expect(current.uiTurns.at(-1)?.steps.length ?? 0).toBeGreaterThan(20)
  );
}

/** SessionStory.tsx 折起来时算脸的同一条路。 */
function collapsedFace(): string {
  const turn = current.uiTurns.at(-1)!;
  const { process } = splitClosingSpeech(deriveSessionStory(turn), false);
  return sessionStoryCollapsedHint(process);
}

describe("第 32 轮追问的原样事件", () => {
  it("脸上说整轮：2 份文件、1 次修改失败、8 条命令，每样只出现一次", async () => {
    await replayAll();
    const face = collapsedFace();
    expect(face).toContain("编辑了 2 个文件");
    expect(face).toContain("修改失败 1 次");
    expect(face).toContain("已运行 8 个命令");
    // 反向：不许把逐组摘要串起来（同一类出现两遍、命令只数第一组）
    const kinds = face.split(" · ").map(part => part.replace(/\s*\d+\s*/g, " ").trim());
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(face).not.toContain("编辑了 7 个文件");
    expect(face).not.toContain("已运行 1 个命令");
  });

  it("夹具就是真机那一轮：7 组工具被开口切开，编辑 10 次", async () => {
    await replayAll();
    const turn = current.uiTurns.at(-1)!;
    const groups = deriveSessionStory(turn).filter(b => b.kind === "tools");
    expect(groups.length).toBeGreaterThan(1);
    const edits = groups
      .flatMap(b => (b.kind === "tools" ? b.rows : []))
      .filter(r => r.tool === "file_str_replace" || r.tool === "file_write");
    expect(edits).toHaveLength(10);
  });
});
