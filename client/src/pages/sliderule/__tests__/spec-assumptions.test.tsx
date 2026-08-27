/**
 * 伴随式澄清：推演中「我替你定了什么」。
 *
 * 用户的抱怨是「澄清……不是伴随式的，各个环节都很敷衍」。点火前那一轮问答
 * 只够问粗维度；真正让产品长得不一样的分叉（登录用手机号还是工号、审批
 * 一级还是两级）是**画到 SPEC 那一步才浮出来的**，而它们此前一直是静默的。
 *
 * 这个文件守两件事：
 *   1. 这条链**不产生等待**——推演照跑，用户可以什么都不点；
 *   2. 用户点了「改成 X」，那句话**真的进了中途排队**，不是点了个寂寞。
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssumptionStrip } from "../AssumptionStrip";
import {
  mergeAssumptions,
  revisePhrase,
  settleAssumption,
  type SpecAssumption,
} from "../spec-assumptions";

const LOGIN: SpecAssumption = {
  id: "a1",
  topic: "员工怎么登录",
  decision: "手机号 + 短信验证码",
  alternatives: ["工号 + 密码", "企业微信扫码"],
  why: "需求里没说身份从哪来",
};
const APPROVE: SpecAssumption = {
  id: "a2",
  topic: "审批几级",
  decision: "一级",
  alternatives: [],
  why: "",
};

describe("mergeAssumptions", () => {
  it("按 id 去重——续播会把同一条再送一遍", () => {
    /* ⚠ 这条不是可选的。run_registry.subscribe 从 since 补播整段事件日志：
       刷新页面、切走再回来、网络抖动重连都会重放 spec_assumption。
       不去重的话，用户刷一次页面面板上就多出一整份重复的卡。 */
    const once = mergeAssumptions([], [LOGIN, APPROVE]);
    const twice = mergeAssumptions(once, [LOGIN, APPROVE]);
    expect(twice.map(r => r.id)).toEqual(["a1", "a2"]);
  });

  it("同 id 后到的覆盖先到的，而且留在原位", () => {
    const prev = mergeAssumptions([], [LOGIN, APPROVE]);
    const next = mergeAssumptions(prev, [
      { ...LOGIN, decision: "工号 + 密码" },
    ]);
    /* 位置不许变：一次重连就把面板上的卡重新洗牌，用户正要点的那个跑了 */
    expect(next.map(r => r.id)).toEqual(["a1", "a2"]);
    expect(next[0].decision).toBe("工号 + 密码");
  });

  it("反向：没有 id 的行直接丢，不许摊到面板上", () => {
    const out = mergeAssumptions([], [
      { ...LOGIN, id: "" },
      APPROVE,
    ]);
    expect(out.map(r => r.id)).toEqual(["a2"]);
  });

  it("不改原数组（React state 必须换引用才重渲染）", () => {
    const src = [LOGIN];
    const out = mergeAssumptions(src, [APPROVE]);
    expect(src).toHaveLength(1);
    expect(out).not.toBe(src);
  });
});

describe("revisePhrase", () => {
  it("同时说改成什么、不要什么", () => {
    /* ⚠ 只说"改成工号"，下游读到的是一条追加要求，而原来那条（手机号）
       在上一版 spec 里还立着——真机上出现过两种登录入口并存的页面。
       用户原话本来就是两句一起说的：「不要手机号，改成工号」。 */
    const said = revisePhrase(LOGIN, "工号 + 密码");
    expect(said).toContain("不要手机号 + 短信验证码");
    expect(said).toContain("改成工号 + 密码");
    expect(said).toContain("员工怎么登录");
  });

  it("反向：空选项不生成句子（调用方据此不入队）", () => {
    expect(revisePhrase(LOGIN, "   ")).toBe("");
  });

  it("选的就是已经定的那个 → 只说改成，不说自相矛盾的「不要 X，改成 X」", () => {
    expect(revisePhrase(LOGIN, "手机号 + 短信验证码")).toBe(
      "员工怎么登录：改成手机号 + 短信验证码"
    );
  });
});

describe("settleAssumption", () => {
  it("处理完的收走", () => {
    expect(settleAssumption([LOGIN, APPROVE], "a1").map(r => r.id)).toEqual([
      "a2",
    ]);
  });

  it("反向：不存在的 id 原样返回，不抛", () => {
    expect(settleAssumption([LOGIN], "nope")).toHaveLength(1);
  });
});

