/**
 * blueprint-wall-process-graph-hud-2026-05-31 Task 4.4 —
 * `BlueprintWallGraphNodeCard` 的 SSR / source 输出测试。
 *
 * 测试技术沿用本仓既有的 SSR 组件测试约定（如
 * `client/src/pages/autopilot/right-rail/__tests__/StoreObservabilityHud.test.tsx`）：
 * 使用 `react-dom/server` 的 `renderToStaticMarkup` 渲染纯组件，再对返回的
 * 静态 HTML 字符串做断言。不引入 jsdom / @testing-library。
 *
 * 覆盖（对应 Req 5.1-5.7 / 10.5）：
 *  1. 类型 + 标题 + 正文渲染（5.1 / 5.2）。
 *  2. 缺省正文不臆造文本、标题仍在（5.2）。
 *  3. 状态 data 属性 / 徽章渲染（5.7）。
 *  4. 全部 9 种节点类型都能渲染不抛错（5.3）。
 *  5. preview — browser 分支 + URL 文本（5.5）。
 *  6. preview — architecture 分支（5.5）。
 *  7. preview — 空 / 缺省 previewSummary 不抛错（5.6 / 3.6）。
 *  8. 不臆造缩略图：无 thumbnailUrl 时不渲染 <img>，有 thumbnailUrl 时渲染（5.6）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BlueprintWallGraphNodeCard,
  NODE_TYPE_VISUAL,
} from "../BlueprintWallGraphNodeCard";
import type { BlueprintFlowGraphNodeData } from "../blueprint-wall-flow-graph-map";
import type { BlueprintWallPreviewSummary } from "../blueprint-wall-process-data";

// ─── Fixture helper ──────────────────────────────────────────────────────────

/**
 * 构造一个合法的 `BlueprintFlowGraphNodeData`。默认是一个 active 的 stage 节点；
 * 通过 `overrides` 覆盖任意字段（type / status / title / body / ...）。
 */
function makeCardData(
  overrides: Partial<BlueprintFlowGraphNodeData> = {}
): BlueprintFlowGraphNodeData {
  return {
    type: "stage",
    status: "active",
    title: "T",
    sourceRefs: [],
    visualStageLane: 0,
    row: 0,
    effectiveRow: 0,
    column: 0,
    ...overrides,
  };
}

