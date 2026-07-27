/**
 * 入站判定前端消费侧测试（2026-07-27）。
 *
 * 锁三件事，都是"闸门坏了不能变成产品坏了"的具体形态：
 *  1. parseJudgement 对畸形返回体一律 null（fail-open，不把脏数据画到界面上）；
 *  2. judgeIntake 对 HTTP 失败/网络异常一律 null，不往上抛；
 *  3. 提示条只在 action=hint 且有引导话术时出现，且永远带"仍会照常推演"
 *     这句——第一版的产品承诺是只提示不阻断，这句话消失就是承诺被改了。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { IntakeHintBar, shouldShowIntakeHint } from "../IntakeHintBar";
import {
  judgeIntake,
  parseJudgement,
  MIN_JUDGE_CHARS,
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
    expect(body).toEqual({ text: "再加一个退款流程", hasApp: true });
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
  });

  it("哨兵：只提示不阻断的承诺必须写在明面上", () => {
    const html = renderToStaticMarkup(
      <IntakeHintBar judgement={HINT} onRewrite={() => {}} />
    );
    // 这句话是第一版的产品契约（后端 action 恒为 proceed|hint）。要删它，
    // 必须同时改后端 _resolve_action 真开阻断，不能只在界面上悄悄拿掉。
    expect(html).toContain("直接发送仍会照常推演");
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
  });
});
