/**
 * 规划轮（工程还没建）里的技能加载，左栏一次一行、带技能名。
 *
 * ⚠ 2026-10-01 用户本机截图（「做一个象棋游戏」，规划问答阶段）：左栏两组各六行
 *   「加载技能 / 已加载技能 / 加载技能 / 已加载技能 …」，一个技能名都没有。会话还不算 project，
 *   这一轮落到 HTML 推演的阶段带（TurnPhaseTimeline），它只读 chip 的 label：一次加载的开始、结束各一行，
 *   projectDetail（技能名）不画。批准后整份会话切到 SessionStory，同一轮又正常——所以隔离环境
 *   （一开场就是工程档）一直撞不上。
 *
 * 步骤照直播路径的真形状拼（useSlideRuleSession 的 appendStreamStep：开始一发「正在加载技能」+ 摘要，
 * 结束一发「已加载技能」+ projectActionDetail(回执)），回执是服务端 skill 工具的原样形状。
 * 把 turnUsesSessionStory 改回只看 runtimeKind，第一条变红；SlideRule.tsx 两支不接它，最后一条变红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  liveToolResultDetail,
  projectActionDetail,
  turnUsesSessionStory,
} from "../project-activity";
import { deriveSessionStory, timelineRowTitle } from "../session-story";
import type { TurnStep, UiTurn } from "../types";

let seq = 0;
function streamChip(label: string, opts: { capabilityId: string; progressType: string; projectDetail?: string }): TurnStep {
  seq += 1;
  return {
    id: `t1-stream-${seq}`,
    kind: "chip",
    capabilityId: opts.capabilityId as never,
    roleId: "system",
    label,
    realLlm: false,
    loopTurnId: "t1",
    progressType: opts.progressType as never,
    ...(opts.projectDetail ? { projectDetail: opts.projectDetail } : {}),
  } as TurnStep;
}

/** 一次 skill 调用在直播路径上产出的两步（onControlToolStart + onControlToolResult）。 */
function skillLoad(name: string): TurnStep[] {
  const result = { type: "control_tool_result", tool: "skill", ok: true, skill: name, seedBytes: 2779 };
  const detail = liveToolResultDetail(result);
  const label = "已加载技能";
  return [
    streamChip("正在加载技能", { capabilityId: "skill", progressType: "acting", projectDetail: name }),
    streamChip(detail ? `${label}：${detail}` : label, {
      capabilityId: "skill",
      progressType: "completed",
      projectDetail: projectActionDetail(result),
    }),
  ];
}

const planningTurn = {
  id: "t1",
  user: "做一个象棋游戏",
  status: "complete",
  steps: [...skillLoad("frontend-design"), ...skillLoad("responsive-design"), ...skillLoad("webapp-testing")],
} as unknown as UiTurn;

describe("规划轮的技能加载", () => {
  it("工程还没建也走 SessionStory", () => {
    expect(turnUsesSessionStory(planningTurn, "html-prototype")).toBe(true);
    expect(turnUsesSessionStory(planningTurn, undefined)).toBe(true);
  });

  it("三次加载是三行，每行都带技能名", () => {
    const tools = deriveSessionStory(planningTurn).find(
      (block): block is Extract<typeof block, { kind: "tools" }> => block.kind === "tools"
    );
    expect(tools?.rows.map(timelineRowTitle)).toEqual([
      "加载技能 frontend-design",
      "加载技能 responsive-design",
      "加载技能 webapp-testing",
    ]);
  });

  it("反向：HTML 推演的工厂步仍画阶段带", () => {
    const factory = {
      id: "t2",
      user: "做个采购审批",
      status: "complete",
      steps: [
        { id: "n1", kind: "narration", text: "接收意图" },
        { ...streamChip("起草 SPEC", { capabilityId: "spec", progressType: "completed" }) },
        { ...streamChip("画页面", { capabilityId: "pages", progressType: "completed" }) },
      ],
    } as unknown as UiTurn;
    expect(turnUsesSessionStory(factory, "html-prototype")).toBe(false);
    expect(turnUsesSessionStory(factory, "project")).toBe(true);
  });
});

describe("接线：SlideRule.tsx 流式 / 完成两支都按 turnUsesSessionStory 分（§四 成对物）", () => {
  it("两支 SessionStory、两支 TurnPhaseTimeline 都看同一个判断", () => {
    const src = readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).toContain("const usesStory = turnUsesSessionStory(turn, runtimeKind)");
    expect(src.match(/\{usesStory \? \(\s*<SessionStory/g)?.length).toBe(2);
    expect(src.match(/\{!usesStory \? \(\s*<TurnPhaseTimeline/g)?.length).toBe(2);
    expect(src).not.toMatch(/runtimeKind === "project" \? \(\s*<SessionStory/);
  });
});
