// @vitest-environment jsdom
/**
 * 换账号以后，浏览器里记着的「当前会话」不许把新账号带进上一个账号的会话。
 *
 * ⚠ 2026-10-10 用户：同一个浏览器先用管理员账号推演，再注册新账号（1132700081@…）登录，
 *   页面自己打开了 `?session=sr-20261010041133-8N7046271C`——那是管理员的会话，新账号的会话列表是空的。
 *   新账号看到一张空白欢迎页；在那里发第一句话，话进的是别人的会话，服务端拒掉，
 *   黄条「推演中断：控制面未返回结果」。「当前会话」存在 localStorage（sliderule:active-session-id），不分账号，
 *   退出登录也不清。
 *
 * 走真 SlideRule 默认导出（会话壳），useSlideRuleSession 换记账替身（只记它被要求打开哪个会话），
 * useAuth 换成可切换的账号。会话号照真机原样。
 *
 * 变异（逐条实测过）：SlideRule 里不调 claimStoredSessionFor → 第一条红；
 *   claimStoredSessionFor 不比账号、照旧留着 → 第一、四条红；
 *   换账号时不看「是不是从存储接上的」、连地址栏点名的也换掉 → 第三条红；
 *   signOut 不调 forgetStoredSession → 第五条红；
 *   AuthProvider 拿到账号时不清（只靠推演页自己发现）→ 第六条红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_SESSION_KEY,
  ACTIVE_SESSION_OWNER_KEY,
  DEFAULT_SESSION_ID,
  claimStoredSessionFor,
  forgetStoredSession,
} from "@/lib/sliderule-session-id";

// jsdom 没有 Web Streams，页面引用的流式解析模块在加载时就要用——从 Node 补上（要赶在下面 import 之前）
await vi.hoisted(async () => {
  const web = await import("node:stream/web");
  const g = globalThis as Record<string, unknown>;
  for (const name of ["TransformStream", "ReadableStream", "WritableStream", "TextDecoderStream"] as const) {
    if (!g[name]) g[name] = (web as Record<string, unknown>)[name];
  }
  // 页面布局用到的浏览器观察器，jsdom 都没有：给个不做事的替身（这里只看会话壳选了哪条会话）
  class Quiet { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  for (const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"] as const) {
    if (!g[name]) g[name] = Quiet;
  }
  if (typeof window !== "undefined" && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {},
      removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  }
});

vi.mock("@/lib/deploy-target", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/deploy-target")>();
  return { ...actual, IS_GITHUB_PAGES: false };
});

const ADMIN_SESSION = "sr-20261010041133-8N7046271C";
const auth: { user: { id: string; email: string; isSuperuser: boolean } | null } = { user: null };
vi.mock("@/lib/use-auth", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/use-auth")>();
  return {
    ...actual,
    useAuth: () => ({ user: auth.user, ready: true, capabilities: {}, refresh: async () => {}, signOut: async () => {} }),
  };
});

const opened: string[] = [];
// 形状照 SlideRule.unified-surface.test 的 baseHookReturn（同一个空会话面）；另记下会话壳让它打开哪个会话
vi.mock("../useSlideRuleSession", () => ({
  useSlideRuleSession: (options: { sessionId?: string }) => {
    opened.push(String(options.sessionId));
    return {
      goal: "",
      sessionState: { sessionId: String(options.sessionId), goal: { text: "" }, artifacts: [], capabilityRuns: [],
        coverageGaps: [], decisionLedger: [] },
      uiTurns: [], input: "", setInput: () => {}, isRunning: false, liveAction: null, sendMessage: async () => {},
      pendingPlanApproval: null, submitPlanApproval: () => {}, pendingAsk: null, confirmControlScope: async () => {},
      dismissScopeCard: () => {}, dismissAsk: () => {}, challengeTurn: async () => {}, resetSession: () => {},
      retryCapability: async () => {}, toggleRouteExpanded: () => {}, driveMode: "single", setDriveMode: () => {},
      stop: () => {}, executorMode: "server-llm", driveFullStatus: "idle", activeSkillId: null, skillContents: {},
      latestMermaid: null, pendingClarifications: [], answerClarifications: () => {}, generateDeliverables: () => {},
      queuedTurns: [], removeQueuedTurn: () => {},
    };
  },
}));

import SlideRule from "@/pages/SlideRule";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => {
  localStorage.clear();
  opened.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
});

async function openPage(path: string) {
  window.history.replaceState(null, "", path);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SlideRule />);
  });
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

const NEW_USER = { id: "u-new-1132700081", email: "1132700081@qq.com", isSuperuser: false };
const ADMIN = { id: "u-admin", email: "admin@example.com", isSuperuser: true };

describe("换账号：浏览器记着的「当前会话」", () => {
  it("上一个账号留下的会话：新账号打开推演页回到空白新会话，地址栏不再挂着它", async () => {
    localStorage.setItem(ACTIVE_SESSION_KEY, ADMIN_SESSION);
    localStorage.setItem(ACTIVE_SESSION_OWNER_KEY, ADMIN.id);
    auth.user = NEW_USER;
    await openPage("/agent-loop/sliderule");
    expect(opened.at(-1)).toBe(DEFAULT_SESSION_ID);
    expect(window.location.search).not.toContain(ADMIN_SESSION);
    expect(localStorage.getItem(ACTIVE_SESSION_KEY)).not.toBe(ADMIN_SESSION);
    expect(localStorage.getItem(ACTIVE_SESSION_OWNER_KEY)).toBe(NEW_USER.id);
  });

  it("反向：还是同一个账号，接着打开上次那条会话", async () => {
    localStorage.setItem(ACTIVE_SESSION_KEY, ADMIN_SESSION);
    localStorage.setItem(ACTIVE_SESSION_OWNER_KEY, ADMIN.id);
    auth.user = ADMIN;
    await openPage("/agent-loop/sliderule");
    expect(opened.at(-1)).toBe(ADMIN_SESSION);
    expect(window.location.search).toContain(ADMIN_SESSION);
  });

  it("反向：地址栏点名的会话（别人发来的链接、侧栏点的）不替人换掉，交给服务端判权限", async () => {
    localStorage.setItem(ACTIVE_SESSION_KEY, ADMIN_SESSION);
    localStorage.setItem(ACTIVE_SESSION_OWNER_KEY, ADMIN.id);
    auth.user = NEW_USER;
    await openPage(`/agent-loop/sliderule?session=${ADMIN_SESSION}`);
    expect(opened.at(-1)).toBe(ADMIN_SESSION);
  });

  it("归属：同账号保留；换账号丢掉并报出丢的是哪条；没记过归属的（升级前存的）也丢", () => {
    const box = new Map<string, string>();
    const storage = {
      getItem: (k: string) => box.get(k) ?? null,
      setItem: (k: string, v: string) => void box.set(k, v),
      removeItem: (k: string) => void box.delete(k),
    };
    box.set(ACTIVE_SESSION_KEY, ADMIN_SESSION);
    box.set(ACTIVE_SESSION_OWNER_KEY, ADMIN.id);
    expect(claimStoredSessionFor(ADMIN.id, storage)).toBeNull();
    expect(box.get(ACTIVE_SESSION_KEY)).toBe(ADMIN_SESSION);
    expect(claimStoredSessionFor(NEW_USER.id, storage)).toBe(ADMIN_SESSION);
    expect(box.has(ACTIVE_SESSION_KEY)).toBe(false);
    expect(box.get(ACTIVE_SESSION_OWNER_KEY)).toBe(NEW_USER.id);
    box.clear();
    box.set(ACTIVE_SESSION_KEY, ADMIN_SESSION);
    expect(claimStoredSessionFor(NEW_USER.id, storage)).toBe(ADMIN_SESSION);
    expect(claimStoredSessionFor(null, storage)).toBeNull();
  });

  it("退出登录：「当前会话」和归属一起清掉", async () => {
    localStorage.setItem(ACTIVE_SESSION_KEY, ADMIN_SESSION);
    localStorage.setItem(ACTIVE_SESSION_OWNER_KEY, ADMIN.id);
    forgetStoredSession();
    expect(localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_SESSION_OWNER_KEY)).toBeNull();
    // 接在链路上：use-auth 的 signOut 真的调了它（剥注释后看调用）
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "client/src/lib/use-auth.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const signOut = src.slice(src.indexOf("const signOut = useCallback"), src.indexOf("const value = useMemo"));
    expect(signOut).toMatch(/forgetStoredSession\(\)/);
  });

  it("「我的应用」切回推演页那条路：账号一确定就清掉别人的，拼出来的地址不再带它", async () => {
    // AgentLoopPage.currentSliderulePath 拿记着的会话拼 ?session=——地址栏点名的会话推演页不替换，
    // 所以必须在账号确定时（AuthProvider）就清，不能等推演页
    localStorage.setItem(ACTIVE_SESSION_KEY, ADMIN_SESSION);
    localStorage.setItem(ACTIVE_SESSION_OWNER_KEY, ADMIN.id);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/account/me")) return new Response(JSON.stringify({ user: NEW_USER }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const { AuthProvider } = await vi.importActual<typeof import("@/lib/use-auth")>("@/lib/use-auth");
    const { currentSliderulePath } = await import("@/pages/agent-loop/AgentLoopPage");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<AuthProvider><span /></AuthProvider>); });
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
    expect(localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();
    expect(currentSliderulePath("/agent-loop/apps")).toBe("/agent-loop/sliderule");
    vi.unstubAllGlobals();
  });
});
