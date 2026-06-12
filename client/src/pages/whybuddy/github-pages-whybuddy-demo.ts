/**
 * GitHub Pages static demo for /whybuddy — localStorage session + seeded graph state.
 * No backend, no LLM, no web search; pilot/deterministic executor only.
 */

import type { WhyBuddySessionStore } from "@/lib/whybuddy-runtime";
import {
  commitArtifact,
  createInitialSessionState,
  deriveNodeStatus,
  intakeMessage,
} from "@/lib/whybuddy-runtime";
import type { Artifact, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import {
  commitTrusted,
  createRawArtifact,
  markTrusted,
} from "@/lib/whybuddy-fullpath-fixtures";
import { buildStructuredReport } from "@shared/blueprint/whybuddy-report-builder";

export const GITHUB_PAGES_DEMO_SESSION_ID = "github-pages-whybuddy-demo";
export const GITHUB_PAGES_DEMO_GOAL =
  "做一个权限管理系统（支持 RBAC + 数据范围）";

const STORAGE_KEY_PREFIX = "whybuddy:github-pages-demo:v2:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Pre-seeded session so the reasoning canvas shows nodes on first visit. */
export function createGithubPagesWhyBuddySeedSession(): V5SessionState {
  const sessionId = GITHUB_PAGES_DEMO_SESSION_ID;
  let state = createInitialSessionState("", sessionId);

  const goalIntake = intakeMessage(state, {
    turnId: "pages-demo-seed-goal",
    userText: GITHUB_PAGES_DEMO_GOAL,
  });
  state = goalIntake.preparedState;

  const intake = intakeMessage(state, {
    turnId: "pages-demo-seed-intake",
    userText: "分析安全风险，并检索外部证据",
  });
  state = intake.preparedState;

  state = commitTrusted(
    state,
    "demo-risk-1",
    "risk.analyze",
    "安全",
    "risk",
    "pages-demo-run-risk"
  );

  const evidenceRaw = createRawArtifact(
    "demo-evidence-1",
    "evidence.search",
    "接地",
    "evidence",
    [
      "【全网检索 · 演示数据】",
      "1. RBAC 权限模型选型指南",
      "   URL: https://zhuanlan.zhihu.com/p/demo-rbac",
      "   摘要: 基于角色的访问控制（Role-based access control）是企业权限系统常见方案。",
      "2. 基于 RBAC 权限模型的架构设计",
      "   URL: https://www.cnblogs.com/demo/rbac-arch",
      "   摘要: 数据范围过滤 + 角色授权的组合实践。",
    ].join("\n")
  );
  evidenceRaw.provenance = "web:search" as Artifact["provenance"];
  evidenceRaw.summary = "【来源: F2_Web_Search 取数】检索「RBAC 权限」· 2 条（演示）";

  const committed = commitArtifact(
    state,
    evidenceRaw,
    "pages-demo-run-evidence",
    false,
    ["demo-risk-1"],
    "pilot-template" // pilot/demo seed -> use pilot-template baseline for K3
  );
  state = committed.updatedState;
  markTrusted(state, "demo-evidence-1");

  state = commitTrusted(
    state,
    "demo-synth-1",
    "synthesis.merge",
    "综合",
    "synthesis",
    "pages-demo-run-synth",
    ["demo-risk-1", "demo-evidence-1"]
  );

  state = commitTrusted(
    state,
    "demo-tree-1",
    "structure.decompose",
    "架构",
    "spec_tree",
    "pages-demo-run-tree",
    ["demo-risk-1", "demo-evidence-1"],
  );
  const treeArt = state.artifacts?.find((a) => a.id === "demo-tree-1");
  if (treeArt) {
    treeArt.content =
      "C_PROMPT:built · G_INV:attempt1:passed\n" +
      "【SPEC Tree · template】\n" +
      "- [root] RBAC 权限系统\n" +
      "  - [req-1] 角色与权限模型\n" +
      "  - [req-2] 数据范围过滤\n" +
      "  - [task-1] 审计日志";
  }

  const built = buildStructuredReport({
    state,
    inputArtifactIds: ["demo-risk-1", "demo-evidence-1", "demo-synth-1"],
    roleId: "综合",
    turnLabel: "演示",
  });
  const reportRaw = createRawArtifact(
    "demo-report-1",
    "report.write",
    "综合",
    "report",
    built.content
  );
  reportRaw.title = built.title;
  reportRaw.summary = built.summary;
  reportRaw.evidenceRefs = ["demo-evidence-1", "demo-risk-1"];

  const reportCommit = commitArtifact(
    state,
    reportRaw,
    "pages-demo-run-report",
    false,
    ["demo-synth-1", "demo-evidence-1", "demo-risk-1"],
    "pilot-template" // pilot/demo seed -> use pilot-template baseline for K3
  );
  state = reportCommit.updatedState;
  markTrusted(state, "demo-report-1");

  state = {
    ...state,
    goal: {
      text: GITHUB_PAGES_DEMO_GOAL,
      status: "clear",
    },
    runtimePhase: "done",
    deliveryPhase: "shipped",
  };

  return deriveNodeStatus(state);
}

/**
 * Note for GitHub Pages BYOK demo (B4):
 * - Open the top HUD (always visible in Pages mode).
 * - Look for "BYOK: not set" section → choose preset (e.g. openai/deepseek), paste your API key → Save.
 * - Key stays 100% in your browser localStorage (never sent to this site or anywhere but the vendor you chose).
 * - Next input will switch to browser-llm executor (production baseline, real LLM via K1/K2/K3).
 * - Clear to revert to pilot templates.
 * - CSP allows direct connect to the presets (see client/index.html).
 * - Multi-key pool supported in storage (advanced: edit localStorage or extend UI).
 */


export function createGithubPagesWhyBuddySessionStore(
  opts: { storage?: StorageLike | null } = {}
): WhyBuddySessionStore {
  const backing = opts.storage ?? storage();

  return {
    async load(sessionId: string): Promise<V5SessionState | undefined> {
      if (!backing) return undefined;
      const raw = backing.getItem(STORAGE_KEY_PREFIX + sessionId);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as V5SessionState;
      } catch {
        return undefined;
      }
    },

    async save(state: V5SessionState): Promise<V5SessionState> {
      const sessionId = state.sessionId || GITHUB_PAGES_DEMO_SESSION_ID;
      const now = new Date().toISOString();
      const saved = {
        ...state,
        sessionId,
        lastActive: now,
        createdAt: (state as V5SessionState & { createdAt?: string }).createdAt || now,
      } as V5SessionState;
      backing?.setItem(STORAGE_KEY_PREFIX + sessionId, JSON.stringify(saved));
      return saved;
    },

    async deleteSession(sessionId: string): Promise<void> {
      backing?.removeItem(STORAGE_KEY_PREFIX + sessionId);
    },
  };
}

/** First visit: seed graph; returning visitors: restore localStorage snapshot. */
export async function loadOrSeedGithubPagesDemoSession(
  store: WhyBuddySessionStore,
  sessionId = GITHUB_PAGES_DEMO_SESSION_ID
): Promise<V5SessionState> {
  const existing = await store.load(sessionId);
  if (existing?.goal?.text?.trim() && (existing.artifacts?.length ?? 0) > 0) {
    return deriveNodeStatus(existing);
  }
  const seed = createGithubPagesWhyBuddySeedSession();
  return store.save(seed);
}