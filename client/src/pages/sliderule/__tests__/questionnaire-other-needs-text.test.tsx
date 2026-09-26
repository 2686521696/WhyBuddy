// @vitest-environment jsdom
/**
 * 选了「其他（自己写）」就得真写了字，才许继续。
 *
 * ⚠ 2026-09-26 隔离真机 sr-20260926021240-CW3R92STR7（PPT 话题）：第三问是
 *   「请补全下面模板中的真实内容」，options 为空。卡片自动选中 Other，「确认继续」
 *   一直可点，空着就交了——模型收到 `= 「其他（自己写）」`，只好在对话里再要一遍，
 *   然后停住等人，一轮 45 分钟就耗在这儿。
 *
 * 题目原样取自那条会话的 controlTranscript。把 QuestionnaireCard 里提交键的
 * `disabled` 删掉，第一条变红；把 answers() 对空 Other 的过滤删掉，「别再问了」那条变红。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OTHER_LABEL,
  QuestionnaireCard,
  isAnswered,
  type ControlQuestion,
  type QuestionnaireOutcome,
} from "../QuestionnaireCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILL_TEMPLATE: ControlQuestion = {
  id: "q1",
  question:
    "请补全下面模板中的真实内容后发我，我再整理成约 10 页 PPT 计划：\n指标1：新客转化率｜Q3 数值｜目标/对比值｜变化说明\n指标2：月活｜Q3 数值｜目标/对比值｜变化说明\n指标3：留存率｜Q3 数值｜目标/对比值｜变化说明\n做成1：\n做成2：\n未做成原因1：\n未做成原因2：\n下季度重点1：\n下季度重点2：\n下季度重点3：",
  options: [],
};

const TWO_STEPS: ControlQuestion[] = [
  {
    id: "q2",
    question: "三个关键指标和数据，你希望怎么处理？",
    options: [
      { label: "我提供真实数据", description: "你下一条发指标名称、数值、环比/目标及口径" },
      { label: "先用可替换的示例数据（推荐）" },
    ],
  },
  { id: "q4", question: "视觉和交付偏好是什么？", options: [{ label: "浅色商务风" }] },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(questions: ControlQuestion[]) {
  const onSubmit = vi.fn<(r: QuestionnaireOutcome) => void>();
  act(() => root.render(<QuestionnaireCard questions={questions} onSubmit={onSubmit} />));
  return onSubmit;
}

const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: HTMLElement | null) => act(() => el!.click());
const option = (label: string) =>
  [...host.querySelectorAll<HTMLElement>('[data-testid="sliderule-questionnaire-option"]')].find(
    el => el.textContent?.includes(label)
  )!;

function type(text: string) {
  const input = byTestId("sliderule-questionnaire-other-input") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("没有预设选项的题（真机第三问）", () => {
  it("自动选中了 Other，但没写字时「确认继续」点不动，点了也不交", () => {
    const onSubmit = mount([FILL_TEMPLATE]);
    expect(byTestId("sliderule-questionnaire-other-input")).not.toBeNull();
    expect(option(OTHER_LABEL).getAttribute("aria-pressed")).toBe("true");
    const submit = byTestId("sliderule-questionnaire-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.title).toBe("写上你的答案再继续");
    click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("只打空格也不算写了", () => {
    mount([FILL_TEMPLATE]);
    type("   ");
    expect((byTestId("sliderule-questionnaire-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("写了字就能交，交上去的是用户写的那段", () => {
    const onSubmit = mount([FILL_TEMPLATE]);
    type("指标1：新客转化率｜8.6%｜目标 8.0%｜漏斗优化");
    const submit = byTestId("sliderule-questionnaire-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    click(submit);
    expect(onSubmit).toHaveBeenCalledWith({
      outcome: "accepted",
      answers: { q1: [OTHER_LABEL] },
      notes: { q1: "指标1：新客转化率｜8.6%｜目标 8.0%｜漏斗优化" },
    });
  });
});

describe("有预设选项的题", () => {
  it("一项都没选时「下一题」点不动；选了就能走", () => {
    mount(TWO_STEPS);
    const next = byTestId("sliderule-questionnaire-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(next.title).toBe("先选一项再继续");
    click(option("示例数据"));
    expect((byTestId("sliderule-questionnaire-next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("选了 Other 没写字，下一题也点不动", () => {
    mount(TWO_STEPS);
    click(option(OTHER_LABEL));
    expect((byTestId("sliderule-questionnaire-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("反向：先在 Other 里写了几个字又改选别的，那段字不跟着交上去", () => {
    const onSubmit = mount(TWO_STEPS);
    click(option(OTHER_LABEL));
    type("写了一半");
    click(option("示例数据"));
    click(byTestId("sliderule-questionnaire-next"));
    click(option("浅色商务风"));
    click(byTestId("sliderule-questionnaire-submit"));
    expect(onSubmit).toHaveBeenCalledWith({
      outcome: "accepted",
      answers: { q2: ["先用可替换的示例数据（推荐）"], q4: ["浅色商务风"] },
      notes: {},
    });
  });

  it("「别再问了」照样能点，但空着的 Other 不算选了", () => {
    const onSubmit = mount([FILL_TEMPLATE]);
    click(byTestId("sliderule-questionnaire-skip"));
    expect(onSubmit).toHaveBeenCalledWith({ outcome: "skip_interview", answers: {} });
  });
});

describe("isAnswered", () => {
  it("正反各一", () => {
    expect(isAnswered(undefined, undefined)).toBe(false);
    expect(isAnswered([], "x")).toBe(false);
    expect(isAnswered([OTHER_LABEL], "")).toBe(false);
    expect(isAnswered([OTHER_LABEL, "浅色商务风"], " ")).toBe(false);
    expect(isAnswered([OTHER_LABEL], "我自己的")).toBe(true);
    expect(isAnswered(["浅色商务风"], undefined)).toBe(true);
  });
});
