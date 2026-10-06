/**
 * 算数（calculate）在执行轨迹里有一行。
 *
 * ⚠ 2026-10-06 r33：规划期心算错了去质疑用户（services/calculator 头注）。补了 calculate 之后，
 *   不进 isProjectWorkbenchTool 白名单 = 算过也看不见，用户照样以为是心算（subagent 同一天踩过同一个坑）。
 * 行的形状照 control_transcript_log.tool_transcript_entry 落库的样子（tool_start 带 summary，tool_result 带 ok）。
 */
import { describe, expect, it } from "vitest";

import { applyProjectChip, chipsFromControlTranscript, type ProjectActionRow } from "../project-activity";
import { toolGroupSummary } from "../session-story";

const rows = [
  { id: "ct-1", kind: "tool_start", role: "assistant", tool: "calculate", summary: "月贡献 = 12*(1-32%)-2-2.4" },
  { id: "ct-2", kind: "tool_result", role: "assistant", tool: "calculate", ok: true },
];

describe("计算在执行轨迹里看得见", () => {
  it("刷新后还原成一行，带着算的是哪一式", () => {
    const out: ProjectActionRow[] = [];
    for (const chip of chipsFromControlTranscript(rows)) applyProjectChip(out, chip);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tool: "calculate", label: "计算", status: "done", detail: "月贡献 = 12*(1-32%)-2-2.4" });
    expect(toolGroupSummary(out)).toContain("计算");
  });
});
