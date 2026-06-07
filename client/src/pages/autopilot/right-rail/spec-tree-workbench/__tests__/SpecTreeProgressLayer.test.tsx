/**
 * spec-generation-perceived-performance / Task 3.2
 *
 * SpecTreeProgressLayer 单测。
 *
 * 实现口径（与本目录其它子组件测试一致 —— SpecTreeChip / SpecDocPreviewBlock）：
 * 本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`，
 * 因此采用 `renderToStaticMarkup` + 字符串断言。`SpecTreeProgressLayer`
 * 是纯函数组件（无 useState / useEffect），SSR 即可完整反映其渲染契约。
 *
 * 覆盖（_Requirements: 1.2, 5.2_）：
 * - `data-testid="spec-tree-progress-layer"` 始终存在；
 * - `data-progress-kind` 在 has-progress / no-progress 间正确切换：
 *     determinate（progress 且 total > 0）/ skeleton（total <= 0）/
 *     indeterminate（progress 缺失或为 null）；
 * - 文案随 locale（zh-CN / en-US）切换。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpecTreeProgressLayer } from "../SpecTreeProgressLayer";

describe("SpecTreeProgressLayer", () => {
  // ─── data-progress-kind 切换 ────────────────────────────────────────────

  describe("data-progress-kind 在有/无 progress 时正确切换", () => {
    it("progress 且 total > 0 → determinate", () => {
      const markup = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="zh-CN"
          scope="all"
          progress={{ processed: 2, total: 5 }}
        />
      );
      expect(markup).toContain('data-testid="spec-tree-progress-layer"');
      expect(markup).toContain('data-progress-kind="determinate"');
      // determinate 下渲染真实进度条 + 计数
      expect(markup).toContain('data-testid="spec-tree-progress-bar-determinate"');
      expect(markup).toContain('data-testid="spec-tree-progress-count"');
      expect(markup).toContain("2 / 5");
      // 40% 进度宽度
      expect(markup).toContain("width:40%");
    });

    it("progress 但 total <= 0（已触发、尚无总数）→ skeleton", () => {
      const markup = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="zh-CN"
          scope="all"
          progress={{ processed: 0, total: 0 }}
        />
      );
      expect(markup).toContain('data-testid="spec-tree-progress-layer"');
      expect(markup).toContain('data-progress-kind="skeleton"');
      // skeleton 退化为 indeterminate 条，不渲染 determinate 条 / 计数
      expect(markup).not.toContain('data-testid="spec-tree-progress-bar-determinate"');
      expect(markup).not.toContain('data-testid="spec-tree-progress-count"');
      expect(markup).toContain('data-testid="spec-tree-progress-bar-indeterminate"');
    });

    it("progress 缺失（undefined）→ indeterminate", () => {
      const markup = renderToStaticMarkup(
        <SpecTreeProgressLayer locale="zh-CN" scope="all" />
      );
      expect(markup).toContain('data-testid="spec-tree-progress-layer"');
      expect(markup).toContain('data-progress-kind="indeterminate"');
      expect(markup).toContain('data-testid="spec-tree-progress-bar-indeterminate"');
      expect(markup).not.toContain('data-testid="spec-tree-progress-bar-determinate"');
    });

    it("progress 为 null → indeterminate", () => {
      const markup = renderToStaticMarkup(
        <SpecTreeProgressLayer locale="zh-CN" scope="single" progress={null} />
      );
      expect(markup).toContain('data-progress-kind="indeterminate"');
      expect(markup).toContain('data-testid="spec-tree-progress-bar-indeterminate"');
    });

    it("骨架占位行始终渲染（不 blank-out 既有内容，R2.11）", () => {
      const markup = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="zh-CN"
          scope="all"
          progress={{ processed: 1, total: 3 }}
        />
      );
      expect(markup).toContain('data-testid="spec-tree-progress-skeleton"');
    });

    it("scope 透传到 data-scope", () => {
      const allMarkup = renderToStaticMarkup(
        <SpecTreeProgressLayer locale="zh-CN" scope="all" />
      );
      const singleMarkup = renderToStaticMarkup(
        <SpecTreeProgressLayer locale="zh-CN" scope="single" />
      );
      expect(allMarkup).toContain('data-scope="all"');
      expect(singleMarkup).toContain('data-scope="single"');
    });
  });

  // ─── 文案随 locale 切换 ─────────────────────────────────────────────────

  describe("文案随 locale 切换", () => {
    it("determinate + scope=all：zh-CN 文案", () => {
      const markup = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="zh-CN"
          scope="all"
          progress={{ processed: 1, total: 4 }}
        />
      );
      expect(markup).toContain("正在生成整棵树文档…");
      expect(markup).not.toContain("Generating all spec docs…");
    });

    it("determinate + scope=all：en-US 文案", () => {
      const markup = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="en-US"
          scope="all"
          progress={{ processed: 1, total: 4 }}
        />
      );
      expect(markup).toContain("Generating all spec docs…");
      expect(markup).not.toContain("正在生成整棵树文档…");
    });

    it("determinate + scope=single：zh-CN / en-US 文案", () => {
      const zh = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="zh-CN"
          scope="single"
          progress={{ processed: 1, total: 2 }}
        />
      );
      const en = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="en-US"
          scope="single"
          progress={{ processed: 1, total: 2 }}
        />
      );
      expect(zh).toContain("正在生成当前节点文档…");
      expect(en).toContain("Generating current node doc…");
    });

    it("skeleton 档（total<=0）保留 scope 文案：zh-CN / en-US", () => {
      const zh = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="zh-CN"
          scope="all"
          progress={{ processed: 0, total: 0 }}
        />
      );
      const en = renderToStaticMarkup(
        <SpecTreeProgressLayer
          locale="en-US"
          scope="all"
          progress={{ processed: 0, total: 0 }}
        />
      );
      expect(zh).toContain("正在生成整棵树文档…");
      expect(en).toContain("Generating all spec docs…");
    });

    it("indeterminate 档（progress 缺失）使用 preparing 文案：zh-CN / en-US", () => {
      const zh = renderToStaticMarkup(
        <SpecTreeProgressLayer locale="zh-CN" scope="all" />
      );
      const en = renderToStaticMarkup(
        <SpecTreeProgressLayer locale="en-US" scope="all" />
      );
      expect(zh).toContain("正在准备…");
      expect(en).toContain("Preparing…");
    });
  });
});
