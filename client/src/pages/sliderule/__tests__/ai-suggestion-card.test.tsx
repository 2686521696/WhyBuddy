/**
 * AI 建议卡（加厚 schema 三期"可解释输出"）渲染测试。
 * 锁：建议值/置信度色条/依据/确认与忽略按钮；置信度缺失如实标注
 * "未提供"（不造数字）；依据缺失不渲染依据行。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiSuggestionCard } from "../live-runtime/AiSuggestionCard";

describe("AiSuggestionCard", () => {
  it("完整建议：输出 + 置信度百分比（档位色）+ 依据 + 双按钮", () => {
    const html = renderToStaticMarkup(
      <AiSuggestionCard
        outputLabel="课程简介"
        output="面向零基础学员的 Python 入门课程。"
        confidence={0.82}
        rationale="基于课程标题与目标人群生成"
        onApply={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(html).toContain('data-testid="app-ai-suggestion"');
    expect(html).toContain("写回「课程简介」");
    expect(html).toContain("待确认");
    expect(html).toContain("面向零基础学员的 Python 入门课程。");
    expect(html).toContain("82%");
    expect(html).toContain("#52c41a"); // 82 分档位 → 绿
    expect(html).toContain("依据：基于课程标题与目标人群生成");
    expect(html).toContain('data-testid="app-ai-apply"');
    expect(html).toContain('data-testid="app-ai-dismiss"');
  });

  it("置信度缺失 → 如实标注未提供（不造数字）；低置信度走红档", () => {
    const none = renderToStaticMarkup(
      <AiSuggestionCard
        outputLabel="x"
        output="y"
        confidence={null}
        rationale={null}
        onApply={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(none).toContain('data-testid="app-ai-no-confidence"');
    expect(none).not.toContain('data-testid="app-ai-confidence"');
    expect(none).not.toContain("依据：");

    const low = renderToStaticMarkup(
      <AiSuggestionCard
        outputLabel="x"
        output="y"
        confidence={0.3}
        rationale={null}
        onApply={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(low).toContain("30%");
    expect(low).toContain("#ff4d4f"); // <60 → 红
  });
});
