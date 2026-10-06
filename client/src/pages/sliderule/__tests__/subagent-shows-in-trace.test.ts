/**
 * 派子代理要在执行轨迹里有一行。
 *
 * ⚠ 2026-10-06 真机 r27（@doc-coauthoring 远程办公制度）：Stage 3 派了 subagent，模型据它的结论改了正文；
 *   展开步骤，「进入独立读者测试」和「读者测试认为……」之间一行都没有，折叠脸上写「创建工程 · 编辑了 1 个文件 ·
 *   已运行 2 个命令」——子代理不在 isProjectWorkbenchTool 白名单里，被 isProjectChip 滤掉。2026-09-20 skill 踩过同一个坑。
 *
 * 喂的是那一场的 controlTranscript 原样行（fixtures/subagent-transcript.json），不自己拼（§一之二）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyProjectChip, chipsFromControlTranscript, type ProjectActionRow } from "../project-activity";
import { toolGroupSummary } from "../session-story";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/subagent-transcript.json", import.meta.url), "utf8"),
) as { rows: Array<Record<string, unknown>> };

function rowsFrom(transcript: Array<Record<string, unknown>>): ProjectActionRow[] {
  const rows: ProjectActionRow[] = [];
  for (const chip of chipsFromControlTranscript(transcript)) applyProjectChip(rows, chip);
  return rows;
}

describe("子代理在执行轨迹里看得见", () => {
  it("前提：真机那一场确实派了 subagent", () => {
    expect(fixture.rows.filter(r => r.tool === "subagent").map(r => r.kind)).toEqual(["tool_start", "tool_result"]);
  });

  it("刷新后从 controlTranscript 还原：有一行，带着派它去干什么", () => {
    const rows = rowsFrom(fixture.rows);
    const sub = rows.filter(r => r.tool === "subagent");
    expect(sub).toHaveLength(1);
    expect(sub[0]).toMatchObject({ status: "done", label: "派子代理", detail: "独立读者测试" });
  });

  it("按发生顺序落在初版生成之后、按反馈修改之前", () => {
    const tools = rowsFrom(fixture.rows).map(r => r.tool);
    const at = tools.indexOf("subagent");
    expect(tools.slice(0, at)).toContain("shell_exec");
    expect(tools.slice(at + 1)).toContain("file_str_replace");
  });

  it("折叠脸上也数得到", () => {
    expect(toolGroupSummary(rowsFrom(fixture.rows))).toContain("派子代理");
  });
});