describe("BlueprintWallGraphNodeCard / SSR output", () => {
  it("renders node type + title + body (Req 5.1/5.2)", () => {
    const markup = renderToStaticMarkup(
      <BlueprintWallGraphNodeCard
        data={makeCardData({
          type: "spec_node",
          title: "My Spec",
          body: "spec body",
        })}
      />
    );

    expect(markup).toContain('data-node-type="spec_node"');
    expect(markup).toContain("My Spec");
    expect(markup).toContain("spec body");
  });

  it("omits the body block when body is undefined but still shows the title (Req 5.2)", () => {
    const markup = renderToStaticMarkup(
      <BlueprintWallGraphNodeCard
        data={makeCardData({ type: "reasoning", title: "Thinking" })}
      />
    );

    // Title still renders.
    expect(markup).toContain("Thinking");
    // No fabricated body text: the only text content beyond the type/status
    // labels is the title. "undefined" must never leak into the markup.
    expect(markup).not.toContain("undefined");
  });

  it("renders the status data attribute and status badge for each status (Req 5.7)", () => {
    const statuses: BlueprintFlowGraphNodeData["status"][] = [
      "active",
      "completed",
      "failed",
    ];

    for (const status of statuses) {
      const markup = renderToStaticMarkup(
        <BlueprintWallGraphNodeCard data={makeCardData({ status })} />
      );

      expect(markup).toContain(`data-node-status="${status}"`);
      expect(markup).toContain(`data-node-status-badge="${status}"`);
    }
  });

  it("renders every one of the 9 node types without throwing (Req 5.3)", () => {
    const types = Object.keys(
      NODE_TYPE_VISUAL
    ) as BlueprintFlowGraphNodeData["type"][];

    // Guard the assumption that NODE_TYPE_VISUAL covers all 9 node types.
    expect(types).toHaveLength(9);

    for (const type of types) {
      const markup = renderToStaticMarkup(
        <BlueprintWallGraphNodeCard
          data={makeCardData({ type, title: `title-${type}` })}
        />
      );

      expect(markup).toContain(`data-node-type="${type}"`);
      expect(markup).toContain(`title-${type}`);
    }
  });

  it("renders a browser preview node with its url text (Req 5.5)", () => {
    const previewSummary: BlueprintWallPreviewSummary = {
      status: "ready",
      kind: "browser",
      previewId: "p1",
      title: "App",
      url: "https://example.com/app",
    };

    const markup = renderToStaticMarkup(
      <BlueprintWallGraphNodeCard
        data={makeCardData({ type: "preview", title: "Preview" })}
        previewSummary={previewSummary}
      />
    );

    expect(markup).toContain('data-preview-kind="browser"');
    expect(markup).toContain("https://example.com/app");
  });

  it("renders an architecture preview node (Req 5.5)", () => {
    const previewSummary: BlueprintWallPreviewSummary = {
      status: "ready",
      kind: "architecture",
      previewId: "p2",
      title: "Arch",
    };

    const markup = renderToStaticMarkup(
      <BlueprintWallGraphNodeCard
        data={makeCardData({ type: "preview", title: "Preview" })}
        previewSummary={previewSummary}
      />
    );

    expect(markup).toContain('data-preview-kind="architecture"');
  });

  it("renders an empty preview marker for undefined and explicit-empty previewSummary without throwing (Req 5.6/3.6)", () => {
    // Undefined previewSummary must not throw and falls back to the empty marker.
    const undefinedMarkup = renderToStaticMarkup(
      <BlueprintWallGraphNodeCard
        data={makeCardData({ type: "preview", title: "Preview" })}
      />
    );
    expect(undefinedMarkup).toContain('data-preview-kind="empty"');

    // Explicit empty previewSummary also renders the empty marker.
    const emptySummary: BlueprintWallPreviewSummary = {
      status: "empty",
      kind: "none",
      title: "x",
    };
    const emptyMarkup = renderToStaticMarkup(
      <BlueprintWallGraphNodeCard
        data={makeCardData({ type: "preview", title: "Preview" })}
        previewSummary={emptySummary}
      />
    );
    expect(emptyMarkup).toContain('data-preview-kind="empty"');
  });

  it("does not fabricate a thumbnail: <img> only renders when thumbnailUrl is supplied (Req 5.6)", () => {
    // Browser preview WITHOUT thumbnailUrl → no <img> tag.
    const withoutThumb: BlueprintWallPreviewSummary = {
      status: "ready",
      kind: "browser",
      previewId: "p1",
      title: "App",
      url: "https://example.com/app",
    };
    const withoutThumbMarkup = renderToStaticMarkup(
      <BlueprintWallGraphNodeCard
        data={makeCardData({ type: "preview", title: "Preview" })}
        previewSummary={withoutThumb}
      />
    );
    expect(withoutThumbMarkup).not.toContain("<img");

    // Browser preview WITH thumbnailUrl → <img> with the src renders.
    const withThumb: BlueprintWallPreviewSummary = {
      status: "ready",
      kind: "browser",
      previewId: "p1",
      title: "App",
      url: "https://example.com/app",
      thumbnailUrl: "https://x/t.png",
    };
    const withThumbMarkup = renderToStaticMarkup(
      <BlueprintWallGraphNodeCard
        data={makeCardData({ type: "preview", title: "Preview" })}
        previewSummary={withThumb}
      />
    );
    expect(withThumbMarkup).toContain("<img");
    expect(withThumbMarkup).toContain("https://x/t.png");
  });
});
