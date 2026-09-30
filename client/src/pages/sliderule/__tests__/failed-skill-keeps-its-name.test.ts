/**
 * 加载技能失败时，左栏那一行既说点了哪个名字，也说为什么不行。
 *
 * ⚠ 2026-09-30 用户本机截图（@office-skills 写《员工入职管理系统方案》Word）：三行都是
 *   「加载技能 skill_not_found」。开场 chip 带着技能名，失败时「坏消息优先」把它整个盖成错误码，
 *   模型点的到底是哪个名字查不到。回放那一侧见 tests/test_a_failed_skill_keeps_its_name.py（§四）。
 *
 * 走真 projectActionDetail → applyProjectChip → timelineRowTitle，事件形状是服务端 skill 回执原样
 * （ok/error/skill/available）。把 projectActionDetail 里技能那一支删掉，第一条变红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyProjectChip,
  liveToolResultDetail,
  projectActionDetail,
  type ProjectActionRow,
} from "../project-activity";
import { timelineRowTitle } from "../session-story";
import type { TurnStep } from "../types";

function chip(id: string, progressType: string, projectDetail: string): TurnStep {
  return {
    id,
    kind: "chip",
    capabilityId: "skill",
    roleId: "system",
    label: "",
    realLlm: false,
    progressType,
    projectDetail,
  } as unknown as TurnStep;
}

const notFound = {
  type: "control_tool_result",
  tool: "skill",
  ok: false,
  error: "skill_not_found",
  skill: "docx",
  available: ["office-skills", "doc-coauthoring"],
};

describe("失败的技能行留住名字", () => {
  it("开场是 docx、失败是 skill_not_found → 脸上两样都有", () => {
    const rows: ProjectActionRow[] = [];
    applyProjectChip(rows, chip("s", "acting", "docx"));
    applyProjectChip(rows, chip("r", "failed", projectActionDetail(notFound)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    const title = timelineRowTitle(rows[0]);
    expect(title).toContain("docx");
    expect(title).toContain("skill_not_found");
  });

  it("刷新后只剩结果那一发，也不丢名字", () => {
    const rows: ProjectActionRow[] = [];
    applyProjectChip(rows, chip("r", "failed", projectActionDetail(notFound)));
    expect(timelineRowTitle(rows[0])).toContain("docx");
  });

  it("反向：别的工具失败照旧只报错误码", () => {
    expect(
      projectActionDetail({ tool: "file_read", ok: false, error: "project_file_not_found", skill: "x" })
    ).toBe("project_file_not_found");
  });

  it("反向：技能成功不拼错误", () => {
    expect(projectActionDetail({ tool: "skill", ok: true, skill: "office-skills" })).not.toContain("·");
  });
});

// ⚠ 2026-09-30 第二张截图（@office-skills 写采购审批方案）：规划阶段那一行「执行失败：加载技能：skill_not_found」
//   走的是 useSlideRuleSession 里另一条路，只读 event.error。
describe("规划阶段的步骤文案也留住名字", () => {
  it("技能失败 → 名字 + 错误码", () => {
    expect(liveToolResultDetail(notFound)).toBe("docx · skill_not_found");
  });

  it("反向：别的工具失败照旧是错误码", () => {
    expect(liveToolResultDetail({ tool: "file_read", ok: false, error: "project_file_not_found" })).toBe(
      "project_file_not_found"
    );
  });

  it("接在实时那条路上：onControlToolResult 用的是它，不是自己再读 event.error", () => {
    const src = readFileSync(resolve(__dirname, "../useSlideRuleSession.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const handler = src.slice(src.indexOf("onControlToolResult:"), src.indexOf("onControlProjectState:"));
    expect(handler).toContain("liveToolResultDetail(event)");
    expect(handler).not.toMatch(/typeof event\.error === "string"/);
  });
});
