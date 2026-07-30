import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance, FreeformNode } from "../block-registry";

/**
 * lineHeight 裸数字倍数防线（2026-07-30，渲染层第二道防线）。
 *
 * 真机逮到过：LLM 给 28px 字号的 KPI 大数字配 `lineHeight: "32"`（意图是
 * "行高 32px"，写漏了单位）。lineHeight 不带单位时 CSS/React 都读成"字号
 * 的倍数"——32 倍字号 = 896px 的行高，把一整行 KPI 卡撑到 1000+px，下面的
 * 图表/活动列表全被挤出可视区域，版式看着"稀疏"其实是这一个属性把内容
 * 推没了。Python 生成侧已经在 check_style 里拦这个模式逼它重问，但历史
 * 产物/持久化快照恢复不走那条校验——这里是渲染层独立的第二道防线。
 */
describe("FreeformInsight lineHeight 裸数字倍数防线", () => {
  function render(root: FreeformNode): string {
    const block: ExperienceBlockInstance = {
      id: "b1",
      type: "FreeformInsight",
      freeformContent: { root: root as unknown as Record<string, unknown> },
    };
    return renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={{}} />);
  }

  it("离谱的裸数字倍数被丢弃，不把行高撑到几百上千像素", () => {
    const html = render({
      tag: "strong",
      style: { fontSize: "28px", lineHeight: "32" },
      text: "128",
    });
    expect(html).not.toContain("line-height:32");
    expect(html).not.toContain("line-height: 32");
  });

  it("正常倍数（1~2 之间）照常放行", () => {
    const html = render({
      tag: "strong",
      style: { fontSize: "28px", lineHeight: "1.4" },
      text: "128",
    });
    expect(html).toMatch(/line-height:\s?1\.4/);
  });

  it("带单位的写法（'32px'）不受影响——这条规则只拦裸数字", () => {
    const html = render({ tag: "strong", style: { lineHeight: "32px" }, text: "订单概览" });
    expect(html).toMatch(/line-height:\s?32px/);
  });

  it("阈值边界（4）本身放行，只拦真正超出的", () => {
    const html = render({ tag: "strong", style: { lineHeight: "4" }, text: "订单概览" });
    expect(html).toMatch(/line-height:\s?4/);
  });

  it("丢弃这条属性不连累同一节点的其它样式/内容", () => {
    const html = render({
      tag: "strong",
      style: { fontSize: "28px", lineHeight: "32", color: "#003c39" },
      text: "128",
    });
    expect(html).toContain("128");
    expect(html).toMatch(/font-size:\s?28px/);
    expect(html).toMatch(/color:\s?#003c39/);
  });
});
