/**
 * `autopilot-llm-spec-generation` Task 12.6 (Quality Uplift Wave)：
 * `buildSpecMarkdownPreview` 的纯函数单元测试。
 *
 * 覆盖：
 * - 空 / undefined 输入
 * - 没有 H2 的 markdown
 * - 有 H2 + 多行段落
 * - H2 后立即出现下一个 H2 / H3（应停止）
 * - 段落超过 3 行时只取前 3 行
 * - 列表项按一行算一行
 */

import { describe, expect, it } from "vitest";

import { buildSpecMarkdownPreview } from "../specMarkdownPreview";

describe("buildSpecMarkdownPreview", () => {
  it("undefined / 空字符串：返回空预览", () => {
    expect(buildSpecMarkdownPreview(undefined)).toEqual({
      firstH2: undefined,
      paragraphLines: [],
    });
    expect(buildSpecMarkdownPreview("")).toEqual({
      firstH2: undefined,
      paragraphLines: [],
    });
  });

  it("没有 H2：firstH2 为 undefined，paragraphLines 为空", () => {
    const md = "# Top heading only\n\nsome text\n";
    expect(buildSpecMarkdownPreview(md)).toEqual({
      firstH2: undefined,
      paragraphLines: [],
    });
  });

  it("有 H2 + 普通段落：取首个 H2 + 前 3 行非空文本", () => {
    const md = [
      "# 需求文档：Foo",
      "",
      "## 简介",
      "",
      "Foo 模块的总览。",
      "",
      "用于支撑下游消费方。",
      "",
      "依赖 X 与 Y。",
      "",
      "## 术语表",
      "",
      "- A: B",
    ].join("\n");
    const preview = buildSpecMarkdownPreview(md);
    expect(preview.firstH2).toBe("简介");
    expect(preview.paragraphLines).toEqual([
      "Foo 模块的总览。",
      "用于支撑下游消费方。",
      "依赖 X 与 Y。",
    ]);
  });

  it("H2 后立即出现下一个标题：paragraphLines 为空", () => {
    const md = ["## 简介", "## 术语表", "- A: B"].join("\n");
    expect(buildSpecMarkdownPreview(md)).toEqual({
      firstH2: "简介",
      paragraphLines: [],
    });
  });

  it("段落超过 3 行：只取前 3 行", () => {
    const md = [
      "## 概述",
      "row 1",
      "row 2",
      "row 3",
      "row 4",
      "row 5",
    ].join("\n");
    const preview = buildSpecMarkdownPreview(md);
    expect(preview.firstH2).toBe("概述");
    expect(preview.paragraphLines).toEqual(["row 1", "row 2", "row 3"]);
  });

  it("列表项与普通段落混合：一行算一行", () => {
    const md = [
      "## Tasks",
      "- [ ] 1. step a",
      "- [ ] 2. step b",
      "- [ ] 3. step c",
      "- [ ] 4. step d",
    ].join("\n");
    const preview = buildSpecMarkdownPreview(md);
    expect(preview.firstH2).toBe("Tasks");
    expect(preview.paragraphLines).toEqual([
      "- [ ] 1. step a",
      "- [ ] 2. step b",
      "- [ ] 3. step c",
    ]);
  });
});
