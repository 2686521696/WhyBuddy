import { describe, expect, it } from "vitest";
import screenSrc from "../AppRuntimeScreen.tsx?raw";
import { pageFreeformOwnsContent } from "../app-runtime-schema";
import type { AppPageSchema } from "../app-runtime-schema";

/**
 * 设计独占的页不套外层 Card（2026-08-12）。
 *
 * 用户看着 HTML 还原产物说的：「它最外层包了一层 Card，其实这个地方是不用包
 * 卡片的，像首页基本上就是数据展示」。
 *
 * 那张卡带着页标题、示例数据徽标、列设置齿轮和「新建」按钮，对总览页全是多余：
 * 标题让同一个词在一屏出现三次（面包屑 / 卡标题 / 设计稿自己的页头）；
 * 「新建」在总览页没有对应动作；卡片边框让设计稿的卡变成卡里套卡。
 *
 * 更要紧的是边界：`freeformOwnsPage` 的语义就是"这一页归设计"，那这一页的
 * **外框**也不该由运行时替它决定。
 */

const page = (over: Partial<AppPageSchema> = {}) =>
  ({
    presentation: "application",
    view: { kind: "monitor" },
    ...over,
  }) as AppPageSchema;

describe("两种载体都算「设计独占这一页」", () => {
  it("受限树载体", () => {
    expect(pageFreeformOwnsContent(page({ freeformOverview: { root: {} } }))).toBe(true);
  });

  it("**HTML 载体** —— 加载体时漏了这一处，用户看到的那圈壳就是它", () => {
    expect(
      pageFreeformOwnsContent(
        page({ freeformOverviewHtml: { html: "<div>x</div>", facts: [], charts: [] } })
      ),
      "HTML 载体不算独占 —— 外层 Card 会照样套上去"
    ).toBe(true);
  });

  it("页型对不上就不算 —— 业务页的 Card 是真在用的", () => {
    expect(
      pageFreeformOwnsContent(
        page({ view: { kind: "workbench" }, freeformOverviewHtml: { html: "<div/>", facts: [], charts: [] } })
      )
    ).toBe(false);
  });

  it("空 HTML 不算 —— 有字段不等于有内容", () => {
    expect(
      pageFreeformOwnsContent(page({ freeformOverviewHtml: { html: "", facts: [], charts: [] } }))
    ).toBe(false);
  });
});

describe("接线", () => {
  it("独占时走裸内容，不走带 Card 的 defaultPageContent", () => {
    expect(
      screenSrc,
      "pageContent 还是无条件用 defaultPageContent —— Card 去不掉"
    ).toContain("(freeformOwnsPage && freeformOverviewBare) || defaultPageContent");
  });

  it("**兜底不能省** —— 独占但内容没出来时整页会空掉", () => {
    // 生成失败 / 快照缺字段都会走到这一支。fail-open 是这条链路一贯的纪律：
    // 增强项出问题，退回骨架，不能让页面白掉。
    const i = screenSrc.indexOf("(freeformOwnsPage && freeformOverviewBare)");
    const tail = screenSrc.slice(i, i + 120);
    expect(tail, "没有 || defaultPageContent 兜底").toContain("|| defaultPageContent");
  });
});
