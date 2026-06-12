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
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import {
  commitTrusted,
  createRawArtifact,
  markTrusted,
} from "@/lib/whybuddy-fullpath-fixtures";

export const GITHUB_PAGES_DEMO_SESSION_ID = "github-pages-whybuddy-demo";
export const GITHUB_PAGES_DEMO_GOAL =
  "做一个权限管理系统（支持 RBAC + 数据范围）";

const STORAGE_KEY_PREFIX = "whybuddy:github-pages-demo:v1:";

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
  evidenceRaw.provenance = "web:search";
  evidenceRaw.summary = "【来源: F2_Web_Search 取数】检索「RBAC 权限」· 2 条（演示）";

  const committed = commitArtifact(
    state,
    evidenceRaw,
    "pages-demo-run-evidence",
    false,
    ["demo-risk-1"]
  );
  state = committed.updatedState;
  markTrusted(state, "demo-evidence-1");

  state = {
    ...state,
    runtimePhase: "reasoning",
  };

  return deriveNodeStatus(state);
}

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