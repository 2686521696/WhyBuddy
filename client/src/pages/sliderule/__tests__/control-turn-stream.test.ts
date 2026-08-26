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
});
