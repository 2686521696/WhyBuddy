/**
 * 问卷交卷后的用户气泡：刷新回放跟实时是同一句，不是写给模型的回喂。
 *
 * ⚠ 2026-10-07 真机 r66 sr-20261007093611-0GR5W067E7（@theme-factory）：点了「别再问了，直接开始」，刷新后左栏用户气泡是
 *   「用户让你别再问了，按现在知道的直接开始。不要再调问答工具。」——日志行的 text 是 user_questions.format_skip_interview
 *   写给模型的。下面两行是那一发 controlTranscript 的原样（questionnaire-labels 头注）。
 */
import { describe, expect, it } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

import { turnsFromControlTranscript } from "../derive-persisted-turn";
import { CANCELLED_TEXT, SKIP_INTERVIEW_TEXT } from "../questionnaire-labels";

const R66_TURN = { id: "ct-969b85f969", kind: "turn", role: "user", text: "@theme-factory 帮我做一页 HTML 的公司年会邀请函（时间 2026 年 12 月 20 日晚 6 点，地点 上海静安香格里拉 3 楼宴会厅，需在 12 月 10 日前回复），先帮我挑一个主题。", timestamp: "2026-10-07T09:36:19.000072+00:00" };
const R66_SKIP = { id: "ct-36b46ac9f9", kind: "user_answer", role: "tool", text: "用户让你别再问了，按现在知道的直接开始。不要再调问答工具。", notes: null, reqId: "need-45fc79b4d5", answers: {}, outcome: "skip_interview", question: "这张年会邀请函你想采用哪种主题？", timestamp: "2026-10-07T09:37:23.862978+00:00", answerKind: "ask_user" };

const users = (rows: unknown[]) =>
  turnsFromControlTranscript({ sessionId: "s", controlTranscript: rows } as unknown as V5SessionState).map(t => t.user);

describe("刷新后问卷那一行的用户气泡", () => {
  it("真机那一发：「别再问了」是用户点的那句，不是给模型的指令", () => {
    const bubbles = users([R66_TURN, R66_SKIP]);
    expect(bubbles).toContain(SKIP_INTERVIEW_TEXT);
    expect(bubbles.join("\n")).not.toContain("不要再调问答工具");
  });

  it("「你自己定」同理", () => {
    const row = { ...R66_SKIP, id: "ct-x", outcome: "cancelled", text: "用户没有回答这些问题……" };
    expect(users([R66_TURN, row])).toContain(CANCELLED_TEXT);
  });

  it("反向：真的选了答案，气泡还是答案本身", () => {
    const row = { ...R66_SKIP, id: "ct-y", outcome: "accepted", answers: { q1: ["Golden Hour"] }, text: "用户回答了你的问题……" };
    const bubbles = users([R66_TURN, row]);
    expect(bubbles.join("\n")).toContain("Golden Hour");
    expect(bubbles).not.toContain(SKIP_INTERVIEW_TEXT);
  });
});
