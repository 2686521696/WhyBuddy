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
import { beforeEach, describe, expect, it } from "vitest";

import {
  saveProductCharter,
  setCharterReuseNext,
} from "../product-charter";

const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;

import { isComposerSendBlocked } from "../ComposerDock";
import { IntakeHintBar, shouldShowIntakeHint } from "../IntakeHintBar";
import { ScopeCard } from "../ScopeCard";
import {
  interceptRehearsalRequest,
  lockScopeMorphology,
  normalizeScopeTools,
  restateAppGoal,
  SCOPE_CARD_CONFIRM_LABEL,
  SCOPE_CARD_PUBLIC_TOOLS,
  SCOPE_CARD_REVISE_LABEL,
  SCOPE_CARD_TIME_COPY,
  scopeCardSteps,
  scopeCardStepsFromTools,
  shouldSkipScopeCard,
  type ScopeCardPending,
} from "../scope-card-gate";
import {
  setPreferredDevice,
  setProductArchetype,
} from "../user-prefs";
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
    expect(html).toContain('data-testid="sliderule-scope-archetype"');
    expect(html).toContain("业务 / 后台应用");
    expect(html).toContain('data-testid="sliderule-scope-device-tablet"');
    expect(html).toContain("平板");
    expect(html).toContain("起草 SPEC");
    expect(html).toContain("页面生成");
    expect(html).toContain('data-testid="sliderule-scope-tools"');
    expect(html).toContain('data-testid="sliderule-scope-tool-spec"');
    expect(html).toContain('data-testid="sliderule-scope-tool-pages"');
    expect(html).toContain('data-testid="sliderule-scope-tool-structure"');
    expect(html).toContain('data-testid="sliderule-scope-tool-bind"');
    expect(html).toContain('data-testid="sliderule-scope-tool-closure"');
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
    expect(html).toContain("下一场沿用");
    expect(html).toContain('data-testid="sliderule-scope-charter-reuse"');
    expect(html).toContain("宪章是约束，不是证据");
    expect(html).toContain('data-testid="sliderule-scope-charter-fields"');
    expect(html).toContain('data-testid="sliderule-scope-charter-industry"');
    expect(html).toContain('data-testid="sliderule-scope-charter-industry-电商"');
    expect(html).toContain('data-testid="sliderule-scope-charter-defaultRoles-客服"');
    expect(html).not.toContain('placeholder="行业"');
    expect(html).not.toContain('placeholder="术语"');
    expect(html).not.toContain('placeholder="默认角色"');
    expect(html).not.toContain('placeholder="硬性合规"');
    expect(html).not.toContain('placeholder="品牌约束"');
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
    expect(html).not.toContain('data-testid="sliderule-scope-tools"');
    expect(html).not.toContain("8 分钟");
    expect(html).not.toContain("约 2 分钟");
    expect(html).toContain("下一场沿用");
    expect(html).toContain('data-testid="sliderule-scope-charter-reuse"');
    expect(html).not.toContain('data-testid="sliderule-scope-charter-fields"');
  });

  it("scopeCardSteps 仍是未接线 helper；产品卡不得再露取证勾选", () => {
    expect(scopeCardSteps(false)[0]).toBe("起草 SPEC");
    expect(scopeCardSteps(false)).not.toContain("澄清与取证");
    expect(CARD_SRC).not.toContain("取证（web.search，默认关）");
    expect(CARD_SRC).not.toContain("sliderule-scope-evidence");
    expect(SESSION).not.toContain("includeEvidence");
  });

  it("规划器勾选是公开五件套，空清单回落到全开，不许扣光最后一件", () => {
    expect(SCOPE_CARD_PUBLIC_TOOLS.map(row => row.id)).toEqual([
      "spec",
      "pages",
      "structure",
      "bind",
      "closure",
    ]);
    expect(normalizeScopeTools(undefined)).toEqual([
      "spec",
      "pages",
      "structure",
      "bind",
      "closure",
    ]);
    expect(normalizeScopeTools(["closure", "invented", "spec"])).toEqual([
      "spec",
      "closure",
    ]);
    expect(scopeCardStepsFromTools(["spec", "pages"])).toEqual([
      "起草 SPEC",
      "页面生成",
    ]);
    expect(CARD_SRC).toContain("prev.length === 1");
    expect(CARD_SRC).toContain("toggleTool");
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
      DOCK.indexOf('data-testid="sliderule-composer-context"')
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

  it("确认推演把宪章 opt-in 送进 control-turn，不是包一层 onConfirm", () => {
    expect(CARD_SRC).toContain("下一场沿用");
    expect(CARD_SRC).toContain("setCharterReuseNext");
    expect(CARD_SRC).toContain("saveProductCharter");
    const runTurnBody = SESSION.slice(
      SESSION.indexOf("const runTurn = async"),
      SESSION.indexOf("const requestRehearsal = async")
    );
    expect(runTurnBody).toContain("loadCharterReuseNext");
    expect(runTurnBody).toContain("hydrateScopeCharter");
    expect(runTurnBody).toContain("reuseCharter");
    expect(runTurnBody).toContain("!== null");
    expect(runTurnBody).toContain('"rehearse"');
    expect(runTurnBody).toContain('"productCharter"');
    expect(CARD_SRC).toContain("initialReuseNext");
    expect(CARD_SRC).toContain("pending.charterReuseNext");
    expect(CARD_SRC).toContain("hydrateScopeCharter");
    expect(CARD_SRC).toContain("productCharter: charter");
    expect(CARD_SRC).toContain("charterFieldChips");
    expect(SESSION).not.toContain("from \"./ScopeCard\"");
    expect(SESSION).not.toContain("from \"./SlideRuleStudio\"");
    expect(CARD_SRC).toContain("toggleCharterChoice");
    expect(CARD_SRC).not.toContain("placeholder={label}");
    expect(CARD_SRC).not.toContain("onChange={e => patchCharter");
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
      SESSION.indexOf("export function previousModelVersionId")
    );
    expect(inferFn).toContain('mode === "repair"');
    expect(inferFn).toContain('intent === "challenge"');
    expect(inferFn).toContain("parseRehearsalSlash");
    expect(inferFn).toContain("forcedToolForRehearsalVerb");
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

describe("范围卡宪章跟命题走，不跟上一场走", () => {
  beforeEach(() => {
    memStore.clear();
    try {
      localStorage.clear();
    } catch {
      /* 上面 ??= 已经挂了 memStore */
    }
    setCharterReuseNext(false);
    saveProductCharter({
      industry: "企业服务",
      defaultRoles: "店长、员工",
      terms: "工单、审批",
    });
  });

  it("不勾下一场沿用：企业服务/店长不得亮着，股票分析器要有行情", () => {
    const html = renderToStaticMarkup(
      <ScopeCard
        pending={{
          userText: "做一个股票分析器",
          restatement: "股票分析器",
          variant: "full",
          device: "desktop",
          charterReuseNext: false,
        }}
        onConfirm={() => {}}
        onRevise={() => {}}
      />
    );
    expect(html).toContain("将做成：股票分析器");
    expect(html).toContain("行情");
    expect(html).toContain("投资者");
    const industry = html.slice(
      html.indexOf('data-testid="sliderule-scope-charter-industry-企业服务"')
    );
    expect(industry.slice(0, 180)).toContain('aria-pressed="false"');
    const role = html.slice(
      html.indexOf('data-testid="sliderule-scope-charter-defaultRoles-店长"')
    );
    expect(role.slice(0, 180)).toContain('aria-pressed="false"');
  });

  it("勾了下一场沿用：才把上一场企业服务亮上", () => {
    setCharterReuseNext(true);
    const html = renderToStaticMarkup(
      <ScopeCard
        pending={{
          userText: "做一个股票分析器",
          restatement: "股票分析器",
          variant: "full",
          device: "desktop",
          charterReuseNext: true,
        }}
        onConfirm={() => {}}
        onRevise={() => {}}
      />
    );
    const industry = html.slice(
      html.indexOf('data-testid="sliderule-scope-charter-industry-企业服务"')
    );
    expect(industry.slice(0, 180)).toContain('aria-pressed="true"');
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

describe("范围卡原型和设备档锁死作曲家选择", () => {
  beforeEach(() => {
    memStore.clear();
    try {
      localStorage.clear();
    } catch {
      /* memStore */
    }
  });

  it("外面选的平板/自由类型带进卡，桌面不得亮着", () => {
    setPreferredDevice("tablet");
    setProductArchetype("free_app");
    const html = renderToStaticMarkup(
      <ScopeCard
        pending={{
          userText: "团子的一天",
          restatement: "团子的一天",
          variant: "full",
          device: "desktop",
          productArchetype: "business_app",
        }}
        onConfirm={() => {}}
        onRevise={() => {}}
      />
    );
    expect(html).toContain("设备档：平板");
    const tablet = html.slice(
      html.indexOf('data-testid="sliderule-scope-device-tablet"')
    );
    expect(tablet.slice(0, 220)).toContain('aria-pressed="true"');
    const desktop = html.slice(
      html.indexOf('data-testid="sliderule-scope-device-desktop"')
    );
    expect(desktop.slice(0, 220)).toContain('aria-pressed="false"');
    const free = html.slice(
      html.indexOf('data-testid="sliderule-scope-archetype-free_app"')
    );
    expect(free.slice(0, 220)).toContain('aria-pressed="true"');
    const biz = html.slice(
      html.indexOf('data-testid="sliderule-scope-archetype-business_app"')
    );
    expect(biz.slice(0, 220)).toContain('aria-pressed="false"');
    expect(html).not.toContain("设备档：Web / PC");
  });

  it("原型和设备档置灰锁死，本轮能力仍能点", () => {
    setPreferredDevice("tablet");
    setProductArchetype("free_app");
    const html = renderToStaticMarkup(
      <ScopeCard
        pending={{
          ...FULL_PENDING,
          device: "desktop",
          productArchetype: "business_app",
        }}
        onConfirm={() => {}}
        onRevise={() => {}}
      />
    );
    const archetype = html.slice(
      html.indexOf('data-testid="sliderule-scope-archetype"'),
      html.indexOf('data-testid="sliderule-scope-device"')
    );
    expect(archetype).toContain('data-locked="true"');
    expect(archetype).toContain("disabled");
    expect(archetype).toContain('aria-disabled="true"');
    expect(archetype).toContain("cursor-not-allowed");
    const device = html.slice(
      html.indexOf('data-testid="sliderule-scope-device"'),
      html.indexOf('data-testid="sliderule-scope-tools"')
    );
    expect(device).toContain('data-locked="true"');
    expect(device).toContain("disabled");
    expect(device).toContain('aria-disabled="true"');
    const tools = html.slice(
      html.indexOf('data-testid="sliderule-scope-tools"'),
      html.indexOf('data-testid="sliderule-scope-steps"')
    );
    expect(tools).not.toContain("disabled");
    expect(tools).not.toContain("cursor-not-allowed");
    expect(CARD_SRC).toContain("lockScopeMorphology");
    expect(CARD_SRC).toContain("cursor-not-allowed");
    expect(CARD_SRC).not.toContain("setDevice(");
    expect(CARD_SRC).not.toContain("setProductArchetype(");
    expect(SESSION).toContain("lockScopeMorphology");
  });

  it("开始推演 POST 作曲家档，不是 park 事件里的桌面", () => {
    setPreferredDevice("tablet");
    setProductArchetype("free_app");
    const locked = lockScopeMorphology({
      device: "desktop",
      productArchetype: "business_app",
    });
    expect(locked.device).toBe("tablet");
    expect(locked.productArchetype).toBe("free_app");
  });

  it("反向：空存储不得用 desktop/business_app 压过 park 授予", () => {
    memStore.clear();
    const locked = lockScopeMorphology({
      device: "tablet",
      productArchetype: "content_app",
    });
    expect(locked.device).toBe("tablet");
    expect(locked.productArchetype).toBe("content_app");
    const confirmFn = SESSION.slice(
      SESSION.indexOf("const confirmControlScope"),
      SESSION.indexOf("const dismissScopeCard")
    );
    expect(confirmFn).toContain("snapshot.device");
    expect(confirmFn).toContain("snapshot.productArchetype");
    expect(CARD_SRC).toContain("onConfirm(choice)");
    expect(CARD_SRC).toContain("productArchetype");
    expect(CARD_SRC).toContain("device");
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
    /* ⚠ 2026-08-27：只钉「范围卡锁输入框」这半句。整句字面里另半句
       （提问）已经改成 askBlocksTyping —— 开放式提问要能打字回答，
       否则那张卡是死胡同。盯语义别盯字面（本仓第二条）。 */
    expect(DOCK).toContain(
      "disabled={Boolean(pendingScope) || askBlocksTyping(pendingAsk)}"
    );
    expect(DOCK).not.toContain(
      "disabled={isRunning || Boolean(pendingScope) || Boolean(pendingAsk)}"
    );
    /* 同上：提问那半边改由 askBlocksTyping 判定（开放式提问要能打字回答）。
       这条只保证发送闸**确实收到了提问状态**，不再钉具体表达式。 */
    expect(DOCK).toContain("askOpen: askBlocksTyping(pendingAsk)");
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
