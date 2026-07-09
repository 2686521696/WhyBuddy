/**
 * 技能库 marketplace 静态渲染回归。
 * 锁：合规标注（来源回链 + 版权说明 + 采集时间）必须在页面上；
 * 双 tab（技能市场/已安装）；渠道分档筛选齐全；表格出真实索引数据
 * （标题即原帖外链）；带语义档案的行出「安装」、纯图文行诚实禁用。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsLibraryPage } from "../SkillsLibraryPage";
import skillsIndex from "@/data/trae-skills-index.json";
import skillSemantics from "@/data/skill-semantics.json";

import featuredSkills from "@/data/featured-skills.json";

describe("SkillsLibraryPage", () => {
  // 市场层断言用 initialTab 直开（静态渲染切不了 tab）；精选层用默认渲染
  const html = renderToStaticMarkup(<SkillsLibraryPage initialTab="market" />);
  const featuredHtml = renderToStaticMarkup(<SkillsLibraryPage />);

  it("精选层（默认 tab）：官方技能卡片网格 + 分类 chips + 统计卡真数据", () => {
    expect(featuredHtml).toContain('data-testid="skills-featured-grid"');
    expect(featuredHtml).toContain('data-testid="skills-featured-cats"');
    const first = (featuredSkills as { items: Array<{ id: string; author: string }> }).items[0];
    expect(featuredHtml).toContain(`data-testid="featured-skill-${first.id}"`);
    expect(featuredHtml).toContain(`by ${first.author}`);
    // 统计卡：精选/社区/已安装为真数据
    expect(featuredHtml).toContain('data-testid="skills-stat-精选技能"');
    expect(featuredHtml).toContain('data-testid="skills-stat-社区技能"');
  });

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

  it("marketplace 双 tab + 安装动作：有语义档案出安装钮，纯图文诚实禁用", () => {
    expect(html).toContain('data-testid="skills-tab"');
    expect(html).toContain("精选技能");
    expect(html).toContain("社区技能");
    expect(html).toContain("已安装 0");
    expect(html).toContain('data-testid="skills-community-grid"');
    // 首页 20 行（按浏览量降序）里既有可安装项也有纯图文项
    const semTopicIds = new Set(
      (skillSemantics as { items: Array<{ description: string; topicIds: number[] }> }).items
        .filter((s) => s.description)
        .flatMap((s) => s.topicIds)
    );
    const top20 = [...skillsIndex.items].sort((a, b) => b.views - a.views).slice(0, 20);
    const installable = top20.filter((it) => semTopicIds.has(it.topicId));
    const notInstallable = top20.filter((it) => !semTopicIds.has(it.topicId));
    if (installable.length > 0) {
      expect(html).toContain(`data-testid="skill-install-${installable[0].topicId}"`);
    }
    // 纯图文帖：安装钮禁用（诚实——没有可执行定义就不装样子）
    if (notInstallable.length > 0) {
      expect(html).toContain(`data-testid="skill-install-disabled-${notInstallable[0].topicId}"`);
    }
  });
});
