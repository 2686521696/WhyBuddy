/**
 * runtime-persistence — 运行时状态的会话级持久化（v0: localStorage）。
 *
 * 零数据库承诺：状态就是 JSON。键按 sessionId 隔离；模型换话题后由调用方
 * 决定是否重建（initRuntimeState）。损坏/缺失时返回 null，调用方重建，
 * 不抛错不伪造。
 */

import type { RuntimeState } from "./live-runtime";

const KEY_PREFIX = "sliderule:live-runtime:";

export function loadRuntimeState(sessionId: string): RuntimeState | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.seq === "number" &&
      parsed.entities &&
      Array.isArray(parsed.instances)
    ) {
      return parsed as RuntimeState;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveRuntimeState(sessionId: string, state: RuntimeState): void {
  try {
    localStorage.setItem(KEY_PREFIX + sessionId, JSON.stringify(state));
  } catch {
    /* 存储满/隐私模式 — 静默降级为内存态 */
  }
}

export function clearRuntimeState(sessionId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + sessionId);
  } catch {
    /* noop */
  }
}

// --- 当前角色（RBAC 角色预览 ⟷ 运行应用共享同一个"以谁的身份看"） ----------

const ROLE_KEY_PREFIX = "sliderule:live-runtime-role:";

export function loadRuntimeRole(sessionId: string): string | null {
  try {
    return localStorage.getItem(ROLE_KEY_PREFIX + sessionId);
  } catch {
    return null;
  }
}

export function saveRuntimeRole(sessionId: string, role: string): void {
  try {
    localStorage.setItem(ROLE_KEY_PREFIX + sessionId, role);
  } catch {
    /* 存储满/隐私模式 — 静默降级为内存态 */
  }
}

export function clearRuntimeRole(sessionId: string): void {
  try {
    localStorage.removeItem(ROLE_KEY_PREFIX + sessionId);
  } catch {
    /* noop */
  }
}

const ROLE_EVENT = "sliderule:runtime-role-changed";

export function notifyRoleChanged(sessionId: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent(ROLE_EVENT, { detail: { sessionId } })
    );
  } catch {
    /* SSR / 测试环境无 window */
  }
}

export function subscribeRoleChanged(
  sessionId: string,
  onChange: () => void
): () => void {
  const handler = (e: Event) => {
    if (
      (e as CustomEvent<{ sessionId: string }>).detail?.sessionId === sessionId
    )
      onChange();
  };
  try {
    window.addEventListener(ROLE_EVENT, handler);
    return () => window.removeEventListener(ROLE_EVENT, handler);
  } catch {
    return () => {};
  }
}

// --- 多面板同步（应用运行 ⟷ 工作流试运行共用一份状态） ---------------------

const CHANGE_EVENT = "sliderule:runtime-changed";

export function notifyRuntimeChanged(sessionId: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: { sessionId } })
    );
  } catch {
    /* SSR / 测试环境无 window */
  }
}

export function subscribeRuntimeChanged(
  sessionId: string,
  onChange: () => void
): () => void {
  const handler = (e: Event) => {
    if (
      (e as CustomEvent<{ sessionId: string }>).detail?.sessionId === sessionId
    )
      onChange();
  };
  try {
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  } catch {
    return () => {};
  }
}
