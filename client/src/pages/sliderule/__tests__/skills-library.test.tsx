/**
 * 技能库页面静态渲染回归。
 * 锁：合规标注（来源回链 + 版权说明 + 采集时间）必须在页面上；
 * 渠道分档筛选齐全；表格出真实索引数据（标题即原帖外链）。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsLibraryPage } from "../SkillsLibraryPage";
import skillsIndex from "@/data/trae-skills-index.json";

describe("SkillsLibraryPage", () => {
  const html = renderToStaticMarkup(<SkillsLibraryPage />);

  it("合规标注齐全：来源回链、版权说明、采集时间、总数", () => {
    expect(html).toContain("forum.trae.cn/c/37-category/37");
    expect(html).toContain("技能本体归原作者所有");
    expect(html).toContain(String(skillsIndex.count));
    expect(html).toContain(skillsIndex.fetchedAt.slice(0, 10));
  });

  it("渠道分档筛选四类齐全", () => {
    for (const label of ["开源仓库", "网盘分发", "论坛附件", "图文介绍"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('data-testid="skills-kind-filter"');
    expect(html).toContain('data-testid="skills-search"');
  });

  it("表格行是真实索引数据：标题渲染为原帖外链", () => {
    // 默认按浏览量降序，首页 20 行里必有浏览量最高的条目
    const top = [...skillsIndex.items].sort((a, b) => b.views - a.views)[0];
    expect(html).toContain(`href="${top.url}"`);
  });
});
