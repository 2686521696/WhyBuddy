/**
 * `derive-chapter-checklist` 派生纯函数单测。
 *
 * 覆盖：仅二级标题入选、空内容章节为未完成、连续二级标题之间夹杂代码块 / 列表 / 段落的混合输入、
 * id 生成规则、忽略 # / ### / #### 层级标题。
 */
import { describe, it, expect } from "vitest";
import { deriveChapterChecklist } from "../derive-chapter-checklist";

describe("deriveChapterChecklist", () => {
  it("空字符串返回空数组", () => {
    expect(deriveChapterChecklist("")).toEqual([]);
  });

  it("仅包含 # H1 和 ### H3 标题（无 ## ）时返回空数组", () => {
    const md = [
      "# Top Level Heading",
      "Some content",
      "### Sub Heading",
      "More content",
      "#### Deep Heading",
      "Even more content",
    ].join("\n");
    expect(deriveChapterChecklist(md)).toEqual([]);
  });

  it("单个 ## Section 后跟段落内容时返回 completed: true", () => {
    const md = [
      "## Section",
      "This is a paragraph with content.",
    ].join("\n");
    const result = deriveChapterChecklist(md);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "section",
      title: "Section",
      completed: true,
    });
  });

  it("连续两个 ## 标题之间无内容时第一个为 completed: false", () => {
    const md = [
      "## Section1",
      "## Section2",
      "Some content here",
    ].join("\n");
    const result = deriveChapterChecklist(md);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "section1",
      title: "Section1",
      completed: false,
    });
    expect(result[1]).toEqual({
      id: "section2",
      title: "Section2",
      completed: true,
    });
  });

  it("## Section 后仅有空白行时返回 completed: false", () => {
    const md = [
      "## Section",
      "",
      "   ",
      "\t",
      "",
    ].join("\n");
    const result = deriveChapterChecklist(md);
    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(false);
  });

  it("## Section 后跟代码块时返回 completed: true", () => {
    const md = [
      "## Section",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");
    const result = deriveChapterChecklist(md);
    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(true);
  });

  it("## Section 后跟列表时返回 completed: true", () => {
    const md = [
      "## Section",
      "",
      "- item 1",
      "- item 2",
    ].join("\n");
    const result = deriveChapterChecklist(md);
    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(true);
  });

  it("混合输入：## A (有内容) → ## B (空) → ## C (有内容)", () => {
    const md = [
      "## A",
      "Content for A",
      "",
      "## B",
      "",
      "## C",
      "- list item",
      "```",
      "code",
      "```",
    ].join("\n");
    const result = deriveChapterChecklist(md);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: "a", title: "A", completed: true });
    expect(result[1]).toEqual({ id: "b", title: "B", completed: false });
    expect(result[2]).toEqual({ id: "c", title: "C", completed: true });
  });

  describe("id 生成规则", () => {
    it("## Hello World → id 为 hello-world", () => {
      const md = "## Hello World\nSome content";
      const result = deriveChapterChecklist(md);
      expect(result[0].id).toBe("hello-world");
    });

    it("##  Multiple   Spaces  → id 中连续空格替换为连续连字符", () => {
      const md = "##  Multiple   Spaces \nSome content";
      const result = deriveChapterChecklist(md);
      // title.trim() → "Multiple   Spaces"
      // .toLowerCase() → "multiple   spaces"
      // .replace(/\s+/g, "-") → "multiple-spaces"
      expect(result[0].id).toBe("multiple-spaces");
      expect(result[0].title).toBe("Multiple   Spaces");
    });

    it("标题含大写字母时 id 全部转为小写", () => {
      const md = "## CamelCase Title\nContent";
      const result = deriveChapterChecklist(md);
      expect(result[0].id).toBe("camelcase-title");
    });
  });

  it("# Top Level 和 ### Sub 和 #### Deep 全部被忽略，仅 ## 产生项", () => {
    const md = [
      "# Top Level",
      "intro",
      "## Real Section",
      "content",
      "### Sub Section",
      "sub content",
      "#### Deep Section",
      "deep content",
      "## Another Real",
      "more content",
    ].join("\n");
    const result = deriveChapterChecklist(md);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Real Section");
    expect(result[0].completed).toBe(true);
    expect(result[1].title).toBe("Another Real");
    expect(result[1].completed).toBe(true);
  });
});
