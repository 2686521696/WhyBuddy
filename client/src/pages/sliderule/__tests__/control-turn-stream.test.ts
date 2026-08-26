/**
 * 产品新烧 POST /control-turn-stream；续播 GET /runs/{id}/stream。
 *
 * 反向：
 *   · 把产品路径改回 POST /drive-full-stream → 剥注释后计数不再是 0
 *   · 删掉 postControlTurnStream 里的 installedSkillsDrivePayload → 六字段红
 *   · pythonDrive 空结果再挂 driveReasoningSession → 本文件红
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { consumeControlStreamResponse } from "../../../lib/sliderule-marathon-driver";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const SESSION = stripComments(
  readFileSync(new URL("../useSlideRuleSession.ts", import.meta.url), "utf8")
);
const DRIVER = stripComments(
  readFileSync(
    new URL("../../../lib/sliderule-marathon-driver.ts", import.meta.url),
    "utf8"
  )
);
const DOCK = stripComments(
  readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
);
const CARD = stripComments(
  readFileSync(new URL("../ScopeCard.tsx", import.meta.url), "utf8")
);

function countNeedle(src: string, needle: string): number {
  let n = 0;
  let from = 0;
  while (from <= src.length) {
    const at = src.indexOf(needle, from);
    if (at < 0) return n;
    n += 1;
    from = at + needle.length;
  }
  return n;
}

describe("干预字段一路带到 POST（三段都得接上）", () => {
  /*
   * ⚠ 这条钉的是**中间那一段**：runTurn 把 intervention 上的
   *   targetArtifactId / answeredGapIds 交给 driveStream。
   *   两头各有自己的判据——
   *     客户端出口：control-post-carries-intervention.test.ts（真 fetch body）
   *     服务端入口：test_challenge_and_gaps_reach_state.py（真 HTTP + 真状态）
   *   ——唯独中间这一段只存在于 hook 里，测不动，所以在源码上钉。
   *   2026-08-27 断的正是这一段：两头都写好了，中间没接。
   */
  const runTurn = SESSION.slice(
    SESSION.indexOf("const runTurn = async"),
    SESSION.indexOf("const requestRehearsal = async")
  );

  it("runTurn 把 targetArtifactId / answeredGapIds 交给 driveStream", () => {
    expect(runTurn).toContain("intervention?.targetArtifactId");
    expect(runTurn).toContain("intervention?.answeredGapIds");
    const opts = runTurn.slice(runTurn.indexOf("driveStream(preparedState"));
    expect(opts).toContain("targetArtifactId:");
    expect(opts).toContain("answeredGapIds:");
  });

  it("反向：这两样只能挂在**新烧**那一支，续播不许带", () => {
    const resume = runTurn.slice(
      runTurn.indexOf("resumeDriveFullStream"),
      runTurn.indexOf("driveStream(preparedState")
    );
    expect(resume).not.toContain("targetArtifactId");
    expect(resume).not.toContain("answeredGapIds");
  });
});

describe("产品客户端不得再 POST 工厂流", () => {
  it("useSlideRuleSession 剥注释后 POST /drive-full-stream 与 /drive-full 都是 0", () => {
    expect(countNeedle(SESSION, "/drive-full-stream")).toBe(0);
    expect(countNeedle(SESSION, "/drive-full")).toBe(0);
    expect(SESSION).toContain("postControlTurnStream");
    expect(SESSION).not.toContain("driveFullViaPythonStream");
  });

  it("续播仍是 GET /runs/{id}/stream", () => {
    expect(DRIVER).toContain("/api/sliderule/runs/");
    expect(DRIVER).toContain("/stream?since=0");
    const resumeFn = DRIVER.slice(
      DRIVER.indexOf("export async function resumeDriveFullStream"),
      DRIVER.indexOf("type FactoryStreamAcc")
    );
    expect(resumeFn).not.toContain("control-turn-stream");
    expect(resumeFn.toLowerCase()).not.toContain('method: "post"');
    const pythonDrive = SESSION.slice(
      SESSION.indexOf("const pythonDrive = resumeRun"),
      SESSION.indexOf("classifyStreamFallback")
    );
    expect(pythonDrive.indexOf("resumeDriveFullStream")).toBeGreaterThanOrEqual(
      0
    );
    expect(pythonDrive.indexOf("resumeDriveFullStream")).toBeLessThan(
      pythonDrive.indexOf("driveStream(")
    );
  });

  it("runTurn python 空结果不得回落 driveReasoningSession", () => {
    const runTurn = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    expect(runTurn).toContain("控制面未返回结果");
    const nullArm = runTurn.slice(runTurn.indexOf("if (!pythonDrive)"));
    expect(nullArm).toContain("throw new Error");
    expect(nullArm).not.toContain("driveReasoningSession");
    expect(runTurn).not.toContain("driveReasoningSession");
  });

  it("删掉 driveFullViaPythonStream 之后产品 POST 仍带 installedSkillsDrivePayload", () => {
    expect(SESSION).not.toContain("driveFullViaPythonStream");
    const postFn = DRIVER.slice(
      DRIVER.indexOf("export async function postControlTurnStream"),
      DRIVER.indexOf("export async function consumeControlStreamResponse")
    );
    expect(postFn).toContain("installedSkillsDrivePayload()");
    expect(postFn).toContain("pickedConnectorIds");
    expect(postFn).toContain("sessionId: state.sessionId");
    expect(postFn).toContain("userText");
    expect(postFn).toContain("preferredDevice");
    expect(postFn).toContain("designSystemId");
    expect(postFn).toContain("/api/sliderule/control-turn-stream");
    expect(postFn).toContain("reuseCharter");
    expect(postFn).toContain("productCharter");
    expect(postFn).toContain("opts.reuseCharter !== undefined");
    const runTurn = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    expect(runTurn).toContain("reuseCharter: loadCharterReuseNext()");
    expect(runTurn).toContain("!== null");
  });
});

