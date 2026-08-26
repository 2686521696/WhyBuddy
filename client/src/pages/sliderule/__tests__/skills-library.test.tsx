/**
 * 技能库静态渲染回归。
 *
 * 原本这里有 5 条断言锁的是「社区技能」层：合规标注、渠道分档筛选、
 * 索引表格行、语义档案安装钮。该层连同 889 条论坛索引、855 份完整
 * SKILL.md 正文、543 份语义档案一并下架（协议敞口 + 装了绑不上 aigc
 * 硬契约），断言随之移除，并留一条哨兵防止数据被重新引入。
 *
 * 2026-08-26 版式按效果图重做（顶栏 + 分类条 + 一行四个卡片墙 + 圆钮装卸），
 * tab / 统计卡那批断言换成新结构，并且每条正向断言都配一条反向的——
 * 这一页历史上出过两次"名单里有名字但埋点没了"。
 */
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsLibraryPage } from "../SkillsLibraryPage";

import featuredSkills from "@/data/featured-skills.json";

const ITEMS = (
  featuredSkills as {
    items: Array<{ id: string; name: string; author: string; category: string }>;
  }
).items;

/** node 环境没有 localStorage；已安装那一段只能靠它喂。 */
function stubStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

beforeEach(() => stubStorage());

describe("SkillsLibraryPage · 目录", () => {
  const html = () => renderToStaticMarkup(<SkillsLibraryPage />);

  it("一行四个的卡片墙，卡上是真数据（名字/作者/分类）", () => {
    const h = html();
    expect(h).toContain('data-testid="skills-featured-grid"');
    expect(h).toContain("xl:grid-cols-4");
    const first = ITEMS[0];
    expect(h).toContain(`data-testid="featured-skill-${first.id}"`);
    // 分类跟作者拼在底行（不摆在名字那一行——一行四个之后名字只剩 ~215px，
    // 再塞一枚分类标会让 79 条里 78 条的名字都出省略号，真机量过）
    expect(h).toContain(`${first.category} · by ${first.author}`);
    expect(h).toContain('data-testid="skill-meta"');
    expect(h).toContain('data-testid="skills-search"');
    expect(h).toContain('data-testid="skills-mine"');
    // 计数照实数，不写死
    expect(h).toContain(`${ITEMS.length} 项`);
  });

  it("旧版式的 tab 与统计卡都已撤掉（换成段落式的两段）", () => {
    const h = html();
    expect(h).not.toContain('data-testid="skills-tab-featured"');
    expect(h).not.toContain('data-testid="skills-tab-installed"');
    expect(h).not.toContain('data-testid="skills-stat-精选技能"');
    // 换上的是段标题
    expect(h).toContain('data-testid="skills-section-featured"');
  });

  it("分类条只列数据里真有的分类 —— 效果图上那几个我们没有的不许摆", () => {
    const h = html();
    expect(h).toContain('data-testid="skills-cats"');
    const cats = [...h.matchAll(/data-cat="([^"]+)"/g)].map(m => m[1]);
    const real = new Set(ITEMS.map(i => i.category));
    expect(cats[0]).toBe("全部");
    for (const c of cats.slice(1)) {
      expect(real.has(c), `分类条上的「${c}」在数据里一条技能都没有`).toBe(true);
    }
    expect(cats.length).toBe(real.size + 1);
    // 效果图上的分类（我们没有对应技能），摆上去点进去必然是空的
    for (const fake of ["金融", "法律", "办公协作", "设计开发"]) {
      expect(h).not.toContain(`data-cat="${fake}"`);
    }
  });

  it("没有「新建技能」——自建这条链路不存在，不放打不开任何东西的按钮", () => {
    expect(html()).not.toContain("新建技能");
  });

  it("每张卡都标出消费通道 —— 装之前就该知道装了会发生什么", () => {
    const h = html();
    expect(h).toContain('data-testid="skill-channel-aigc"');
    expect(h).toContain('data-testid="skill-channel-experience"');
    // unbound 的 31 条已于 2026-07-27 下架（装了不产出任何东西），目录里
    // 不该再有；渲染代码仍支持这个通道，存量安装记录要靠它兜底。
    expect(h).not.toContain('data-testid="skill-channel-unbound"');
    // 「精选」金标只说来源不说用途，已被通道标替掉
    expect(h).not.toContain(">精选<");
  });

  it("图标是真图稿，每张卡一个，且没有一个落到兜底星", () => {
    const h = html();
    const icons = [...h.matchAll(/data-testid="skill-icon"/g)];
    expect(icons.length).toBe(ITEMS.length);
    expect(h).not.toContain('data-art="fallback"');
    expect(h).toContain("linearGradient");
  });

  it("反向：字母头像已经不在了（换成图稿不是「两套并存」）", async () => {
    const src = await import("../SkillsLibraryPage?raw").then(
      m => (m as unknown as { default: string }).default
    );
    expect(src).not.toContain("avatarToneOf");
    expect(src).toContain("SkillIcon");
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

describe("SkillsLibraryPage · 我的技能", () => {
  it("一条没装时：只出空态引导，不再把全部技能也铺一遍", () => {
    const h = renderToStaticMarkup(<SkillsLibraryPage initialMine />);
    expect(h).toContain("还没安装技能");
    expect(h).not.toContain('data-testid="skills-featured-grid"');
    expect(h).not.toContain('data-testid="skills-installed"');
  });

  it("装过之后：已安装段列出它，卡上有试跑入口，目录里那张也翻成已装", () => {
    const target = ITEMS[0];
    stubStorage({
      "sliderule:installed-skills": JSON.stringify([
        {
          repo: `trae-market/${target.id}`,
          url: "",
          license: "官方市场",
          name: target.name,
          description: "装过的那条",
          ioHints: [],
          installedAt: "2026-08-26T00:00:00.000Z",
          kind: "semantic",
          channel: "experience",
        },
      ]),
    });
    const h = renderToStaticMarkup(<SkillsLibraryPage />);
    expect(h).toContain(`data-testid="installed-skill-trae-market/${target.id}"`);
    expect(h).toContain('data-testid="skills-section-installed"');
    expect(h).toContain('data-testid="installed-skill-toggle"');
    // 目录里同一张卡要翻成"已安装"，否则用户会以为没装上又装一遍
    const card = h.slice(h.indexOf(`data-testid="featured-skill-${target.id}"`));
    expect(card.slice(0, 200)).toContain('data-installed="1"');
    // 反向：没装的那条不能也翻绿
    const other = ITEMS.find(i => i.id !== target.id)!;
    const otherCard = h.slice(h.indexOf(`data-testid="featured-skill-${other.id}"`));
    expect(otherCard.slice(0, 200)).toContain('data-installed="0"');
  });

  it("已安装的卡用的是目录里那条的分类图稿，不是兜底星", () => {
    const target = ITEMS[0];
    stubStorage({
      "sliderule:installed-skills": JSON.stringify([
        {
          repo: `trae-market/${target.id}`,
          url: "",
          license: "官方市场",
          name: target.name,
          description: "装过的那条",
          ioHints: [],
          installedAt: "2026-08-26T00:00:00.000Z",
          kind: "semantic",
        },
      ]),
    });
    const h = renderToStaticMarkup(<SkillsLibraryPage initialMine />);
    const seg = h.slice(h.indexOf('data-testid="skills-installed"'));
    expect(seg).toContain(`data-art="${target.category}"`);
    expect(seg.slice(0, 900)).not.toContain('data-art="fallback"');
  });
});
