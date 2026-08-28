/**
 * 「先别往下跑」这条链不许有半截（2026-08-28 接线）。
 *
 * ## 为什么判据长这样
 *
 * 这条链跨了六个文件：卡片 → ComposerDock → 页面 → 会话钩子 → 流事件 →
 * 后端路由。**任何一处没接，按钮要么不出现、要么按了没反应，而且不会报错**
 * ——正是本仓数过十次以上的形状（CLAUDE.md §3：函数写对了 ≠ 它被调用了）。
 *
 * 组件层测不到真正的按下（要真跑一轮推演 + SSE），所以判据落在**接线本身**：
 * 每一段都得有，缺一段当场红。
 *
 * ## ⚠ 「暂停」和「停止」必须分得开
 *
 * 停止 = 取消：这一轮判死、白烧（真机实测 publishClosure=null、
 * modelVersions=0）。暂停 = 停住等人：答完/超时/没人在场都会接着跑到最后
 * 一步，闭环照样绿。两颗按钮长得像就会有人按错，而按错的代价是三分钟。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const here = (p: string) => resolve(__dirname, p);

/** 剥掉注释再找：本仓踩过"判据 grep 到的词其实在注释里"。 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const CARD = () => code(here("../AssumptionStrip.tsx"));
const DOCK = () => code(here("../ComposerDock.tsx"));
const PAGE = () => code(here("../../SlideRule.tsx"));
const HOOK = () => code(here("../useSlideRuleSession.ts"));
const STREAM = () => code(here("../../../lib/sliderule-marathon-driver.ts"));

describe("六段接线一段都不能少", () => {
  it("卡片上有那颗按钮，且只在跑着且没停时出现", () => {
    const c = CARD();
    expect(c).toContain("sliderule-assumption-hold");
    expect(c).toContain("onHold");
    // 跑完了没什么可停的；已经停住了再按也没有第二道闸
    expect(c).toContain("isRunning && !paused");
  });

  it("ComposerDock 把两个值透下去了", () => {
    const d = DOCK();
    expect(d).toContain("onHoldRun");
    expect(d).toContain("runPaused");
    expect(d).toContain("onHold={onHoldRun}");
    expect(d).toContain("paused={runPaused}");
  });

  it("页面把钩子的值接到了 ComposerDock 上", () => {
    const p = PAGE();
    expect(p).toContain("onHoldRun={holdRun}");
    expect(p).toContain("runPaused={runPaused}");
  });

  it("钩子真的发请求，且发的是 hold 不是 cancel", () => {
    const h = HOOK();
    expect(h).toContain("/hold");
    expect(h).toContain("/release");
    // ⚠ 反向判据：暂停绝不能走到取消那条路上去
    const at = h.indexOf("const holdRun");
    const body = h.slice(at, at + 900);
    expect(body).not.toContain("DELETE");
    expect(body).toContain("POST");
  });

  it("流事件两端都认（started 与 ended）", () => {
    const s = STREAM();
    expect(s).toContain("run_pause_started");
    expect(s).toContain("run_pause_ended");
    expect(s).toContain("onRunPause");
    // 钩子接了这个回调，否则事件到了没人听
    expect(HOOK()).toContain("onRunPause:");
  });

  it("停住时点「就这样」/「改成 X」会放行，不让它干等满预算", () => {
    const h = HOOK();
    expect(h).toContain("releaseRun({ skip: true })");
    expect(h).toContain("releaseRun({ answer:");
  });
});

describe("暂停不是停止", () => {
  it("按钮文案分得开", () => {
    const c = CARD();
    expect(c).toContain("先别往下跑");
    // 卡片上不许出现"停止/取消"字样——那是另一颗按钮的活
    expect(c).not.toContain("停止推演");
  });

  it("钩子里暂停失败是静默降级，不许把跑着的推演带崩", () => {
    const h = HOOK();
    const at = h.indexOf("const holdRun");
    const body = h.slice(at, at + 900);
    expect(body).toContain("catch");
    expect(body).toContain("return false");
  });
});