describe("开始推演 / 质疑 / /推演", () => {
  it("confirmControlScope POST forcedTool rehearse，/推演 客户端不得带 rehearse", () => {
    const confirmFn = SESSION.slice(
      SESSION.indexOf("const confirmControlScope"),
      SESSION.indexOf("const dismissScopeCard")
    );
    expect(confirmFn).toContain('"rehearse"');
    expect(confirmFn).toContain("snapshot.restatement");
    const inferFn = SESSION.slice(
      SESSION.indexOf("export function inferForcedTool"),
      SESSION.indexOf("const DEFAULT_SESSION_ID")
    );
    expect(inferFn).not.toContain('"/推演"');
    expect(inferFn).not.toContain('"rehearse"');
    expect(CARD).toContain("onConfirm");
    expect(DOCK).toContain('data-testid="sliderule-control-ask"');
  });

  it("先改范围 POST dismiss_scope；reload 从 transcript 恢复 ask options", () => {
    const dismissFn = SESSION.slice(
      SESSION.indexOf("const dismissScopeCard"),
      SESSION.indexOf("const stop =")
    );
    expect(dismissFn).toContain("dismiss_scope");
    expect(dismissFn).toContain("postControlTurnStream");
    const hydrate = SESSION.slice(
      SESSION.indexOf('hydrated.awaitReason === "control_ask"'),
      SESSION.indexOf("options.initialGoal")
    );
    expect(hydrate).toContain("ask_user");
    expect(hydrate).toContain("options");
  });
});

describe("consumeControlStreamResponse 与工厂 case 共用", () => {
  it("handoff 之后走 applyFactoryStreamEvent，不复制 skill_start switch", () => {
    const consume = DRIVER.slice(
      DRIVER.indexOf("export async function consumeControlStreamResponse"),
      DRIVER.indexOf("export interface FrontierProposal")
    );
    expect(consume).toContain("applyFactoryStreamEvent");
    expect(consume).toContain("control_ask_user");
    expect(consume).toContain("control_scope_card");
    expect(consume).toContain("control_handoff_factory");
    const skillStartCases = countNeedle(consume, 'case "skill_start"');
    expect(skillStartCases).toBe(0);
  });

  it("control_ask_user 回调后 complete 结束，不丢问题", async () => {
    const asked: Array<{ question: string }> = [];
    const skills: string[] = [];
    const events = [
      { type: "control_ask_user", question: "你想做什么应用？", options: [] },
      {
        type: "complete",
        state: {
          sessionId: "s1",
          goal: { text: "", status: "needs_refinement" },
          awaitReason: "control_ask",
        },
      },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    const out = await consumeControlStreamResponse(res, {
      onControlAskUser: ev => asked.push({ question: ev.question }),
      onSkillActivated: id => skills.push(String(id)),
    });
    expect(asked).toEqual([{ question: "你想做什么应用？" }]);
    expect(skills).toEqual([]);
    expect(out?.finalState?.awaitReason).toBe("control_ask");
  });

  it("control_tool_result 人话只进 onControlText 一次，不得双写", async () => {
    const texts: string[] = [];
    const tools: unknown[] = [];
    const events = [
      {
        type: "control_tool_result",
        tool: "inspect_model",
        ok: true,
        digest: "appName: 请假审批",
        human: "当前模型摘要（有界，不是原始五系统 JSON）。",
      },
      {
        type: "complete",
        state: {
          sessionId: "s1",
          goal: { text: "请假系统", status: "clear" },
        },
      },
    ];
    const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
    const res = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
    await consumeControlStreamResponse(res, {
      onControlText: text => texts.push(text),
      onControlToolResult: event => tools.push(event),
    });
    expect(tools).toHaveLength(1);
    expect(texts).toEqual(["当前模型摘要（有界，不是原始五系统 JSON）。"]);
    const consume = DRIVER.slice(
      DRIVER.indexOf("export async function consumeControlStreamResponse"),
      DRIVER.indexOf("export interface FrontierProposal")
    );
    expect(consume).toContain("onControlToolResult");
    expect(consume).toContain("onControlText");
    const streamOpts = SESSION.slice(
      SESSION.indexOf("onControlText:"),
      SESSION.indexOf("onControlAskUser:")
    );
    expect(streamOpts).not.toContain("onControlToolResult");
  });
});
