/**
 * 没有工程的纯回答轮：模型的话按 markdown 画，跟工程轮收尾同一个画法（SessionStory.SpeechMarkdown 头注）。
 *
 * ⚠ 2026-10-02 隔离真机第 186 轮 sr-20261002070245-3CVZ2CH0XG（「给读书会想 5 个名字」）：左栏原样露出
 *   「1. **阅见**」——这条路（SlideRule.ModelSpeechBlocks）按纯文本 <p> 画。下面的话是那一轮原文的开头。
 * 把 ModelSpeechBlocks 改回 <p>{item.text}</p>，第一条红。
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeChatSurface } from "../../SlideRule";
import type { UiTurn } from "../types";

const ROUND186 = "1. **阅见**  \n   “阅读”与“遇见”的巧妙结合，寓意在书中遇见新知，也遇见彼此。\n\n" +
  "2. **纸上新声**  \n   保留书卷气，又强调从经典中读出当代视角与新的思考。";

const turn = (text: string): UiTurn => ({
  id: "t186", user: "帮我给公司的读书会想 5 个名字", status: "complete",
  steps: [{ kind: "model_speech", id: "s1", text } as never],
  routeFacts: { turnId: "t186" }, routeExpanded: false, routeLitCount: 0,
  assistant: "", assistantSource: "llm", actions: [], main: null,
} as unknown as UiTurn);

const render = (t: UiTurn) => renderToStaticMarkup(
  <ClaudeChatSurface uiTurns={[t]} isRunning={false} liveAction={null} latestTurn={t} onChallenge={() => {}} />);

describe("纯回答轮按 markdown 画", () => {
  it("bold and numbered list render; no literal asterisks", () => {
    const html = render(turn(ROUND186));
    expect(html).toContain('data-testid="sliderule-model-speech"');
    expect(html).toContain("<strong>阅见</strong>");
    expect(html).toContain("<ol");
    expect(html).not.toContain("**阅见**");
  });

  it("a sandbox: link is not drawn as a clickable link (same filter as the closing)", () => {
    const html = render(turn("文件在这：[下载](sandbox:/home/user/workspace/a.pptx)"));
    expect(html).not.toContain('href=""');
    expect(html).not.toContain("sandbox:");
    expect(html).toContain("下载");
  });
});
