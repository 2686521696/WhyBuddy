/**
 * GitHub Pages static demo for /sliderule — localStorage session + seeded state.
 * No backend, no server LLM; sending a message plays back a real captured run
 * (see github-pages-demo-playback.ts / github-pages-demo-template.ts).
 */

import type { SlideRuleSessionStore } from "@/lib/sliderule-runtime";
import {
  createInitialSessionState,
  deriveNodeStatus,
} from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

export const GITHUB_PAGES_DEMO_SESSION_ID = "github-pages-sliderule-demo";
// E18（2026-07-16）：演示话题随模板重录同步换新——新引擎（E17 证据管道
// + P2a 真搜索）捕获的宠物医院题，实体/角色/流程都比权限系统展示得开
export const GITHUB_PAGES_DEMO_GOAL =
  "社区宠物医院预约问诊系统——预约、分诊、复诊提醒一体化";

// v4：演示改为「空会话 + 输入框预填项目意图」——访客点发送后现场看推演执行
// （模板回放，数据来自真实 LLM 推演捕获），而不是落地在一个已完成的旧快照上。
// 升版本号让 v3 及更早的缓存失效。
const STORAGE_KEY_PREFIX = "sliderule:github-pages-demo:v4:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 首访种子：空会话。演示入口的输入框会预填 GITHUB_PAGES_DEMO_GOAL，
 * 访客点「发送」即可看全程推演回放（推理步骤 → 六系统生成 → 发布闭环）。
 */
export function createGithubPagesSlideRuleSeedSession(): V5SessionState {
  return deriveNodeStatus(
    createInitialSessionState("", GITHUB_PAGES_DEMO_SESSION_ID)
  );
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

export function createGithubPagesSlideRuleSessionStore(
  opts: { storage?: StorageLike | null } = {}
): SlideRuleSessionStore {
  const backing = opts.storage ?? storage();

  return {
    async load(sessionId: string): Promise<V5SessionState | undefined> {
      if (!backing) return undefined;
      const raw = backing.getItem(STORAGE_KEY_PREFIX + sessionId);
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw);
        // publishClosure (if present in saved) or absent (legacy) both tolerated; adapter in useSlideRuleSession also preserves.
        return parsed as V5SessionState;
      } catch {
        return undefined;
      }
    },

    async save(state: V5SessionState): Promise<V5SessionState> {
      const sessionId = state.sessionId || GITHUB_PAGES_DEMO_SESSION_ID;
      const now = new Date().toISOString();
      // Explicit carry of publishClosure (if present) for session store persistence + legacy compat.
      const pc = (state as any).publishClosure;
      const saved: any = {
        ...state,
        sessionId,
        lastActive: now,
        createdAt: (state as V5SessionState & { createdAt?: string }).createdAt || now,
      };
      if (pc !== undefined) saved.publishClosure = pc;
      backing?.setItem(STORAGE_KEY_PREFIX + sessionId, JSON.stringify(saved));
      return saved as V5SessionState;
    },

    async deleteSession(sessionId: string): Promise<void> {
      backing?.removeItem(STORAGE_KEY_PREFIX + sessionId);
    },
  };
}

/**
 * First visit (or after reset): blank seed; returning visitors with a played
 * demo run: restore their localStorage snapshot (goal + artifacts present).
 */
export async function loadOrSeedGithubPagesDemoSession(
  store: SlideRuleSessionStore,
  sessionId = GITHUB_PAGES_DEMO_SESSION_ID
): Promise<V5SessionState> {
  const existing = await store.load(sessionId);
  if (existing?.goal?.text?.trim() && (existing.artifacts?.length ?? 0) > 0) {
    return deriveNodeStatus(existing);
  }
  const seed = createGithubPagesSlideRuleSeedSession();
  return store.save(seed);
}
