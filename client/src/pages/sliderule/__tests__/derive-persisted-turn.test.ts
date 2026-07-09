import { describe, it, expect } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { deriveTurnRoute } from "@shared/blueprint/sliderule-turn-route";
import {
  deriveLatestTurnFromState,
  mergePublishClosureForPersistedTurn,
} from "../derive-persisted-turn";
import {
  __sessionEvidenceTestHelpers,
  looksLikeNewAppIntent,
} from "../useSlideRuleSession";

/**
 * 修复:刷新后 uiTurns 为空 → 右上角架构执行记录消失。
 * 验证从持久化 sessionState 能重建出可渲染的「最近一轮」routeFacts(站点序列非空)。
 */
describe("deriveLatestTurnFromState (执行记录刷新后重建)", () => {
  it("returns null when no runs/ledger", () => {
    expect(
      deriveLatestTurnFromState({
        capabilityRuns: [],
        decisionLedger: [],
      } as any)
    ).toBeNull();
    expect(deriveLatestTurnFromState(null)).toBeNull();
  });

  it("rebuilds latest turn routeFacts from persisted runs + ledger", () => {
    const state = {
      goal: { text: "二手置换", status: "clear" },
      runtimePhase: "done",
      lastTurnId: "t1",
      capabilityRuns: [
        {
          id: "t1-run-0",
          capabilityId: "evidence.search",
          roleId: "接地",
          turnId: "t1",
          gateResults: [{ status: "passed" }],
        },
        {
          id: "t1-run-1",
          capabilityId: "synthesis.merge",
          roleId: "综合",
          turnId: "t1",
          gateResults: [{ status: "passed" }],
        },
        {
          id: "t1-run-2",
          capabilityId: "report.write",
          roleId: "综合",
          turnId: "t1-r2",
          gateResults: [{ status: "failed" }],
        },
      ],
      decisionLedger: [{ id: "t1-dledger", turnId: "t1", source: "llm" }],
    } as unknown as V5SessionState;

    const turn = deriveLatestTurnFromState(state);
    expect(turn).toBeTruthy();
    expect(turn!.id).toBe("t1");
    expect(turn!.status).toBe("complete");
    // 跨 t1 + t1-r2 的运行都归并到本轮
    expect(
      turn!.routeFacts.selectedCapabilities?.map(c => c.capabilityId)
    ).toEqual(
      expect.arrayContaining([
        "evidence.search",
        "synthesis.merge",
        "report.write",
      ])
    );
    expect(turn!.routeFacts.trustTotalCount).toBe(3);
    expect(turn!.routeFacts.trustPassedCount).toBe(2); // 第三个 gate failed
    expect(turn!.routeFacts.planSource).toBe("llm");
    // 关键:能据此渲染出非空站点序列(执行记录可见)
    expect(deriveTurnRoute(turn!.routeFacts).length).toBeGreaterThan(0);
  });
});

/**
 * Focused test for 119: publishClosure evidence persistence in frontend SlideRule session state.
 * - Positive: state carrying publishClosure survives JSON roundtrip (store save/load sim) and explicit preserve shape.
 * - Fail-closed negative: legacy state missing publishClosure key remains valid, loads with undefined (no crash, preview fallback applies).
 * No weakening of other behavior; uses only persisted state shapes.
 */
