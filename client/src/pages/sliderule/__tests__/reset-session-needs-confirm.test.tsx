// @vitest-environment jsdom
/**
 * 重置会话要点两下：第一下只弹确认，「确认重置」才删。
 *
 * ⚠ 2026-10-10 用户：「重置按钮用户太容易误触」。那颗钮在标题左边、放大、蓝色（2026-08-24 用户要的），
 *   原来点一下就 deleteSlideRuleSession，整条会话当场没了（SlideRuleResetSessionButton 头注）。
 *
 * 走真 SlideRuleResetSessionButton，数 onResetSession 被调了几次。
 * 变异（逐条实测过）：按钮 onClick 直接调 onResetSession → 第一～四条红；
 *   取消也调 onResetSession → 第三条红；不监听 Esc → 第四条红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SlideRuleResetSessionButton } from "../SlideRuleTopHud";

vi.mock("@/lib/deploy-target", () => ({ IS_GITHUB_PAGES: false }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
});

async function mount(isRunning = false) {
  const reset = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SlideRuleResetSessionButton isRunning={isRunning} onResetSession={reset} />);
  });
  return reset;
}
const q = (id: string) => container!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: HTMLElement | null) => act(async () => { el!.click(); });

describe("重置会话：点两下才删", () => {
  it("点一下只弹确认框，不删", async () => {
    const reset = await mount();
    await click(q("sliderule-reset-session"));
    expect(reset).not.toHaveBeenCalled();
    expect(q("sliderule-reset-confirm")?.textContent).toContain("无法恢复");
  });

  it("确认重置才删，且只删一次", async () => {
    const reset = await mount();
    await click(q("sliderule-reset-session"));
    await click(q("sliderule-reset-confirm-yes"));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(q("sliderule-reset-confirm")).toBeNull();
  });

  it("反向：点取消只关框", async () => {
    const reset = await mount();
    await click(q("sliderule-reset-session"));
    await click(q("sliderule-reset-cancel"));
    expect(reset).not.toHaveBeenCalled();
    expect(q("sliderule-reset-confirm")).toBeNull();
  });

  it("反向：按 Esc、点框外都只关框", async () => {
    const reset = await mount();
    await click(q("sliderule-reset-session"));
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(q("sliderule-reset-confirm")).toBeNull();
    await click(q("sliderule-reset-session"));
    await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(q("sliderule-reset-confirm")).toBeNull();
    expect(reset).not.toHaveBeenCalled();
  });

  it("推演中按钮禁用，点了也不弹", async () => {
    const reset = await mount(true);
    expect((q("sliderule-reset-session") as HTMLButtonElement).disabled).toBe(true);
    await click(q("sliderule-reset-session"));
    expect(q("sliderule-reset-confirm")).toBeNull();
    expect(reset).not.toHaveBeenCalled();
  });
});