describe("面板画出来的东西（量渲染后的 DOM，不量源码）", () => {
  const html = (items: SpecAssumption[]) =>
    renderToStaticMarkup(
      <AssumptionStrip items={items} onSettle={() => {}} onRevise={() => {}} />
    );

  it("每条假设一张卡，其他做法各一个按钮", () => {
    const out = html([LOGIN, APPROVE]);
    expect(out.match(/data-testid="sliderule-assumption"/g)).toHaveLength(2);
    expect(
      out.match(/data-testid="sliderule-assumption-revise"/g)
    ).toHaveLength(2);
    expect(out).toContain("改成工号 + 密码");
    expect(out).toContain("改成企业微信扫码");
  });

  it("没有其他做法的那条不渲染空按钮行", () => {
    /* 模型有时只是知会一声。摆一排空按钮比不摆更糟——看着像坏了。
       ⚠ 第一版判据写的是 `not.toContain("sliderule-assumption-revise")`，
         变异（把 `alternatives.length > 0` 换成恒真）**照样绿**——因为
         空数组 map 出来本来就没有按钮，判据打空了。真正的病是那个
         **空的容器 div** 还在，撑出一行看不出所以然的间距。
         本仓第五条：判据要落在渲染出来的东西上，量容器不量按钮。 */
    const out = html([APPROVE]);
    expect(out).not.toContain("sliderule-assumption-revise");
    expect(out).toContain("审批几级");
    expect(out).not.toMatch(/<div class="[^"]*flex-wrap[^"]*">\s*<\/div>/);
    // 有其他做法的那条才有这个容器，一条一个
    expect(html([LOGIN, APPROVE]).match(/flex-wrap/g)).toHaveLength(1);
  });

  it("反向：一条都没有时整个面板不渲染（不留空壳）", () => {
    expect(html([])).toBe("");
  });

  it("说清楚不点也行——这是它跟澄清卡最关键的区别", () => {
    /* ⚠ 判据盯**语义**不盯某句话字面：只要还在告诉用户"不处理也有合法结局"。
       澄清卡是拦路的（不答完不点火），这个一格都不拦。哪天有人给它加上
       "必须处理完才能继续"，伴随式就退回成了拦路问答。 */
    const out = html([LOGIN]);
    expect(out).toMatch(/不改|默认|可以不/);
    expect(out).not.toContain("必填");
    expect(out).not.toContain("提交");
  });
});

describe("接线（四段都得接上）", () => {
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  const DRIVER = read("../../../lib/sliderule-marathon-driver.ts");
  const SESSION = read("../useSlideRuleSession.ts");
  const DOCK = read("../ComposerDock.tsx");
  const PAGE = read("../../SlideRule.tsx");

  it("流：SSE 的 spec_assumption 落到回调上", () => {
    expect(DRIVER).toContain('case "spec_assumption"');
    expect(DRIVER).toContain("onSpecAssumptions");
  });

  it("hook：并进去（不是覆盖也不是追加），并且导出去", () => {
    expect(SESSION).toContain("mergeAssumptions(specAssumptionsRef.current, items)");
    expect(SESSION).toContain("specAssumptions,");
    expect(SESSION).toContain("settleSpecAssumption,");
    expect(SESSION).toContain("reviseSpecAssumption,");
  });

  it("hook：点「改成 X」真的进中途排队——否则点了个寂寞", () => {
    /* ⚠ 这条是整件事的**唯一出口**。面板画得再好，这一行不在，
       用户点完只是把卡收走了，需求一个字都没传下去。 */
    expect(SESSION).toContain("pushQueuedTurn(phrase)");
    expect(SESSION).toContain("revisePhrase(row, alternative)");
  });

  it("新一轮 / 重置会话都要清空（否则对着过期的决定点改）", () => {
    expect(SESSION.match(/applySpecAssumptions\(\[\]\)/g)?.length).toBe(2);
  });

  it("输入条：画出来，两个动作都在", () => {
    expect(DOCK).toContain("AssumptionStrip");
    expect(DOCK).toContain("onSettleAssumption");
    expect(DOCK).toContain("onReviseAssumption");
  });

  it("页面：真的把假设传给了输入条（不传 = 组件永远收到空数组）", () => {
    expect(PAGE).toContain("specAssumptions={specAssumptions}");
    expect(PAGE).toContain("onSettleAssumption={settleSpecAssumption}");
    expect(PAGE).toContain("onReviseAssumption={reviseSpecAssumption}");
  });
});
