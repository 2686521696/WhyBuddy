import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance, FreeformNode } from "../block-registry";

/** 2026-07-24：放开图标白名单——iconRef 直接用 Ant Design 组件名，按名字
 * 动态解析成任意图标，不再限定在手维护的 12 个里。这里验证：任意合法 Ant
 * Design 图标名能解析出对应图标；老 kebab 别名仍兼容；非法/编造/原型链名字
 * 一律渲染成空、不崩（安全边界：图标名只当组件名查表，非法就降级）。 */
describe("FreeformInsight 图标动态解析（放开白名单）", () => {
  function render(root: FreeformNode): string {
    const block: ExperienceBlockInstance = {
      id: "b1",
      type: "FreeformInsight",
      freeformContent: { root: root as unknown as Record<string, unknown> },
    };
    return renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={{}} />);
  }

  it("任意 Ant Design 图标名（业务图标）能解析出来", () => {
    // Ant Design 图标渲染成 <span class="anticon anticon-wallet">
    expect(render({ tag: "div", iconRef: "WalletOutlined" })).toContain("anticon-wallet");
    expect(render({ tag: "div", iconRef: "ShoppingCartOutlined" })).toContain("anticon-shopping-cart");
    expect(render({ tag: "div", iconRef: "PieChartOutlined" })).toContain("anticon-pie-chart");
  });

  it("老 kebab 别名仍然兼容", () => {
    expect(render({ tag: "div", iconRef: "check-circle" })).toContain("anticon-check-circle");
    expect(render({ tag: "div", iconRef: "trending-up" })).toContain("anticon-rise");
  });

  it("编造/拼错的图标名渲染成空，不崩", () => {
    const html = render({ tag: "div", iconRef: "NotARealIconOutlined", text: "占位" });
    expect(html).not.toContain("anticon-");
    expect(html).toContain("占位"); // 节点其它内容照常渲染
  });

  it("非图标形状的名字（工具导出/原型链名/小写）被挡掉", () => {
    for (const bad of ["getTwoToneColor", "__proto__", "constructor", "wallet", "Wallet"]) {
      expect(render({ tag: "div", iconRef: bad })).not.toContain("anticon-");
    }
  });
});
