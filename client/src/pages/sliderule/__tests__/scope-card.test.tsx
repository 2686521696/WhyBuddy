/**
 * PR-3 范围卡壳。拦的是 requestRehearsal / runTurn 全入口，不是 doSend。
 *
 * 判据必须能被变异咬住：
 *   · 删掉 requestRehearsal 里的 interceptRehearsalRequest → 确认前零 POST 红
 *   · 只拦 ComposerDock.doSend、sendMessage 仍 await runTurn → resend 红
 *   · 只测 doSend、不测 resend / repair / challenge → 本文件视为失败 PR
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isComposerSendBlocked } from "../ComposerDock";
import { IntakeHintBar, shouldShowIntakeHint } from "../IntakeHintBar";
import { ScopeCard } from "../ScopeCard";
import {
  interceptRehearsalRequest,
  restateAppGoal,
  SCOPE_CARD_CONFIRM_LABEL,
  SCOPE_CARD_REVISE_LABEL,
  SCOPE_CARD_TIME_COPY,
  scopeCardSteps,
  shouldSkipScopeCard,
  type ScopeCardPending,
} from "../scope-card-gate";
import { intakeHintYieldsToScopeCard } from "../use-intake-judge";
import type { IntakeJudgement } from "../use-intake-judge";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const SESSION = stripComments(
  readFileSync(new URL("../useSlideRuleSession.ts", import.meta.url), "utf8")
);
const DOCK = stripComments(
  readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
);
const PAGE = stripComments(
  readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
);
const CARD_SRC = stripComments(
  readFileSync(new URL("../ScopeCard.tsx", import.meta.url), "utf8")
);

const HINT: IntakeJudgement = {
  verdict: "vague",
  action: "hint",
  reason: "只说了行业没说要解决什么",
  guidance: "再补一句你想解决的具体问题。",
  rewrite: ["给咖啡烘焙工坊做生豆库存与烘焙批次管理"],
  confidence: 0.8,
  source: "llm",
  degradedReason: "",
  device: "unspecified",
  deviceReason: "",
};

const FULL_PENDING: ScopeCardPending = {
  userText: "做一个连锁宠物医院管理系统",
  restatement: "连锁宠物医院管理系统",
  variant: "full",
  device: "desktop",
};

function factoryPosts() {
  const urls: string[] = [];
  const drive = async () => {
    urls.push("/api/sliderule/drive-full-stream");
  };
  return { urls, drive };
}

describe("范围卡 DOM", () => {
  it("需要卡的意图确认前，DOM 有 sliderule-scope-card，文案无假分钟数", () => {
    const html = renderToStaticMarkup(
      <ScopeCard
        pending={FULL_PENDING}
        onConfirm={() => {}}
        onRevise={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-scope-card"');
    expect(html).toContain('data-variant="full"');
    expect(html).toContain("将做成：连锁宠物医院管理系统");
    expect(html).toContain("Web / PC");
    expect(html).toContain("起草 SPEC");
    expect(html).toContain("页面生成");
    expect(html).toContain(SCOPE_CARD_TIME_COPY);
    expect(html).toContain(SCOPE_CARD_CONFIRM_LABEL);
    expect(html).toContain(SCOPE_CARD_REVISE_LABEL);
    expect(html).not.toContain("取证（web.search，默认关）");
    expect(html).not.toContain('data-testid="sliderule-scope-evidence"');
    expect(html).not.toContain("澄清与取证");
    expect(html).not.toMatch(/8\s*[–-]\s*9/);
    expect(html).not.toContain("8 分钟");
    expect(html).not.toContain("约 2 分钟");
    expect(html).not.toContain("20 分钟");
  });

  it("迭代是薄卡：一句话 + 开始推演，仍无假分钟数", () => {
    const html = renderToStaticMarkup(
      <ScopeCard
        pending={{
          ...FULL_PENDING,
          userText: "收银员不能删除订单",
          restatement: "收银员不能删除订单",
          variant: "thin",
        }}
        onConfirm={() => {}}
        onRevise={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-scope-card"');
    expect(html).toContain('data-variant="thin"');
    expect(html).toContain("将做成：收银员不能删除订单");
    expect(html).toContain(SCOPE_CARD_CONFIRM_LABEL);
    expect(html).not.toContain('data-testid="sliderule-scope-steps"');
    expect(html).not.toContain("8 分钟");
    expect(html).not.toContain("约 2 分钟");
  });

  it("scopeCardSteps 仍是未接线 helper；产品卡不得再露取证勾选", () => {
    expect(scopeCardSteps(false)[0]).toBe("起草 SPEC");
    expect(scopeCardSteps(false)).not.toContain("澄清与取证");
    expect(CARD_SRC).not.toContain("取证（web.search，默认关）");
    expect(CARD_SRC).not.toContain("sliderule-scope-evidence");
    expect(SESSION).not.toContain("includeEvidence");
  });

  it("产品源码本身也不许写未标定分钟数", () => {
    expect(CARD_SRC).toContain("SCOPE_CARD_TIME_COPY");
    expect(CARD_SRC).not.toMatch(/8\s*[–-]\s*9/);
    expect(CARD_SRC).not.toContain("8 分钟");
    expect(CARD_SRC).not.toContain("约 2 分钟");
    expect(CARD_SRC).not.toContain("20 分钟");
    expect(SESSION).not.toMatch(/约\s*2\s*分钟/);
    expect(DOCK).not.toContain("8 分钟");
  });
});

describe("同一 send 禁止 hint 条和范围卡同时出现", () => {
  it("范围卡开着时 hint 条让路", () => {
    expect(intakeHintYieldsToScopeCard(true)).toBe(false);
    expect(intakeHintYieldsToScopeCard(false)).toBe(true);
    expect(shouldShowIntakeHint(HINT, true)).toBe(false);
    expect(shouldShowIntakeHint(HINT, false)).toBe(true);
    expect(
      renderToStaticMarkup(
        <IntakeHintBar judgement={HINT} scopeCardOpen onRewrite={() => {}} />
      )
    ).toBe("");
  });

  it("ComposerDock 活路径：pendingScope 时挂 ScopeCard，不并排 IntakeHintBar", () => {
    // ⚠ 必须查 JSX 挂载点。只 import ScopeCard 不渲染是不通电的插座。
    expect(DOCK).toContain("<ScopeCard");
    expect(DOCK).toContain("pendingScope");
    const overlay = DOCK.slice(
      DOCK.indexOf("{pendingScope && onConfirmScope"),
      DOCK.indexOf("{hero ? null : sendButton}")
    );
    expect(overlay).toContain("<ScopeCard");
    expect(overlay).toContain("key={pendingScope.userText}");
    expect(overlay).toContain("onConfirm={onConfirmScope}");
    expect(overlay).toContain("<IntakeHintBar");
    expect(overlay).toContain("intakeHintYieldsToScopeCard");
    // 变异：两个都无条件渲染 → 不再是三元/让路
    expect(overlay).toMatch(/pendingScope[\s\S]*<ScopeCard[\s\S]*IntakeHintBar/);
    expect(overlay).not.toMatch(/<ScopeCard[\s\S]*\/>\s*<IntakeHintBar/);
    expect(overlay).not.toContain("onConfirm={() => onConfirmScope()}");
  });
});

describe("拦截点是 requestRehearsal，不是 doSend", () => {
  it("sendMessage / resend-prompt 走 requestRehearsal，不是 doSend", async () => {
    const sendMessageFn = SESSION.slice(
      SESSION.indexOf("const sendMessage"),
      SESSION.indexOf("const repairGaps")
    );
    expect(sendMessageFn).toContain("requestRehearsal");
    expect(sendMessageFn).not.toContain("runTurn");

    const requestFn = SESSION.slice(
      SESSION.indexOf("const requestRehearsal = async"),
      SESSION.indexOf("const confirmControlScope")
    );
    expect(requestFn).toContain("await runTurn(");
    expect(requestFn).not.toContain("interceptRehearsalRequest");
    expect(requestFn).not.toContain("SCOPE_CARD_DRIVE_FULL_BYPASS");

    const resendListen = 'addEventListener("sliderule:resend-prompt"';
    expect(PAGE).toContain(resendListen);
    const resend = PAGE.slice(
      PAGE.indexOf(resendListen) - 280,
      PAGE.indexOf(resendListen) + 160
    );
    expect(resend).toContain("sendMessageRef.current");
    expect(resend).not.toContain("doSend");

    const doSend = DOCK.slice(
      DOCK.indexOf("const doSend = React.useCallback"),
      DOCK.indexOf("const [installedSkills")
    );
    expect(doSend).toContain("sendMessage");
    expect(doSend).not.toContain("requestRehearsal");
    expect(doSend).not.toContain("runTurn");
    expect(doSend).toContain("scopeCardOpen: Boolean(pendingScope)");
  });

  it("/推演 不得在客户端带 forcedTool rehearse", () => {
    expect(SESSION).toContain("export function inferForcedTool");
    const inferFn = SESSION.slice(
      SESSION.indexOf("export function inferForcedTool"),
      SESSION.indexOf("const DEFAULT_SESSION_ID")
    );
    expect(inferFn).toContain('mode === "repair"');
    expect(inferFn).toContain('intent === "challenge"');
    expect(inferFn).toContain('t.startsWith("/精修")');
    expect(inferFn).not.toContain('"/推演"');
    expect(inferFn).not.toContain('"rehearse"');
  });

  it("确认走 control-turn forcedTool rehearse，不再走 drive-full 旁路", () => {
    const confirmFn = SESSION.slice(
      SESSION.indexOf("const confirmControlScope"),
      SESSION.indexOf("const dismissScopeCard")
    );
    expect(confirmFn).toContain("await runTurn(");
    expect(confirmFn).toContain('"rehearse"');
    expect(confirmFn).toContain("snapshot.restatement");
    expect(confirmFn).not.toContain("SCOPE_CARD_DRIVE_FULL_BYPASS");
    expect(confirmFn).not.toContain("factoryProfile");
    expect(SESSION).not.toContain("confirmScopeCardAndDriveFull");
    expect(SESSION).toContain("runTurn: requestRehearsal");
  });

  it("interceptRehearsalRequest 是未接线 helper 单测；活路径 skip 在 POST mode=repair", async () => {
    const repair = factoryPosts();
    const repairParked: unknown[] = [];
    expect(
      await interceptRehearsalRequest(
        { userText: "补齐证据缺口", mode: "repair" },
        { hasExistingGoal: true },
        repair.drive,
        next => {
          repairParked.push(next);
        }
      )
    ).toBe("driven");
    expect(repair.urls).toEqual(["/api/sliderule/drive-full-stream"]);
    expect(repairParked).toEqual([]);
    expect(shouldSkipScopeCard({ userText: "补齐证据缺口", mode: "repair" })).toBe(
      true
    );

    const challenge = factoryPosts();
    expect(
      await interceptRehearsalRequest(
        {
          userText: "这个结论的依据不够充分，请重新推演。",
          intervention: { intent: "challenge", text: "这个结论的依据不够充分，请重新推演。" },
        },
        { hasExistingGoal: true },
        challenge.drive,
        () => {
          throw new Error("challenge 不得 park");
        }
      )
    ).toBe("driven");
    expect(challenge.urls).toEqual(["/api/sliderule/drive-full-stream"]);
    expect(
      shouldSkipScopeCard({
        userText: "x",
        intervention: { intent: "challenge" },
      })
    ).toBe(true);

    const repairFn = SESSION.slice(
      SESSION.indexOf("const repairGaps"),
      SESSION.indexOf("const restoreModelVersion")
    );
    expect(repairFn).toContain('requestRehearsal("补齐证据缺口"');
    expect(repairFn).toContain('"repair"');
    expect(repairFn).not.toContain("runTurn(");

    const challengeFn = SESSION.slice(
      SESSION.indexOf("const challengeTurn"),
      SESSION.indexOf("const resetSession")
    );
    expect(challengeFn).toContain("requestRehearsal(");
    expect(challengeFn).toContain('intent: "challenge"');
    expect(challengeFn).not.toContain("runTurn(");

    expect(
      shouldSkipScopeCard({
        userText: "「范围」答：门店",
        intervention: { intent: "clarify" },
      })
    ).toBe(true);
    expect(
      shouldSkipScopeCard({
        userText: "续播",
        resumeRun: { runId: "run-1" },
      })
    ).toBe(true);

    // 活路径：续播 hydrate 必须带 runId，否则会 park 卡、确认前不 GET stream。
    const resumeFx = SESSION.slice(
      SESSION.indexOf("resumeAttemptedRef"),
      SESSION.indexOf("const resolveInteractiveGate")
    );
    expect(resumeFx).toContain("requestRehearsal(");
    const resumeCall = resumeFx.slice(
      resumeFx.indexOf("requestRehearsal("),
      resumeFx.indexOf("requestRehearsal(") + 240
    );
    expect(resumeCall).toContain("runId:");
    expect(resumeCall).not.toMatch(/requestRehearsal\([^,)]+\)/);

    const clarifyFn = SESSION.slice(
      SESSION.indexOf("const answerClarifications"),
      SESSION.indexOf("runTurn: requestRehearsal")
    );
    expect(clarifyFn).toContain("requestRehearsal(");
    expect(clarifyFn).toContain('intent: "clarify"');
    expect(clarifyFn).not.toContain("runTurn(");

    const genFn = SESSION.slice(
      SESSION.indexOf("const generateDeliverables"),
      SESSION.indexOf("const answerClarifications")
    );
    expect(genFn).toContain("requestRehearsal(");
    expect(genFn).toContain('intent: "generate_plan"');
    expect(genFn).not.toContain("runTurn(");
  });

  it("skip 驱动和重置必须清 pendingScope，删掉 clear 必须红", () => {
    const clearFn = SESSION.slice(
      SESSION.indexOf("const clearPendingScope"),
      SESSION.indexOf("const clearPendingScope") + 160
    );
    expect(clearFn).toContain("pendingScopeRef.current = null");
    expect(clearFn).toContain("setPendingScope(null)");

    const requestFn = SESSION.slice(
      SESSION.indexOf("const requestRehearsal = async"),
      SESSION.indexOf("const confirmControlScope")
    );
    expect(requestFn).toContain("clearPendingScope()");
    expect(requestFn.indexOf("clearPendingScope()")).toBeLessThan(
      requestFn.lastIndexOf("await runTurn")
    );

    const resetFn = SESSION.slice(
      SESSION.indexOf("const resetSession"),
      SESSION.indexOf("const pendingClarifications")
    );
    expect(resetFn).toContain("clearPendingScope()");
    expect(resetFn).toContain("setPendingAsk(null)");

    const repairFn = SESSION.slice(
      SESSION.indexOf("const repairGaps"),
      SESSION.indexOf("const restoreModelVersion")
    );
    expect(repairFn).toContain("requestRehearsal(");
    expect(repairFn).not.toContain("runTurn(");
  });

  it("ComposerDock 挂上了 pendingScope，SlideRule 真的把确认旁路传进去", () => {
    const call = PAGE.slice(
      PAGE.indexOf("<ComposerDock"),
      PAGE.indexOf("<ComposerDock") + 1200
    );
    expect(call).toContain("pendingScope={pendingScope}");
    expect(call).toContain("onConfirmScope={confirmControlScope}");
    expect(call).toContain("onReviseScope={dismissScopeCard}");
  });
});

describe("looksLikeNewAppIntent 自动重置已关", () => {
  it("runTurn 不再按新应用意图静默清会话", () => {
    const runTurnBody = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    expect(runTurnBody).not.toContain("looksLikeNewAppIntent");
    expect(runTurnBody).not.toContain("autoNewTopic = true");
    expect(runTurnBody).not.toContain("prepareVisibleResetSessionState");
    expect(runTurnBody).toContain("closedTopicFollowUp = true");
    expect(runTurnBody).toContain("要开始新应用请点右上角重置会话");
    expect(runTurnBody).not.toContain("做一个××系统");
    expect(runTurnBody).not.toContain("请说「");
  });
});

describe("复述与 pending 整份替换", () => {
  it("复述剥掉做一个/帮我做个，不是另一套假分钟数", () => {
    expect(restateAppGoal("做一个连锁宠物医院管理系统")).toBe(
      "连锁宠物医院管理系统"
    );
    expect(restateAppGoal("帮我做个宠物医院预约平台")).toBe(
      "宠物医院预约平台"
    );
    expect(restateAppGoal("收银员不能删除订单")).toBe("收银员不能删除订单");
  });

  it("后一次 park 整份替换，不把上一句意图留给确认", () => {
    const confirmFn = SESSION.slice(
      SESSION.indexOf("const confirmControlScope"),
      SESSION.indexOf("const dismissScopeCard")
    );
    expect(confirmFn).not.toContain("setPendingScope(prev");
    expect(confirmFn).toContain("pendingScopeRef.current");
    expect(confirmFn).not.toContain("pendingScope.");
  });
});

describe("范围卡停泊时发送只能走确认/先改范围", () => {
  it("pendingScope 锁 composer send，Enter 不得另 park", () => {
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "做一个宠物医院预约系统",
        attachments: [],
        scopeCardOpen: true,
      })
    ).toBe(true);
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "做一个宠物医院预约系统",
        attachments: [],
        scopeCardOpen: false,
      })
    ).toBe(false);
    expect(DOCK).toContain("scopeCardOpen: Boolean(pendingScope)");
    expect(DOCK).toContain(
      "disabled={isRunning || Boolean(pendingScope) || Boolean(pendingAsk)}"
    );
    expect(DOCK).toContain("askOpen: Boolean(pendingAsk)");
    expect(DOCK).toContain("key={pendingScope.userText}");
    expect(DOCK).toContain("onConfirm={onConfirmScope}");
    expect(
      isComposerSendBlocked({
        isRunning: false,
        input: "你好",
        attachments: [],
        askOpen: true,
      })
    ).toBe(true);
  });
});
