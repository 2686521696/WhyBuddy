// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSUMPTION_DRAFT_PREFIX,
  AssumptionStrip,
} from "../AssumptionStrip";
import type { SpecAssumption } from "../spec-assumptions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: SpecAssumption[] = [
  {
    id: "a1",
    topic: "员工怎么登录",
    decision: "手机号 + 短信验证码",
    alternatives: ["工号 + 密码", "企业微信扫码"],
    why: "需求里没说身份从哪来",
  },
  {
    id: "a2",
    topic: "审批几级",
    decision: "一级",
    alternatives: ["两级"],
    why: "需求里没说审批层级",
  },
];

const SESSION_A = "sr-assumption-a";
const SESSION_B = "sr-assumption-b";

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function option(host: HTMLElement, text: string): HTMLElement {
  const hit = Array.from(
    host.querySelectorAll<HTMLElement>(
      '[data-testid="sliderule-assumption-option"]'
    )
  ).find(button => button.textContent?.includes(text));
  if (!hit) throw new Error(`option not found: ${text}`);
  return hit;
}

describe("AssumptionStrip session draft", () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    window.sessionStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = null;
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host.remove();
    window.sessionStorage.clear();
  });

  function mount(
    onConfirm: (picks: Record<string, string>) => void,
    sessionId = SESSION_A
  ) {
    root = createRoot(host);
    act(() => {
      root!.render(
        <AssumptionStrip
          items={ITEMS}
          sessionId={sessionId}
          onConfirm={onConfirm}
        />
      );
    });
  }

  it("从 1 / 2 推进到 2 / 2，并在卸载重挂后恢复进度", () => {
    const onConfirm = vi.fn();
    mount(onConfirm);

    expect(
      host.querySelector('[data-testid="sliderule-assumption-pager"]')
        ?.textContent
    ).toContain("1 / 2");
    click(option(host, "工号 + 密码"));
    click(host.querySelector('[data-testid="sliderule-assumption-next"]')!);

    expect(
      host.querySelector('[data-testid="sliderule-assumption-pager"]')
        ?.textContent
    ).toContain("2 / 2");

    act(() => root!.unmount());
    root = null;
    mount(onConfirm);

    expect(
      host.querySelector('[data-testid="sliderule-assumption-pager"]')
        ?.textContent
    ).toContain("2 / 2");
    expect(host.textContent).toContain("审批几级");
  });

  it("会话 A 的草稿不会落到会话 B", () => {
    const onConfirm = vi.fn();
    mount(onConfirm, SESSION_A);
    click(option(host, "工号 + 密码"));
    click(host.querySelector('[data-testid="sliderule-assumption-next"]')!);
    act(() => root!.unmount());
    root = null;

    mount(onConfirm, SESSION_B);
    expect(
      host.querySelector('[data-testid="sliderule-assumption-pager"]')
        ?.textContent
    ).toContain("1 / 2");
    expect(host.textContent).toContain("员工怎么登录");
  });

  it("提交时把两题选择一并交给 onConfirm，并清掉当前 session 草稿", () => {
    const onConfirm = vi.fn();
    mount(onConfirm);

    click(option(host, "工号 + 密码"));
    click(host.querySelector('[data-testid="sliderule-assumption-next"]')!);
    click(option(host, "两级"));
    click(host.querySelector('[data-testid="sliderule-assumption-submit"]')!);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      a1: "工号 + 密码",
      a2: "两级",
    });
    expect(
      Object.keys(window.sessionStorage).filter(key =>
        key.includes(ASSUMPTION_DRAFT_PREFIX)
      )
    ).toHaveLength(0);
  });

  it("SlideRule → ComposerDock 把 sessionId 传到假设卡", () => {
    const read = (rel: string) => {
      const found = [`client/${rel}`, rel]
        .map(c => resolve(process.cwd(), c))
        .find(p => {
          try {
            readFileSync(p, "utf8");
            return true;
          } catch {
            return false;
          }
        });
      if (!found) throw new Error(`missing ${rel}`);
      return readFileSync(found, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
    };
    const page = read("src/pages/SlideRule.tsx");
    const dock = read("src/pages/sliderule/ComposerDock.tsx");
    const call = page.slice(
      page.indexOf("<ComposerDock"),
      page.indexOf("<ComposerDock") + 900
    );
    expect(call).toContain("sessionId={sessionId}");
    expect(dock).toContain("sessionId={sessionId}");
    expect(dock).toContain("<AssumptionStrip");
  });
});
