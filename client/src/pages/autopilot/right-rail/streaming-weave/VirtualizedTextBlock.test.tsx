/**
 * VirtualizedTextBlock 单元测试
 *
 * 验证虚拟化长文本块组件的核心行为：
 * - 短文本（≤1000 字符）不应用虚拟化样式
 * - 长文本（>1000 字符）应用 content-visibility: auto
 * - 支持 children 优先渲染
 * - 支持自定义 className
 *
 * 使用 react-dom/server 的 renderToString 进行 SSR 渲染验证，
 * 不引入 @testing-library/react。
 */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VirtualizedTextBlock } from "./VirtualizedTextBlock";

describe("VirtualizedTextBlock", () => {
  it("短文本不应用虚拟化样式", () => {
    const shortText = "Hello World";
    const html = renderToString(
      <VirtualizedTextBlock text={shortText} />
    );

    // 不应包含 content-visibility 样式
    expect(html).not.toContain("content-visibility");
    expect(html).toContain("Hello World");
  });

  it("超过 1000 字符的文本应用虚拟化样式", () => {
    const longText = "a".repeat(1001);
    const html = renderToString(
      <VirtualizedTextBlock text={longText} />
    );

    // 应包含 content-visibility 样式
    expect(html).toContain("content-visibility:auto");
    expect(html).toContain("contain-intrinsic-size:auto 20px");
  });

  it("恰好 1000 字符不应用虚拟化样式", () => {
    const exactText = "b".repeat(1000);
    const html = renderToString(
      <VirtualizedTextBlock text={exactText} />
    );

    expect(html).not.toContain("content-visibility");
  });

  it("支持自定义 className", () => {
    const html = renderToString(
      <VirtualizedTextBlock text="test" className="my-custom-class" />
    );

    expect(html).toContain("my-custom-class");
  });

  it("children 优先于 text 渲染", () => {
    const html = renderToString(
      <VirtualizedTextBlock text="should not appear">
        <span>child content</span>
      </VirtualizedTextBlock>
    );

    expect(html).toContain("child content");
    expect(html).not.toContain("should not appear");
  });

  it("长文本带 children 时仍应用虚拟化样式", () => {
    const longText = "c".repeat(1500);
    const html = renderToString(
      <VirtualizedTextBlock text={longText}>
        <p>streaming content</p>
      </VirtualizedTextBlock>
    );

    expect(html).toContain("content-visibility:auto");
    expect(html).toContain("streaming content");
  });
});
