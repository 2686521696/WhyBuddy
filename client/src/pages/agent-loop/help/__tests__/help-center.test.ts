/** E15 帮助中心：文档清单完整性 + 搜索纯函数。 */
import { describe, it, expect } from "vitest";
import { HELP_DOCS, searchDocs } from "../HelpCenterPage";

describe("HELP_DOCS", () => {
  it("九篇文档齐全，正文非空且带 H1 标题", () => {
    // E36 新增：发布全流程 / 术语表 / 更新日志（生成）
    expect(HELP_DOCS).toHaveLength(9);
    expect(HELP_DOCS.map(d => d.id)).toEqual(
      expect.arrayContaining(["full-flow", "glossary", "changelog"])
    );
    for (const doc of HELP_DOCS) {
      expect(doc.id).toBeTruthy();
      expect(doc.body.trim().startsWith("# ")).toBe(true);
      expect(doc.body.length).toBeGreaterThan(200);
    }
  });

  it("内容红线：不出现旧品牌 AgentLoop（用户裁决全系统统一 SlideRule）", () => {
    for (const doc of HELP_DOCS) {
      expect(doc.body).not.toContain("AgentLoop");
    }
  });
});

describe("searchDocs", () => {
  it("空词返回全部；标题/正文命中；无命中返回空", () => {
    expect(searchDocs(HELP_DOCS, "")).toHaveLength(9);
    const byTitle = searchDocs(HELP_DOCS, "快速上手");
    expect(byTitle.map(d => d.id)).toContain("quick-start");
    const byBody = searchDocs(HELP_DOCS, "五系统模型");
    expect(byBody.length).toBeGreaterThanOrEqual(2); // 概念页+上手页都讲了
    expect(searchDocs(HELP_DOCS, "不存在的词xyzq")).toHaveLength(0);
  });
});
