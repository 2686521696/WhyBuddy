/**
 * Regression: 沉浸模式(showChrome=false + showBottomChrome,如 /sliderule)下,
 * 左下思考日志(console)必须抬高到底部悬浮输入条之上(bottom-[104px]),
 * 否则会被 grokInputBar 遮挡;带 chrome 的面板宿主保持 bottom-4。
 * SSR + 字符串断言(与 TrustGateControls.test.tsx 同风格)。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { ReasoningFlowSurface } from "../ReasoningFlowSurface";
import type { BrainstormReasoningGraph } from "@shared/blueprint/brainstorm-reasoning-graph";

const graph: BrainstormReasoningGraph = {
  id: "g-1",
  jobId: "job-1",
  stage: "spec_tree",
  nodes: [
    { id: "n1", type: "question", title: "用户命题", body: "做一个预约系统", status: "open" },
  ],
  edges: [],
  consoleLines: [{ id: "c1", kind: "Thinking", text: "route.generate (Full Migration)" }],
  source: "runtime",
};

function extractConsoleClass(html: string): string {
  const marker = 'data-testid="reasoning-flow-console"';
  const idx = html.indexOf(marker);
  expect(idx).toBeGreaterThan(-1);
  // class 属性在 data-testid 之前渲染;取包含该 testid 的 div 开标签
  const openTagStart = html.lastIndexOf("<div", idx);
  const openTag = html.slice(openTagStart, html.indexOf(">", idx));
  const m = openTag.match(/class="([^"]*)"/);
  expect(m).not.toBeNull();
  return m![1];
}

describe("ReasoningFlowSurface console bottom offset", () => {
  it("immersive mode (showChrome=false + showBottomChrome) lifts console above floating composer", () => {
    const html = renderToStaticMarkup(
      createElement(ReasoningFlowSurface, {
        graph,
        showChrome: false,
        showBottomChrome: true,
      }),
    );
    const cls = extractConsoleClass(html);
    expect(cls).toContain("bottom-[104px]");
    expect(cls).not.toMatch(/(^|\s)bottom-4(\s|$)/);
  });

  it("chromed panel host keeps console at bottom-4", () => {
    const html = renderToStaticMarkup(
      createElement(ReasoningFlowSurface, { graph, showChrome: true }),
    );
    const cls = extractConsoleClass(html);
    expect(cls).toMatch(/(^|\s)bottom-4(\s|$)/);
    expect(cls).not.toContain("bottom-[104px]");
  });
});
