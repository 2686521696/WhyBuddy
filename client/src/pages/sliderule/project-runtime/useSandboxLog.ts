/**
 * 把沙箱命令行输出拉到前端，喂给滚动缓冲。
 *
 * ## 服务端早就有，缺的一直是这条管子（2026-09-14）
 *
 * `/api/sliderule/project-operations/{id}/events` 把 `runtime.log` 和
 * `runtime.console` 按白名单投影出来。`console` 是 PTY 原字节；`log` 是旧的
 * 进程文件尾巴。同一根管子，两种载荷。
 *
 *     grep -rn "/logs\|operations/.*events" client/src  →  空
 *
 * `project_logs` 在前端只活成两个中文标签（「读取运行日志」「正在读取工程日志」）。
 * 于是「它的电脑」只能显示「当前在调哪个工具」，显示不了它到底打印了什么——
 * 对照 Manus 那块面板，差的就是这个。
 *
 * ## 这里只管取，不管攒
 *
 * 「攒」的规则全在 `sandbox-log-buffer.ts`（纯函数，判据直接跑）：空块不覆盖、
 * truncated 黏性、截头保尾、行数缓存。这里只负责按游标把增量拉回来。
 *
 * ⚠ `hasMore` 为真时**立刻接着拉**，不等下一个轮询周期——不然一次跑出几千行
 *   的构建日志要几分钟才追平，用户看到的「实时」是几分钟前的。
 *
 * ⚠ 2026-09-15：嵌进会话曾经订**每一条** exec。2026-09-18 改回只订
 *   `followSandboxOperationId` 那一条——全订会在切到终端时闪旧命令、
 *   连打 `/events`。`useSandboxLogs` 还留着，面板默认不再走它。
 */
import { useEffect, useRef, useState } from "react";
import {
  applyRuntimeLogPage,
  emptySandboxLog,
  type SandboxLogEventPage,
  type SandboxLogState,
} from "./sandbox-log-buffer";

const BASE = "/api/sliderule";
/** 轮询间隔。跟 `useProjectPreview` 的 5s 同一量级，命令输出要更跟手一点。 */
const POLL_MS = 2000;
/** 一次追平最多连拉几页，防止服务端一直说 hasMore 时把这一轮卡死。 */
const MAX_PAGES_PER_TICK = 8;

async function fetchPage(
  operationId: string,
  afterSeq: number,
  signal: AbortSignal
): Promise<SandboxLogEventPage | null> {
  const response = await fetch(
    `${BASE}/project-operations/${encodeURIComponent(operationId)}/events?afterSeq=${afterSeq}&limit=200`,
    { credentials: "include", cache: "no-store", signal }
  );
  // ⚠ 读不到日志**不弹错**：它是增强项，炸了不许拖垮「它的电脑」本身
  //   （CLAUDE.md §7 增强类 fail-open）。少几行日志，好过整块面板消失。
  if (!response.ok) return null;
  return (await response.json()) as SandboxLogEventPage;
}

async function catchUp(
  operationId: string,
  start: SandboxLogState,
  signal: AbortSignal
): Promise<{ state: SandboxLogState; caughtUp: boolean }> {
  let next = start;
  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const body = await fetchPage(operationId, next.seq, signal);
    if (!body) return { state: next, caughtUp: false };
    next = applyRuntimeLogPage(next, body);
    if (!body.hasMore) return { state: next, caughtUp: true };
  }
  return { state: next, caughtUp: false };
}

/**
 * 订阅一个 operation 的命令行输出。
 *
 * `operationId` 为空时返回空缓冲并且**不发请求**——没有在跑的操作就没有日志，
 * 不许空转轮询。
 */
export function useSandboxLog(operationId: string | null | undefined): SandboxLogState {
  const [state, setState] = useState<SandboxLogState>(emptySandboxLog);
  const ref = useRef<SandboxLogState>(state);
  ref.current = state;

  useEffect(() => {
    const id = String(operationId || "").trim();
    // 换了 operation 就从头开始：上一条命令的输出不许漏到下一条上。
    setState(emptySandboxLog());
    if (!id) return;

    const controller = new AbortController();
    let stopped = false;

    const tick = async () => {
      try {
        const { state } = await catchUp(id, ref.current, controller.signal);
        if (stopped) return;
        if (state !== ref.current) {
          ref.current = state;
          setState(state);
        }
      } catch {
        return;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [operationId]);

  return state;
}

/** 正在跑的 200ms 一拉。PTY 打字是几十毫秒一个字，800ms 会变成一截一截往外蹦。 */
const HOT_POLL_MS = 200;

/**
 * 订一段会话里多条命令的沙箱 stdout。
 *
 * 已经 `hasMore=false` 且不在 `hotIds` 里的 operation 停订——
 * 那些日志不会再长，空转只会把「实时」冲淡。
 */
export function useSandboxLogs(
  operationIds: readonly string[],
  opts: { hotIds?: readonly string[] } = {}
): Record<string, SandboxLogState> {
  const [state, setState] = useState<Record<string, SandboxLogState>>({});
  const ref = useRef(state);
  ref.current = state;
  const idsKey = operationIds.map(id => String(id || "").trim()).filter(Boolean).join("\0");
  const hotKey = (opts.hotIds || []).map(id => String(id || "").trim()).filter(Boolean).join("\0");

  useEffect(() => {
    const ids = idsKey ? idsKey.split("\0") : [];
    const hot = new Set(hotKey ? hotKey.split("\0") : []);
    setState(prev => {
      const next: Record<string, SandboxLogState> = {};
      for (const id of ids) next[id] = prev[id] || emptySandboxLog();
      ref.current = next;
      return next;
    });
    if (ids.length === 0) return;

    const controller = new AbortController();
    let stopped = false;
    const caughtUp = new Set<string>();

    const tick = async () => {
      let changed = false;
      const next = { ...ref.current };
      for (const id of ids) {
        if (stopped) return;
        if (caughtUp.has(id) && !hot.has(id)) continue;
        try {
          const result = await catchUp(id, next[id] || emptySandboxLog(), controller.signal);
          if (stopped) return;
          if (result.state !== next[id]) {
            next[id] = result.state;
            changed = true;
          }
          if (result.caughtUp && !hot.has(id)) caughtUp.add(id);
          else caughtUp.delete(id);
        } catch {
          return;
        }
      }
      if (changed) {
        ref.current = next;
        setState(next);
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), HOT_POLL_MS);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [idsKey, hotKey]);

  return state;
}
