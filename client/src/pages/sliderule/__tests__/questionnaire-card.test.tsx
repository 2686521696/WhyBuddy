/**
 * 问答卡：一次几道、每项带解释、自动补「其他」、推荐项排第一。
 *
 * 抄的标准答案：grok-build `xai-grok-pager/src/views/question_view.rs`
 * 与工具侧 `ask_user_question/mod.rs` 的两句 description_template。
 *
 * ⚠ 「自动补 Other」是**服务端对渲染侧的承诺**（工具说明里写着「你不要自己加」）。
 *   两侧成对：Python 那边判据钉「说明里那两句不许掉」，这边钉「渲染真的补了」。
 *   只钉一边的话，掉的那半会静静失效——卡上要么没有其他，要么有两个。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OTHER_LABEL,
  QuestionnaireCard,
  RECOMMENDED_SUFFIX,
  splitRecommended,
  type ControlQuestion,
} from "../QuestionnaireCard";

const QUESTIONS: ControlQuestion[] = [
  {
    id: "q1",
    question: "患者怎么登录？",
    options: [
      { label: `手机号 + 验证码${RECOMMENDED_SUFFIX}`, description: "最通用，不用记密码" },
      { label: "微信授权", description: "一键，但绑死微信生态" },
    ],
  },
  {
    id: "q2",
    question: "预约能提前多久？",
    options: [{ label: "7 天" }, { label: "30 天" }],
    multiSelect: true,
  },
];

const html = (extra?: Partial<React.ComponentProps<typeof QuestionnaireCard>>) =>
  renderToStaticMarkup(
    <QuestionnaireCard questions={QUESTIONS} onSubmit={() => {}} {...extra} />
  );

describe("推荐项", () => {
  it("标签末尾那个后缀摘掉，换成角标", () => {
    expect(splitRecommended(`手机号${RECOMMENDED_SUFFIX}`)).toEqual({
      text: "手机号",
      recommended: true,
    });
    expect(splitRecommended("微信授权")).toEqual({
      text: "微信授权",
      recommended: false,
    });
  });

  it("渲染出来是角标，不是标签里那五个字", () => {
    const out = html();
    expect(out).toContain('data-recommended="true"');
    // 反向：后缀不许原样留在标签里（那样卡上会写「手机号 + 验证码（推荐）推荐」）
    expect(out).not.toContain(RECOMMENDED_SUFFIX);
  });
});

describe("Other 是渲染侧补的", () => {
  it("每道题都自动多一项", () => {
    const out = html();
    expect(out).toContain(OTHER_LABEL);
    expect(out).toContain('data-other="true"');
  });

  it("反向：模型给的选项里没有它——补的人是这一层", () => {
    // 判据自己先证明前提成立，否则「本来就有」也会让上一条绿。
    for (const q of QUESTIONS) {
      expect(q.options.some(o => o.label === OTHER_LABEL)).toBe(false);
    }
  });
});

describe("一次几道", () => {
  it("分页器写着 1 / 2，先出第一道", () => {
    const out = html();
    expect(out).toContain("1 / 2");
    expect(out).toContain("患者怎么登录？");
    // 第二道这时候不该画出来——一次让人看一件事。
    expect(out).not.toContain("预约能提前多久？");
  });

  it("多于一道时先给「下一题」，不给「确认继续」", () => {
    const out = html();
    expect(out).toContain('data-testid="sliderule-questionnaire-next"');
    expect(out).not.toContain('data-testid="sliderule-questionnaire-submit"');
  });

  it("只有一道时直接给「确认继续」", () => {
    const one = renderToStaticMarkup(
      <QuestionnaireCard questions={[QUESTIONS[0]]} onSubmit={() => {}} />
    );
    expect(one).toContain('data-testid="sliderule-questionnaire-submit"');
    expect(one).not.toContain('data-testid="sliderule-questionnaire-next"');
  });
});

describe("每项要写清选它意味着什么", () => {
  it("description 画出来了", () => {
    const out = html();
    expect(out).toContain("最通用，不用记密码");
    expect(out).toContain("一键，但绑死微信生态");
  });
});

describe("停住了要说出来", () => {
  it("paused 时分页器写「已停住，选完再继续」", () => {
    expect(html({ paused: true })).toContain("已停住，选完再继续");
  });

  it("没停住时不许说停住了", () => {
    const out = html({ paused: false });
    expect(out).toContain("选完再继续");
    expect(out).not.toContain("已停住");
  });
});

describe("四条路径的出口都在卡上", () => {
  it("你自己定 / 别再问了 两个出口都画得出来", () => {
    const out = html();
    // grok Path D（cancel）与 Path C（skip interview）。
    // 没有出口的话，用户只能硬答或者晾着——工厂就一直停在那儿。
    expect(out).toContain('data-testid="sliderule-questionnaire-cancel"');
    expect(out).toContain('data-testid="sliderule-questionnaire-skip"');
  });
});
