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
