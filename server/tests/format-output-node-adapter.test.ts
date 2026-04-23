import { describe, expect, it } from "vitest";

import { executeFormatOutputNode } from "../routes/node-adapters/format-output-node-adapter.js";

describe("executeFormatOutputNode", () => {
  it("formats plain text output for downstream consumption", async () => {
    const result = await executeFormatOutputNode({
      nodeType: "format_output",
      input: {
        format: "text",
        data: {
          summary: "任务执行成功",
          score: 98,
        },
        title: "总结",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output.status).toBe("completed");
    expect(result.output.format).toBe("text");
    expect(result.output.content).toContain("任务执行成功");
    expect(result.output.structured).toEqual({
      summary: "任务执行成功",
      score: 98,
    });
    expect(result.output.fallbackUsed).toBe(false);
    expect(result.output.metadata.downstreamConsumers).toEqual([
      "end",
      "file_generation",
    ]);
  });

  it("formats json output and preserves structured payload", async () => {
    const result = await executeFormatOutputNode({
      nodeType: "format_output",
      input: {
        format: "json",
        data: {
          workflowId: "wf-1",
          passed: true,
        },
      },
    });

    expect(result.output.format).toBe("json");
    expect(result.output.content).toBe('{\n  "workflowId": "wf-1",\n  "passed": true\n}');
    expect(result.output.structured).toEqual({
      workflowId: "wf-1",
      passed: true,
    });
    expect(result.output.metadata.contentType).toContain("application/json");
  });

  it("formats table output as markdown table for file generation", async () => {
    const result = await executeFormatOutputNode({
      nodeType: "format_output",
      input: {
        format: "table",
        data: [
          { name: "Alice", score: 95, status: "pass" },
          { name: "Bob", score: 88, status: "pass" },
        ],
        columns: ["name", "score", "status"],
      },
    });

    expect(result.output.format).toBe("table");
    expect(result.output.content).toBe(
      "| name | score | status |\n| --- | --- | --- |\n| Alice | 95 | pass |\n| Bob | 88 | pass |",
    );
    expect(result.output.structured).toEqual({
      columns: ["name", "score", "status"],
      rows: [
        { name: "Alice", score: 95, status: "pass" },
        { name: "Bob", score: 88, status: "pass" },
      ],
    });
    expect(result.output.metadata.rowCount).toBe(2);
    expect(result.output.metadata.columnCount).toBe(3);
  });

  it("renders template output with title and nested variables", async () => {
    const result = await executeFormatOutputNode({
      nodeType: "format_output",
      input: {
        format: "template",
        title: "周报",
        data: {
          user: {
            name: "小王",
          },
          stats: {
            done: 6,
          },
        },
        template: "标题：{{title}}\n负责人：{{user.name}}\n完成数：{{stats.done}}",
      },
    });

    expect(result.output.format).toBe("template");
    expect(result.output.content).toBe("标题：周报\n负责人：小王\n完成数：6");
    expect(result.output.structured).toEqual({
      rendered: "标题：周报\n负责人：小王\n完成数：6",
      template: "标题：{{title}}\n负责人：{{user.name}}\n完成数：{{stats.done}}",
      variables: ["title", "user.name", "stats.done"],
      source: {
        user: {
          name: "小王",
        },
        stats: {
          done: 6,
        },
      },
    });
    expect(result.output.metadata.templateKeys).toEqual([
      "title",
      "user.name",
      "stats.done",
    ]);
  });

  it("falls back to raw text when template rendering fails", async () => {
    const result = await executeFormatOutputNode({
      nodeType: "format_output",
      input: {
        format: "template",
        raw: {
          summary: "raw summary",
          total: 3,
        },
        template: "负责人：{{owner.name}}",
      },
    });

    expect(result.output.status).toBe("completed");
    expect(result.output.format).toBe("text");
    expect(result.output.fallbackUsed).toBe(true);
    expect(result.output.error).toContain('Template variable "owner.name" is missing');
    expect(result.output.metadata.fallbackFrom).toBe("template");
    expect(result.output.content).toContain("raw summary");
    expect(result.output.structured).toEqual({
      summary: "raw summary",
      total: 3,
    });
  });

  it("falls back to raw output when table format input is incompatible", async () => {
    const result = await executeFormatOutputNode({
      nodeType: "format_output",
      input: {
        format: "table",
        raw: "not a table payload",
      },
    });

    expect(result.output.format).toBe("text");
    expect(result.output.fallbackUsed).toBe(true);
    expect(result.output.error).toContain("Table format requires");
    expect(result.output.content).toBe("not a table payload");
  });
});
