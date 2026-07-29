/**
 * 手机档列表的三个体验增强（2026-07-28）：搜索 / 左滑 / 下拉刷新。
 *
 * 没有 jsdom，这里锁的是源码里那几条**容易被后来人"顺手补齐"而变成假动作**
 * 的约定，配合真机截图使用：
 *
 *  1. 搜不到 ≠ 没有数据。两种空态文案必须分开，否则用户以为数据丢了。
 *  2. 下拉刷新在没有 onRefresh 时必须禁用。运行时数据在本地、没有可刷新的
 *     来源，接一个什么都不做的刷新比没有更糟——用户会以为看到的是最新的。
 *  3. 给了左滑就不再渲染行内按钮，否则同一个操作在一行里出现两次。
 */
import { describe, it, expect } from "vitest";

const listSrc = await import("../phone-mobile/PhonePageList.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const screenSrc = await import("../AppRuntimeScreen.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);

describe("搜索", () => {
  it("空态分两种：本来没有 vs 搜没了", () => {
    // 2026-07-29 两处都从手搓灰字 div 换成了 ErrorBlock（插画 + 标题 + 描述）。
    // 文案本身是这条约定的实质，跟着组件一起搬，不能在换组件时丢掉。
    expect(listSrc).toContain("还没有数据");
    expect(listSrc).toContain("写入第一条真实数据");
    expect(listSrc).toContain('data-testid="phone-list-no-match"');
    expect(listSrc).toContain("没有匹配");
    // 搜没了的文案要告诉用户总共有多少条，否则"没有匹配"看着像数据没了
    expect(listSrc).toContain("可看全部");
  });

  it("空态用 ErrorBlock 不用 Empty —— 源码里 Empty 已标 @deprecated", () => {
    expect(listSrc).toContain("ErrorBlock");
    expect(listSrc).toMatch(/status="empty"/);
    // 默认文案是「暂无数据」，说不清为什么没有；两处都必须自带 title
    expect(listSrc).toMatch(/title=/);
  });

  it("行数少时不出搜索框（3 行配一个搜索框是噪声）", () => {
    expect(listSrc).toContain("rows.length >= 6");
  });
});

describe("下拉刷新", () => {
  it("没有 onRefresh 就禁用 —— 不做假动作", () => {
    expect(listSrc).toContain("disabled={!onRefresh}");
  });

  it("父层当前没有接 onRefresh（本地数据无处可刷）", () => {
    // 这条不是"永远不许接"，是记录当前的决定：真接上服务端刷新时改这里，
    // 并且要同时给 onRefresh 一个真实现，而不是给个空函数把红消掉。
    expect(screenSrc).not.toContain("onRefresh={");
  });
});

describe("左滑", () => {
  it("有左滑时不重复渲染行内按钮", () => {
    expect(listSrc).toContain("renderRowActions && !swipeActions");
  });

  it("左滑与行内按钮共用同一套 handler", () => {
    // 删除走同一个 deleteRow、提交审批走同一个 handleSubmitToWorkflow——
    // 两条路径各写一份的话，改了一处另一处会悄悄留在旧行为上。
    expect(screenSrc).toContain("swipeActions={row =>");
    expect(screenSrc).toContain("handleSubmitToWorkflow");
    expect(screenSrc).toContain("deleteRow(state, page.entityId!, r.id)");
  });
});

describe("antd-mobile 仍只走懒加载", () => {
  it("新增的三个组件没有把 antd-mobile 拉进主文件的静态依赖图", () => {
    expect(screenSrc).not.toMatch(/^import .* from "antd-mobile"/m);
    for (const name of ["PhoneKanban", "PhoneCalendar", "PhonePageSections"])
      expect(screenSrc).toContain(`import("./phone-mobile/${name}")`);
  });
});
