/**
 * 技能库静态渲染回归（2026-07-27 起为「精选 / 已安装」两层）。
 *
 * 原本这里有 5 条断言锁的是「社区技能」层：合规标注、渠道分档筛选、
 * 索引表格行、语义档案安装钮。该层连同 889 条论坛索引、855 份完整
 * SKILL.md 正文、543 份语义档案一并下架（协议敞口 + 装了绑不上 aigc
 * 硬契约），断言随之移除，并留一条哨兵防止数据被重新引入。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsLibraryPage } from "../SkillsLibraryPage";

import featuredSkills from "@/data/featured-skills.json";

describe("SkillsLibraryPage", () => {
  const featuredHtml = renderToStaticMarkup(<SkillsLibraryPage />);
  const installedHtml = renderToStaticMarkup(
    <SkillsLibraryPage initialTab="installed" />
  );

  it("精选层（默认 tab）：官方技能卡片网格 + 分类 chips + 统计卡真数据", () => {
    expect(featuredHtml).toContain('data-testid="skills-featured-grid"');
    expect(featuredHtml).toContain('data-testid="skills-featured-cats"');
    const first = (
      featuredSkills as { items: Array<{ id: string; author: string }> }
    ).items[0];
    expect(featuredHtml).toContain(`data-testid="featured-skill-${first.id}"`);
    expect(featuredHtml).toContain(`by ${first.author}`);
    expect(featuredHtml).toContain('data-testid="skills-stat-精选技能"');
    expect(featuredHtml).toContain('data-testid="skills-search"');
  });

  it("每张卡都标出消费通道 —— 装之前就该知道装了会发生什么", () => {
    expect(featuredHtml).toContain('data-testid="skill-channel-aigc"');
    expect(featuredHtml).toContain('data-testid="skill-channel-experience"');
    // unbound 的 31 条已于 2026-07-27 下架（装了不产出任何东西），目录里
    // 不该再有；渲染代码仍支持这个通道，存量安装记录要靠它兜底。
    expect(featuredHtml).not.toContain('data-testid="skill-channel-unbound"');
    // 「精选」金标只说来源不说用途，已被通道标替掉
    expect(featuredHtml).not.toContain(">精选<");
  });

  it("只剩两个 tab，社区层的入口与统计卡都不复存在", () => {
    expect(featuredHtml).toContain('data-testid="skills-tab-featured"');
    expect(featuredHtml).toContain('data-testid="skills-tab-installed"');
    expect(featuredHtml).not.toContain('data-testid="skills-tab-market"');
    // 两个 tab 的可见文案都不能再提「社区技能」——空态引导曾漏改，故两边都锁
    expect(featuredHtml).not.toContain("社区技能");
    expect(installedHtml).not.toContain("社区技能");
    // 合规说明卡是随索引一起存在的，索引没了它也不该再出现
    expect(featuredHtml).not.toContain("技能本体归原作者所有");
    expect(featuredHtml).not.toContain("forum.trae.cn");
  });

  it("标题计数只统计精选，不再把社区索引加进去", () => {
    const count = (featuredSkills as { items: unknown[] }).items.length;
    expect(featuredHtml).toContain(`${count} 项`);
  });

  it("已安装 tab：展示列表区，不展示搜索框（避免无效搜索与条件泄漏）", () => {
    expect(installedHtml).toContain('data-testid="skills-installed"');
    expect(installedHtml).not.toContain('data-testid="skills-search"');
  });

  it("哨兵：社区技能的四份数据不得被重新引入", async () => {
    // 直接 import 已删的 JSON 会在编译期失败，这里断言源码不再引用它们——
    // 重新加回来必须是显式决定（连带重新承担协议敞口），不能悄悄回归。
    const src = await import("../SkillsLibraryPage?raw").then(
      m => (m as unknown as { default: string }).default
    );
    expect(src).not.toContain("trae-skills-index.json");
    expect(src).not.toContain("skill-semantics.json");
  });
});
