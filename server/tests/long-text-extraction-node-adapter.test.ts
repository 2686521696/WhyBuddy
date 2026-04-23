import { describe, expect, it } from "vitest";

import { executeLongTextExtractionNode } from "../routes/node-adapters/long-text-extraction-node-adapter.js";

describe("executeLongTextExtractionNode", () => {
  it("extracts summary, keywords, and fragments from long text", async () => {
    const text = [
      "支付系统发布前需要先完成回调验证、订单状态核对和风控开关检查。",
      "上线窗口要求保留回滚预案，并提前通知值班同学关注日志告警。",
      "如果回调链路出现异常，需要优先检查网关重试记录、消息堆积情况和补偿任务。",
      "最后整理发布摘要，输出给 format_output 和下游归档节点使用。",
    ].join("\n\n");

    const result = await executeLongTextExtractionNode({
      nodeType: "long_text_extraction",
      input: {
        title: "支付发布检查",
        text,
        maxKeywords: 6,
        maxFragments: 2,
        context: {
          source: "panel",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output.status).toBe("completed");
    expect(result.output.title).toBe("支付发布检查");
    expect(result.output.summary.short.length).toBeGreaterThan(0);
    expect(result.output.summary.paragraph).toContain("发布");
    expect(result.output.keywords.length).toBeGreaterThan(0);
    expect(result.output.fragments.length).toBeGreaterThan(0);
    expect(result.output.structured.summary).toBeTruthy();
    expect(result.output.structured.keywords.length).toBeGreaterThan(0);
    expect(result.output.context).toEqual({
      source: "panel",
    });
  });

  it("handles oversized input by truncating and surfacing warnings", async () => {
    const repeated = Array.from(
      { length: 1200 },
      (_, index) => `段落${index} 说明长文本抽取需要兼顾摘要、关键词和片段定位。`,
    ).join(" ");

    const result = await executeLongTextExtractionNode({
      nodeType: "long_text_extraction",
      input: {
        text: repeated,
        maxInputChars: 1800,
        maxSummaryChars: 160,
      },
    });

    expect(result.output.source.truncated).toBe(true);
    expect(result.output.source.processedCharCount).toBeLessThan(
      result.output.source.originalCharCount,
    );
    expect(result.output.warnings.some(item => item.includes("截断"))).toBe(true);
    expect(result.output.chunks.length).toBeGreaterThan(0);
    expect(result.output.structured.notes).toContain("input_truncated:true");
  });

  it("rejects execution when text is missing", async () => {
    await expect(
      executeLongTextExtractionNode({
        nodeType: "long_text_extraction",
        input: {},
      }),
    ).rejects.toThrow(/requires text/i);
  });
});