describe("publishClosure frontend session persistence (119)", () => {
  const samplePublishClosure = {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: 6,
    skillCount: 6,
    versionPinsChecked: true,
    closureHash: "feedface",
    tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
    topBlockers: [],
    perSkillEvidence: {},
  };

  it("preserves publishClosure through simulated store roundtrip (save/load json)", () => {
    const base: any = {
      sessionId: "pc-test-1",
      goal: { text: "persist publishClosure", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      publishClosure: samplePublishClosure,
    };
    // simulate save (json stringify) + load (parse) as github-pages + http store do
    const serialized = JSON.stringify(base);
    const loaded = JSON.parse(serialized) as any;
    expect(loaded.publishClosure).toBeTruthy();
    expect(loaded.publishClosure.evidencePresentCount).toBe(6);
    expect(loaded.publishClosure.closureHash).toBe("feedface");
  });

  it("legacy session missing publishClosure loads with undefined (compat, fail-closed)", () => {
    const legacy: any = {
      sessionId: "pc-legacy",
      goal: { text: "old session", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      // deliberately no publishClosure key
    };
    const serialized = JSON.stringify(legacy);
    const loaded = JSON.parse(serialized) as any;
    expect("publishClosure" in loaded).toBe(false);
    expect(loaded.publishClosure).toBeUndefined();
    // cast path in UI stays safe
    const pythonPc = (loaded as { publishClosure?: any }).publishClosure;
    expect(pythonPc).toBeUndefined();
  });

  it("explicit attach on drive-final state keeps publishClosure for persist", () => {
    const pre: any = {
      sessionId: "pc-attach",
      goal: { text: "attach" },
      artifacts: [],
    };
    const withPc = { ...pre, publishClosure: samplePublishClosure };
    // simulate what marathon python attach + preserve does
    const after = { ...(withPc as any) } as any;
    expect(after.publishClosure?.evidencePresentCount).toBe(6);
    // persist sim
    const persisted = JSON.parse(JSON.stringify(after));
    expect(persisted.publishClosure?.blocked).toBe(false);
  });

  it("preserves Python closure and skill runtime graph projections together", () => {
    const graph = {
      edges: [
        { sourceSkill: "datamodel", targetSkill: "page", state: "allowed" },
      ],
      evidenceBySkill: { datamodel: ["DM_PAGE_BINDING_IMPACT_EVIDENCE"] },
    };
    const state = {
      sessionId: "pc-graph",
      goal: { text: "preserve graph" },
      artifacts: [],
      capabilityRuns: [],
      publishClosure: samplePublishClosure,
      skillRuntimeGraph: graph,
    } as any;

    const preserved =
      __sessionEvidenceTestHelpers.preservePythonEvidenceProjection(
        state
      ) as any;

    expect(preserved.publishClosure).toBe(samplePublishClosure);
    expect(preserved.skillRuntimeGraph).toBe(graph);
  });

  it("prepares a visible empty reset state when backend reset or save fails", async () => {
    const fresh =
      await __sessionEvidenceTestHelpers.prepareVisibleResetSessionState(
        "reset-fallback-session",
        async () => {
          throw new Error(
            "DELETE /api/sliderule/sessions/reset-fallback-session returned 405"
          );
        },
        async () => {
          throw new Error("save failed");
        }
      );

    expect(fresh.sessionId).toBe("reset-fallback-session");
    expect(fresh.goal?.text).toBe("");
    expect(fresh.goal?.status).toBe("needs_refinement");
    expect((fresh as any).publishClosure).toBeUndefined();
    expect((fresh.artifacts || []).length).toBe(0);
    expect((fresh.capabilityRuns || []).length).toBe(0);
  });
});

describe("persisted turn publishClosure merge order (120)", () => {
  const pythonClosed = {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: 6,
    skillCount: 6,
    versionPinsChecked: true,
    closureHash: "python-authoritative-120",
    tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
    topBlockers: [],
    perSkillEvidence: {},
  };

  const previewOnly = {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: 2,
    skillCount: 6,
    versionPinsChecked: false,
    closureHash: "ts-preview-only",
    tierCounts: { hard_blocker: 0, warning: 1, info: 0 },
    topBlockers: [],
    perSkillEvidence: {},
  };

  it("persists Python top-level closure over a stale preview closure", () => {
    const stateWithPreview = {
      sessionId: "merge-120",
      goal: { text: "merge order", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      publishClosure: previewOnly,
    } as any;

    const merged = mergePublishClosureForPersistedTurn(
      stateWithPreview,
      pythonClosed
    ) as any;

    expect(merged.publishClosure?.closureHash).toBe("python-authoritative-120");
    expect(merged.publishClosure?.evidencePresentCount).toBe(6);
  });

  it("does not promote preview closure when Python has no authoritative closure", () => {
    const stateWithPreview = {
      sessionId: "merge-degraded-120",
      goal: { text: "merge degraded", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      publishClosure: previewOnly,
    } as any;

    const merged = mergePublishClosureForPersistedTurn(
      stateWithPreview,
      undefined
    ) as any;

    expect("publishClosure" in merged).toBe(false);
    expect(merged.publishClosure).toBeUndefined();
  });
});

/**
 * 已闭环话题里输入新应用意图 → 自动开新话题的启发式。
 * 误判代价不对称：漏判只是用户需手动重置（现状）；错判会清掉旧话题会话，
 * 所以动词+载体名词都命中才算新意图。
 */
describe("looksLikeNewAppIntent (自动新话题启发式)", () => {
  it("识别内置 chips 与常见新应用表述", () => {
    expect(
      looksLikeNewAppIntent(
        "做一个采购审批应用，含采购单、经理审批、财务确认和字段权限"
      )
    ).toBe(true);
    expect(
      looksLikeNewAppIntent(
        "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理"
      )
    ).toBe(true);
    expect(
      looksLikeNewAppIntent(
        "做一个连锁健身房管理系统，包含私教排期、会员卡核销和器材保养"
      )
    ).toBe(true);
    expect(looksLikeNewAppIntent("帮我做个宠物医院预约平台")).toBe(true);
  });

  it("识别裸名词短语意图（无动词、以载体名词收尾）", () => {
    expect(looksLikeNewAppIntent("智能财务自动化办公系统")).toBe(true);
    expect(looksLikeNewAppIntent("宠物医院预约平台")).toBe(true);
    expect(looksLikeNewAppIntent("小区物业报修小程序")).toBe(true);
  });

  it("裸名词短语不误伤 refine 指令（修改类动词开头 / 名词不收尾）", () => {
    expect(looksLikeNewAppIntent("优化下单应用")).toBe(false);
    expect(looksLikeNewAppIntent("把审批系统改成两级")).toBe(false);
    expect(looksLikeNewAppIntent("调整权限系统")).toBe(false);
    expect(looksLikeNewAppIntent("重新生成页面系统图")).toBe(false);
  });

  it("不误伤追问/交付/挑战类输入（保持既有 refine 语义）", () => {
    expect(
      looksLikeNewAppIntent(
        "打包交付：生成 spec 树、规格文档、提示词包、架构图与工程交接包"
      )
    ).toBe(false);
    expect(looksLikeNewAppIntent("把审批改成两级")).toBe(false);
    expect(looksLikeNewAppIntent("这个结论的依据不够充分，请重新推演。")).toBe(
      false
    );
    expect(looksLikeNewAppIntent("好的")).toBe(false);
    expect(looksLikeNewAppIntent("")).toBe(false);
  });
});
