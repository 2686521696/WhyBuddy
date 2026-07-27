import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ExperienceBlockBoundary,
  FREEFORM_MAX_DEPTH,
  FREEFORM_MAX_NODES,
} from "../block-registry";
import type { ExperienceBlockInstance, FreeformNode } from "../block-registry";
import { AppStageErrorBoundary } from "../AppStageErrorBoundary";

/** 2026-07-26 修复：freeform 内容树此前是无界递归渲染——超深/超大树（LLM
 * 产出、被篡改的持久化快照都走这条路径）会把递归栈打爆，整个应用舞台白屏，
 * 恰恰违背体验层 "fail-open 绝不拦主线" 的纪律。这里锁两道防线：
 * 1. 渲染预算（深度/节点数上限，超限截断降级并如实标注）；
 * 2. AppStageErrorBoundary 兜底（渲染异常收进诚实降级卡）。 */

function block(root: FreeformNode): ExperienceBlockInstance {
  return {
    id: "b1",
    type: "FreeformInsight",
    freeformContent: { root: root as unknown as Record<string, unknown> },
  };
}

function render(root: FreeformNode): string {
  return renderToStaticMarkup(<ExperienceBlockBoundary block={block(root)} />);
}

function chain(depth: number): FreeformNode {
  let node: FreeformNode = { tag: "span", text: "叶子" };
  for (let i = 0; i < depth; i += 1) {
    node = { tag: "div", children: [node] };
  }
  return node;
}

describe("freeform 渲染预算（深度/节点上限）", () => {
  it("正常小树完整渲染，无截断标注", () => {
    const html = render({
      tag: "div",
      children: [
        { tag: "strong", text: "标题" },
        { tag: "p", text: "正文" },
      ],
    });
    expect(html).toContain("标题");
    expect(html).toContain("正文");
    expect(html).not.toContain("freeform-insight-truncated");
  });

  it(`超过 ${FREEFORM_MAX_DEPTH} 层的深树被截断且如实标注，不炸栈`, () => {
    const html = render(chain(FREEFORM_MAX_DEPTH + 20));
    expect(html).toContain("freeform-insight-truncated");
    expect(html).not.toContain("叶子");
  });

  it("剧毒深树（1 万层）也稳:预算在栈爆前止损", () => {
    const html = render(chain(10_000));
    expect(html).toContain("freeform-insight-truncated");
  });

  it(`超过 ${FREEFORM_MAX_NODES} 个节点的宽树被截断且如实标注`, () => {
    const wide: FreeformNode = {
      tag: "div",
      children: Array.from({ length: FREEFORM_MAX_NODES + 50 }, (_, i) => ({
        tag: "span" as const,
        text: `n${i}`,
      })),
    };
    const html = render(wide);
    expect(html).toContain("freeform-insight-truncated");
    // 预算内的节点仍然渲染（截断是降级，不是清空）
    expect(html).toContain("n0");
  });

  it("恰好在上限内不误伤", () => {
    const ok: FreeformNode = {
      tag: "div",
      children: Array.from({ length: 50 }, (_, i) => ({
        tag: "span" as const,
        text: `k${i}`,
      })),
    };
    const html = render(ok);
    expect(html).toContain("k49");
    expect(html).not.toContain("freeform-insight-truncated");
  });
});

describe("AppStageErrorBoundary（应用舞台防崩溃气囊）", () => {
  it("正常路径透传 children", () => {
    const html = renderToStaticMarkup(
      <AppStageErrorBoundary>
        <div>正常内容</div>
      </AppStageErrorBoundary>
    );
    expect(html).toContain("正常内容");
    expect(html).not.toContain("app-stage-error-fallback");
  });

  it("getDerivedStateFromError 进入 didCatch 态", () => {
    const state = AppStageErrorBoundary.getDerivedStateFromError(new Error("boom"));
    expect(state.didCatch).toBe(true);
  });

  it("didCatch 态渲染诚实降级卡（带原因与重试按钮）", () => {
    const inst = new AppStageErrorBoundary({ children: null });
    inst.state = { didCatch: true, error: new Error("渲染炸了") };
    const html = renderToStaticMarkup(<>{inst.render()}</>);
    expect(html).toContain("app-stage-error-fallback");
    expect(html).toContain("应用舞台渲染失败");
    expect(html).toContain("渲染炸了");
    expect(html).toContain("重试渲染");
  });
});
