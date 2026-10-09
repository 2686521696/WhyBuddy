// @vitest-environment jsdom
/**
 * 积分制前端（2026-10-09，slide-rule-python/services/credit_ledger.py 头注）。
 *
 * 判据打在真入口上：
 * - 开回合被 402 拒：postControlTurnStream 必须把原话交给 onControlText——以前非 200 一律 return null，
 *   界面只剩「控制面未返回结果」或一直转圈（2026-10-09 新服务器那一趟，用户截图里转了 3 分多钟）。
 * - 叫醒预览被 402 拒：wakeProjectPreview 抛的是带余额的原话，不是「暂时无法启动」。
 * - 账号菜单真有「额度」一项、点开是额度弹窗、弹窗里兑换走真接口。
 * 每条正向配一条反向：别的错误码不许被说成额度用完。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AccountPanel } from "@/pages/agent-loop/dashboard/AccountPanel";

import { creditExhaustedMessage, describeCreditLog, formatPoints } from "../credits-client";
import { postControlTurnStream } from "../sliderule-marathon-driver";

const EXHAUSTED = {
  code: "credit_exhausted",
  message: "额度已用完（当前余额 -0.3 积分），这一轮没有开始。请在左下角账号菜单的「额度」里输入兑换码充值，或联系管理员加额度。",
  status: "error",
};

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    clone: () => ({ json: async () => body }),
    body: null,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // antd 在 jsdom 里要 matchMedia。
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("402 的原话", () => {
  it("后端平铺的、套在 detail 里的都认", () => {
    expect(creditExhaustedMessage(EXHAUSTED)).toBe(EXHAUSTED.message);
    expect(creditExhaustedMessage({ detail: { code: "credit_exhausted", message: "x" } })).toBe("x");
    expect(creditExhaustedMessage({ code: "credit_exhausted" })).toContain("额度已用完");
  });

  it("反向：别的错误不许说成额度用完", () => {
    expect(creditExhaustedMessage({ message: "project_runtime_unavailable" })).toBeNull();
    expect(creditExhaustedMessage(null)).toBeNull();
  });

  it("积分与明细的显示", () => {
    expect(formatPoints(500)).toBe("500");
    expect(formatPoints(4.7)).toBe("4.7");
    expect(formatPoints(-0.333)).toBe("-0.33");
    expect(
      describeCreditLog({
        id: "1", ownerId: "u", kind: "consume", quota: -100, points: -0.02, balancePoints: 1,
        model: "gpt-x", promptTokens: 1000, cachedTokens: 800, completionTokens: 50, seconds: null,
        note: null, actor: null, createdAt: 0,
      })
    ).toBe("gpt-x · 输入 1000（缓存 800） · 输出 50");
  });
});

describe("开回合被额度拒：照实说，不转圈", () => {
  const STATE = { sessionId: "s-1", goal: { text: "请假系统" } } as never;

  it("402 → onControlText 拿到原话，返回 null", async () => {
    stubFetch(402, EXHAUSTED);
    const texts: string[] = [];
    const out = await postControlTurnStream(STATE, "继续", {
      onControlText: (text: string) => texts.push(text),
    } as never);
    expect(out).toBeNull();
    expect(texts).toEqual([EXHAUSTED.message]);
  });

  it("反向：别的失败不冒充额度", async () => {
    stubFetch(503, { message: "control_run_unavailable" });
    const texts: string[] = [];
    await postControlTurnStream(STATE, "继续", { onControlText: (text: string) => texts.push(text) } as never);
    expect(texts.join("")).not.toContain("额度");
  });
});

describe("叫醒预览被额度拒", () => {
  it("抛带余额的原话", async () => {
    const { wakeProjectPreview } = await import("@/pages/sliderule/project-runtime/project-preview-client");
    stubFetch(402, EXHAUSTED);
    await expect(wakeProjectPreview("prj-1", new AbortController().signal)).rejects.toThrow(EXHAUSTED.message);
  });

  it("反向：503 还是原来那句", async () => {
    const { wakeProjectPreview } = await import("@/pages/sliderule/project-runtime/project-preview-client");
    stubFetch(503, { message: "project_runtime_unavailable" });
    await expect(wakeProjectPreview("prj-1", new AbortController().signal)).rejects.toThrow("工程运行服务暂时不可用");
  });
});

vi.mock("@/lib/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "a@b.c", displayName: null, isSuperuser: false, isVerified: true, createdAt: "" },
    ready: true,
    signOut: async () => {},
  }),
}));

describe("账号菜单的「额度」", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
  });

  it("菜单里写着余额，点开是额度弹窗，兑换走真接口", async () => {
    const account = { ownerId: "u-1", quota: 2_500_000, usedQuota: 0, requestCount: 3, points: 500, usedPoints: 0 };
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method || "GET", body: init?.body as string | undefined });
        const body = url.endsWith("/credits/me")
          ? { account, quotaPerPoint: 5000, exempt: false, enforced: true }
          : url.includes("/credits/logs")
            ? { items: [], total: 0, page: 1, size: 10 }
            : { points: 100, account: { ...account, points: 600 } };
        return { ok: true, status: 200, json: async () => body };
      })
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<AccountPanel />));
    await act(async () => {
      (host!.querySelector('[data-testid="account-signed-in"]') as HTMLButtonElement).click();
    });
    const item = host.querySelector('[data-testid="account-credits"]') as HTMLButtonElement;
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("500 积分");
    await act(async () => item.click());
    expect(document.body.textContent).toContain("我的额度");
    const input = document.querySelector('[data-testid="credits-code"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "abc123");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (document.querySelector('[data-testid="credits-redeem"]') as HTMLButtonElement).click();
    });
    const redeem = calls.find(call => call.url.endsWith("/credits/redeem"));
    expect(redeem?.method).toBe("POST");
    expect(JSON.parse(redeem!.body!)).toEqual({ code: "abc123" });
    expect(document.body.textContent).toContain("到账 100 积分");
  }, 20_000); // antd 弹窗第一次挂载在并行跑满时要好几秒
});
