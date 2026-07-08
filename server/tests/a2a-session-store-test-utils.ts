/**
 * A2A 会话存档的测试工具。
 *
 * 会话状态已迁移为 Python 拥有的文件存档（slide-rule-python/tmp/a2a_sessions.json，
 * services/a2a_runtime.py 是唯一语义所有者；Node A2AClient 只是跨进程 thin proxy）。
 * 测试通过直接读写该存档文件做隔离与种子——这是对「跨进程文件契约」的显式测试缝，
 * 替代 A2AClient 里早已删除的内存 Map（旧测试写 (client as any).sessions 的方式
 * 在迁移后既种不进数据、也隔离不了跨测试的存档残留）。
 */
import fs from "node:fs";
import path from "node:path";

import type { A2ASession } from "../../shared/a2a-protocol";

export const A2A_SESSIONS_STORE_FILE = "slide-rule-python/tmp/a2a_sessions.json";

/** 清空会话存档：每个用例从零开始，杜绝跨测试/跨进程残留。 */
export function resetA2ASessionStore(): void {
  fs.rmSync(A2A_SESSIONS_STORE_FILE, { force: true });
}

/** 以给定会话整体重写存档（sessionId → session 映射，与 a2a_runtime 的存档形状一致）。 */
export function seedA2ASessionStore(sessions: A2ASession[]): void {
  fs.mkdirSync(path.dirname(A2A_SESSIONS_STORE_FILE), { recursive: true });
  const store: Record<string, A2ASession> = {};
  for (const session of sessions) store[session.sessionId] = session;
  fs.writeFileSync(A2A_SESSIONS_STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}
