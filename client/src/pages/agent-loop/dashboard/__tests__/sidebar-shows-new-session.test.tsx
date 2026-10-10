// @vitest-environment jsdom
/**
 * 新建会话、说过话还没确认话题的会话，都要在左侧会话列表里看得见。
 *
 * ⚠ 2026-10-10 用户：「左侧会话新建了会话看不到那一条记录」。侧栏只列 goal 非空的会话（E30：空壳不进列表），
 *   可控制面前几轮（问候 / 提问卡 / 写计划）刻意不写 goal——线上当天 21 条里 11 条 goal 为空，6 条用户已经发过话。
 *   服务端现在给这种会话一个列表标题（用户第一句话，session_blob_store._list_title，Python 判据另有一份）；
 *   这里管前端那两半：正在用的空会话也显示；新建之后列表不许跟「建之前发出的」请求合流拿旧结果。
 *
 * 走真 SidebarSessions（jsdom），HTTP 换桩。会话号照线上的形状。
 * 第三条还钉住两个顺带翻出来的真问题：① 列表还没拉回来就点新建，原来被判成「刚建未落盘」原地复用、什么都没建；
 *   ② 新建后的刷新拿到新列表，「建之前发出的」慢请求后回来又把旧列表盖回去。
 * 变异（逐条实测过）：过滤条件去掉「正在用的这一条」→ 第一、三条红；createSessionId 不作废共享取数 → 第三条红；
 *   列表请求不按序号丢旧结果 → 第三条红；列表没拉回来也按老规则复用 → 第三、四条红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_SESSION_KEY } from "@/lib/sliderule-session-id";
import { SidebarSessions, decideNewSessionAction } from "../SidebarSessions";
import { __resetSessionsListForTests } from "../sessions-list-client";

vi.mock("@/lib/deploy-target", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/deploy-target")>()),
  IS_GITHUB_PAGES: false,
}));

const NOW = new Date().toISOString();
const row = (sessionId: string, goal: string, phase = "idle") =>
  ({ sessionId, goal, phase, createdAt: NOW, lastActive: NOW, artifactCount: 0 });
const ACTIVE_BLANK = "sr-20261010081500-ACTIVEBLNK";
const OTHER_BLANK = "sr-20261010081000-OTHERBLANK";
const NAMED = "sr-20261010080000-NAMEDSESSN";
const FRESH = "sr-20261010082000-FRESHSESSN";

let listed: ReturnType<typeof row>[] = [];
let listCalls = 0;
let releaseFirstList: (() => void) | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => {
  __resetSessionsListForTests();
  localStorage.clear();
  listCalls = 0;
  releaseFirstList = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/sliderule/sessions") && init?.method === "POST") {
      listed = [row(FRESH, ""), ...listed];
      return Response.json({ sessionId: FRESH });
    }
    if (url.endsWith("/api/sliderule/sessions")) {
      listCalls += 1;
      const snapshot = listed.slice();
      if (listCalls === 1 && releaseFirstList === null) {
        // 第一发拉列表慢一点：新建发生在它回来之前（「建之前发出的」那次）
        await new Promise<void>(resolve => { releaseFirstList = resolve; });
      }
      return Response.json({ sessions: snapshot });
    }
    return Response.json([]);
  }));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<SidebarSessions />); });
}
const item = (sid: string) => container!.querySelector(`[data-testid="sidebar-session-item-${sid}"]`);

describe("左侧会话列表：新建的、说过话的都看得见", () => {
  it("正在用的空会话显示成「新会话」；别的空壳照旧不显示", async () => {
    listed = [row(ACTIVE_BLANK, ""), row(OTHER_BLANK, ""), row(NAMED, "做一个记账小网页")];
    localStorage.setItem(ACTIVE_SESSION_KEY, ACTIVE_BLANK);
    await mount();
    releaseFirstList?.();
    await settle();
    expect(item(ACTIVE_BLANK)?.textContent).toContain("新会话");
    expect(item(NAMED)).not.toBeNull();
    expect(item(OTHER_BLANK)).toBeNull();
  });

  it("服务端给了标题（用户第一句话）的会话照常显示", async () => {
    listed = [row(NAMED, "帮我做一个采购审批应用", "awaiting")];
    await mount();
    releaseFirstList?.();
    await settle();
    expect(item(NAMED)?.textContent).toContain("采购审批");
  });

  it("点「新建会话」：新的那条立刻出现在列表里（不跟建之前那次请求合流）", async () => {
    listed = [row(NAMED, "做一个记账小网页")];
    localStorage.setItem(ACTIVE_SESSION_KEY, NAMED);
    await mount();                                       // 第一发列表请求挂着
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="sidebar-session-new"]')!.click();
    });
    await settle();
    releaseFirstList?.();                                // 建之前那次现在才回来（里面没有新会话）
    await settle();
    expect(item(FRESH)?.textContent).toContain("新会话");
  });

  it("判据：列表没拉回来时只复用本侧栏刚铸的那条，别的都新建", () => {
    expect(decideNewSessionAction({ activeId: NAMED, activeMeta: undefined, listLoaded: false })).toBe("create");
    expect(decideNewSessionAction({ activeId: FRESH, activeMeta: undefined, listLoaded: false, justMinted: true }))
      .toBe("reuse-active");
    // 反向：列表拉回来了、真是空会话，照旧复用（防连点堆空会话）
    expect(decideNewSessionAction({ activeId: FRESH, activeMeta: { goal: "", phase: "idle" }, listLoaded: true }))
      .toBe("reuse-active");
  });
});
