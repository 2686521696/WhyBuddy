/**
 * 跑失败的命令要在执行轨迹里说「失败」。
 *
 * ⚠ 2026-10-04 真机 @pptx-* 做 Q3 复盘：沙盒没装 python-pptx，第一次构建退出非 0，
 *   回执 `ok: true, status: "failed"`（shell_exec 的 ok 只表示「已受理」）。三处显示只看 ok，
 *   步骤写「已运行 1 个命令」不标失败；同组 file_read 的失败倒标了。
 *
 * 喂的是那一场的 controlTranscript 原样行（fixtures/command-failure-transcript.json），不自己拼（§一之二）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyProjectChip, chipsFromControlTranscript, projectToolFailed, type ProjectActionRow } from "../project-activity";
import { toolGroupFace } from "../session-story";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/command-failure-transcript.json", import.meta.url), "utf8"),
) as { rows: Array<Record<string, unknown>> };

function rowsFrom(transcript: Array<Record<string, unknown>>): ProjectActionRow[] {
  const rows: ProjectActionRow[] = [];
  for (const chip of chipsFromControlTranscript(transcript)) applyProjectChip(rows, chip);
  return rows;
}

describe("命令失败在执行轨迹里看得见", () => {
  it("真机那两次失败的 shell_exec 判成失败，成功的两次不是", () => {
    const results = fixture.rows.filter(r => r.kind === "tool_result" && r.tool === "shell_exec");
    expect(results.map(r => r.status)).toEqual(["failed", "completed", "failed", "completed"]);
    expect(results.every(r => r.ok === true)).toBe(true); // 前提：回执的 ok 真的是 true——只看 ok 就漏
    expect(results.map(r => projectToolFailed(r))).toEqual([true, false, true, false]);
  });

  it("查看失败命令的日志（project_logs，status=failed）不算失败——失败的是被查看的那条", () => {
    const logs = fixture.rows.find(r => r.kind === "tool_result" && r.tool === "project_logs")!;
    expect(logs.status).toBe("failed");
    expect(projectToolFailed(logs)).toBe(false);
  });

  it("刷新后从 controlTranscript 还原：步骤组脸上写「2 失败」", () => {
    const rows = rowsFrom(fixture.rows);
    const commands = rows.filter(r => r.tool === "shell_exec");
    expect(commands.map(r => r.status)).toEqual(["failed", "done", "failed", "done"]);
    expect(toolGroupFace(rows, { finalized: true }).meta).toBe("2 失败");
  });

  it("实时流的回执（带 commandFinished + exitCode、没有 status）也认", () => {
    expect(projectToolFailed({ tool: "shell_exec", ok: true, commandFinished: true, exitCode: 1 })).toBe(true);
    expect(projectToolFailed({ tool: "shell_exec", ok: true, commandFinished: true, exitCode: 0 })).toBe(false);
    // 后台命令还没结束：没有结论，不是失败
    expect(projectToolFailed({ tool: "shell_exec", ok: true, commandFinished: false, status: "running" })).toBe(false);
  });

  it("实时流与续播两处真的走同一个判定（剥注释后看源码）", () => {
    const src = readFileSync(new URL("../useSlideRuleSession.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src.match(/const ok = !projectToolFailed\(event\);/g)?.length).toBe(2);
    expect(src).not.toMatch(/const ok = event\.ok !== false;/);
  });
});
