/**
 * 入站判定前端消费侧测试（2026-07-27）。
 *
 * 锁三件事，都是"闸门坏了不能变成产品坏了"的具体形态：
 *  1. parseJudgement 对畸形返回体一律 null（fail-open，不把脏数据画到界面上）；
 *  2. judgeIntake 对 HTTP 失败/网络异常一律 null，不往上抛；
 *  3. 提示条只在 action=hint 且有引导话术时出现；卡片出来之后仍可自己发
 *     （生成过程中的发送锁在 ComposerDock，不在这张卡上）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { IntakeHintBar, INTAKE_JUDGING_LABEL, shouldShowIntakeHint } from "../IntakeHintBar";
import {
  judgeIntake,
  parseJudgement,
  MIN_JUDGE_CHARS,
  intakeHintYieldsToScopeCard,
  looksLikeFactoryHopCommand,
  type IntakeJudgement,
} from "../use-intake-judge";

const HINT: IntakeJudgement = {
  verdict: "vague",
  action: "hint",
  reason: "只说了行业没说要解决什么",
  guidance: "再补一句你想解决的具体问题，比如谁在什么时候要看什么数。",
  rewrite: ["给咖啡烘焙工坊做生豆库存与烘焙批次管理", "做一套烘焙批次的成本核算"],
  confidence: 0.8,
  source: "llm",
  degradedReason: "",
  device: "unspecified",
  deviceReason: "",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseJudgement", () => {
  it("接受合法返回体并规范化字段", () => {
    const j = parseJudgement({
      judgement: {
        verdict: "vague",
        action: "hint",
        guidance: "补一句",
        rewrite: ["改写一", "", "改写二"],
        confidence: 0.7,
      },
    });
    expect(j).not.toBeNull();
    expect(j!.verdict).toBe("vague");
    // 空串改写建议被过滤——渲染出来就是个点不出东西的空按钮
    expect(j!.rewrite).toEqual(["改写一", "改写二"]);
    expect(j!.reason).toBe("");
  });

  it("接受 out_of_scope——后端加了判词而这里的闭集没加，提示条会一个字都不显示", () => {
    // 这不是形式主义：VALID_VERDICTS 漏一个判词，parseJudgement 返回 null，
    // fail-open 把它当成"没判过"，界面上什么都不出现，而且**不报任何错**。
    // 拒绝档整条功能会这么悄无声息地失效，所以单独钉一条。
    const j = parseJudgement({
      judgement: {
        verdict: "out_of_scope",
        action: "hint",
        guidance: "做不了游戏画面本身，但赛事报名与成绩管理做得了。",
        rewrite: ["赛事报名、成绩登记与排行榜管理"],
        confidence: 0.98,
      },
    });
    expect(j?.verdict).toBe("out_of_scope");
    expect(j?.rewrite).toHaveLength(1);
  });

  it("畸形返回体一律 null（当作没判过）", () => {
    expect(parseJudgement(null)).toBeNull();
    expect(parseJudgement({})).toBeNull();
    expect(parseJudgement("proceed")).toBeNull();
    // verdict 不在闭集内：后端加了新判决而前端没跟上，宁可不显示也不乱显示
    expect(
      parseJudgement({ judgement: { verdict: "spam", action: "hint" } })
    ).toBeNull();
    // action 不在闭集内：将来真开阻断（action=block）时，老前端不该把它
    // 当成普通提示画出来
    expect(
      parseJudgement({ judgement: { verdict: "vague", action: "block" } })
    ).toBeNull();
  });
});

describe("judgeIntake", () => {
  it("HTTP 非 2xx → null，不抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    await expect(judgeIntake("给宠物医院做预约挂号", false)).resolves.toBeNull();
  });

  it("网络异常 → null，不抛", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(judgeIntake("给宠物医院做预约挂号", false)).resolves.toBeNull();
  });

  it("把 hasApp 语境如实带给后端（同一句话有无应用判决不同）", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ judgement: { ...HINT, action: "proceed" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await judgeIntake("再加一个退款流程", true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      text: "再加一个退款流程",
      hasApp: true,
      appSummary: "",
    });
  });

  it("带上应用摘要一起发（引导话术据此具体到当前应用）", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ judgement: { ...HINT, action: "proceed" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await judgeIntake("再加一个退款流程", true, undefined, "采购审批系统");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.appSummary).toBe("采购审批系统");
  });
});

describe("IntakeHintBar", () => {
  it("action=hint：出引导话术 + 可点的改写建议", () => {
    const html = renderToStaticMarkup(
      <IntakeHintBar judgement={HINT} onRewrite={() => {}} />
    );
    expect(html).toContain('data-testid="sliderule-intake-hint"');
    expect(html).toContain('data-verdict="vague"');
    expect(html).toContain(HINT.guidance);
    expect(html.match(/data-testid="sliderule-intake-rewrite"/g)).toHaveLength(2);
    expect(html).not.toContain("#fffbf0");
    expect(html).not.toContain("#ffe3a3");
  });

  it("哨兵：卡片出来之后仍可自己发送，不该再装成警告黄条", () => {
    const html = renderToStaticMarkup(
      <IntakeHintBar judgement={HINT} onRewrite={() => {}} />
    );
    expect(html).toContain("继续编辑后发送");
    expect(html).not.toContain("直接发送仍会照常推演");
    expect(html).toContain("rounded-[12px]");
    expect(html).toContain("border-[#e5e7eb]");
    expect(html).not.toContain("bg-[#fffbf0]");
  });

  it("判定在途：占位「正在审查」，不渲染改写卡片，也不叫澄清", () => {
    // 澄清是发送之后主轴第 1 步。填标题时是 intake_judge 审查。
    // 改回「正在澄清需求」，这条必红。
    const html = renderToStaticMarkup(
      <IntakeHintBar judgement={HINT} isJudging onRewrite={() => {}} />
    );
    expect(html).toContain('data-pending="true"');
    expect(html).toContain(INTAKE_JUDGING_LABEL);
    expect(INTAKE_JUDGING_LABEL).toContain("审查");
    expect(html).not.toContain("澄清");
    expect(html).not.toContain(HINT.guidance);
    expect(html).not.toContain('data-testid="sliderule-intake-rewrite"');
  });

  it("审查卡叠在输入框上方，带弹出动画，不进文档流", () => {
    // 进 flex 流会把输入框顶下去；空态还是 justify-center，跳得更明显。
    // 变异：拿掉 absolute / bottom-full，这条必红。
    const html = renderToStaticMarkup(
      <IntakeHintBar judgement={HINT} onRewrite={() => {}} />
    );
    expect(html).toContain("absolute");
    expect(html).toContain("bottom-full");
    expect(html).toContain("sr-composer-pop");
    expect(html).not.toMatch(/class="pointer-events-auto w-full rounded/);
    const css = readFileSync(new URL("../../../index.css", import.meta.url), "utf8");
    expect(css).toContain("@keyframes sr-composer-pop");
    expect(css).toMatch(/\.sr-composer-pop\s*\{/);
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)[\s\S]*\.sr-composer-pop/
    );
  });

  it("proceed / 无判定 / 空引导：不占用户视线", () => {
    for (const j of [
      null,
      { ...HINT, action: "proceed" as const },
      { ...HINT, guidance: "   " },
    ]) {
      expect(shouldShowIntakeHint(j)).toBe(false);
      expect(renderToStaticMarkup(<IntakeHintBar judgement={j} onRewrite={() => {}} />)).toBe("");
    }
  });

  it("范围卡开着时 hint 条必须让路（同一 send 禁止两张卡）", () => {
    expect(intakeHintYieldsToScopeCard(true)).toBe(false);
    expect(shouldShowIntakeHint(HINT, true)).toBe(false);
    expect(
      renderToStaticMarkup(
        <IntakeHintBar judgement={HINT} scopeCardOpen onRewrite={() => {}} />
      )
    ).toBe("");
  });

  it("没有改写建议时不渲染空的建议区", () => {
    const html = renderToStaticMarkup(
      <IntakeHintBar judgement={{ ...HINT, rewrite: [] }} onRewrite={() => {}} />
    );
    expect(html).toContain('data-testid="sliderule-intake-hint"');
    expect(html).not.toContain('data-testid="sliderule-intake-rewrite"');
  });
});

describe("判定触发阈值", () => {
  it("太短的输入不值得往返一次请求", () => {
    expect(MIN_JUDGE_CHARS).toBeGreaterThan(1);
    expect("帮我".length).toBeLessThan(MIN_JUDGE_CHARS);
    expect("给宠物医院做预约挂号".length).toBeGreaterThanOrEqual(MIN_JUDGE_CHARS);
  });
});

describe("工厂单跳指令不走新话题审查", () => {
  it("已有应用上的 structure/bind/closure 指令认成 hop", () => {
    expect(
      looksLikeFactoryHopCommand(
        "继续进行数据模型反推（structure）与权限绑定（bind）"
      )
    ).toBe(true);
    expect(looksLikeFactoryHopCommand("直接执行闭环发布（closure）")).toBe(true);
    expect(looksLikeFactoryHopCommand("直接执行闭环发布")).toBe(true);
    expect(looksLikeFactoryHopCommand("进入数据模型反推（Structure）")).toBe(
      true
    );
  });

  it("新产品名即使带闭环发布也不认成 hop", () => {
    expect(looksLikeFactoryHopCommand("闭环发布管理系统")).toBe(false);
    expect(looksLikeFactoryHopCommand("做一个闭环发布管理系统")).toBe(false);
    expect(looksLikeFactoryHopCommand("给社区图书馆做借还书系统")).toBe(false);
  });

  it("hook 在 hasApp 时对 hop 指令连审查请求都不发", async () => {
    const src = await import("../use-intake-judge?raw").then(
      m => (m as unknown as { default: string }).default
    );
    expect(src).toContain("hasApp && looksLikeFactoryHopCommand");
    expect(src).toContain("setIsJudging(false)");
  });
});

describe("useIntakeJudge 的陈旧判定处理", () => {
  it("判定只对它判过的那句话有效", async () => {
    // 真机验证抓到的 bug：点改写建议回填了一句完全合格的需求，界面还在说
    // "你这句太模糊"，直到新判定回来。hook 返回值必须与当前输入配对——
    // 这里锁的是那个配对判断本身（没有 jsdom，跑不了 effect，所以直接测
    // 它依赖的等值语义）。
    const src = await import("../use-intake-judge?raw").then(
      m => (m as unknown as { default: string }).default
    );
    expect(src).toContain("judgedFor");
    // 返回前必须比对当前文本，而不是无条件把上一次的结果吐出来
    expect(src).toContain("state.judgedFor === text.trim()");
    expect(src).toContain("isJudging");
    // 锁发送从 debounce 结束、请求发出才开始——setIsJudging(true) 必须在
    // setTimeout 回调里。打字期间先 false，变异成一输入就 true 会把发送锁死。
    expect(src).toMatch(
      /setTimeout\(\(\) => \{[\s\S]*setIsJudging\(true\)/
    );
    expect(src.match(/setIsJudging\(true\)/g)?.length).toBe(1);
  });
});

describe("发送键 title 跟提示条同一句审查", () => {
  it("ComposerDock 判定在途用 INTAKE_JUDGING_LABEL，不写澄清", () => {
    const src = readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(src).toContain("INTAKE_JUDGING_LABEL");
    expect(src).not.toContain("正在澄清需求");
  });
});

describe("审查卡挂在输入框的 relative 壳上", () => {
  it("IntakeHintBar 不是外层 flex-col 的第一个孩子", () => {
    // 挂在 flex-col 顶部会占高度，输入框跟着跳。必须进 relative 壳、
    // 叠在 dock 上方。变异：把 <IntakeHintBar 搬回 return 后第一行，这条必红。
    const dock = readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    /*
     * ⚠ 锚点用 data-testid，不用 className 字面量（2026-08-26）。
     *   原来钉的是 "relative min-w-0 flex-1"，给那层加了个 z-30 之后
     *   indexOf 返回 -1，slice(start, -1) 切出一段莫名其妙的窗口，判据
     *   **以一句读不懂的报错红掉**——而被改的东西跟这条判据毫无关系。
     *   判据的锚点要挑不会被样式改动碰到的东西。
     */
    const shell = 'data-testid="sliderule-composer-shell"';
    expect(dock).toContain(shell);
    const head = dock.slice(
      dock.indexOf("pointer-events-none flex w-full flex-col"),
      dock.indexOf(shell)
    );
    expect(head).not.toContain("<IntakeHintBar");
    const around = dock.slice(
      dock.indexOf(shell),
      dock.indexOf('data-testid="sliderule-composer-context"')
    );
    expect(around).toContain("<IntakeHintBar");
    expect(around.indexOf("sliderule-composer-dock")).toBeLessThan(
      around.indexOf("<IntakeHintBar")
    );
  });
});