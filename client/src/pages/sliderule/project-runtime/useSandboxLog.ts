/**
 * 把沙箱命令行输出拉到前端，喂给滚动缓冲。
 *
 * ## 服务端早就有，缺的一直是这条管子（2026-09-14）
 *
 * `/api/sliderule/project-operations/{id}/events` 已经把 `runtime.log` 按白名单
 * 投影出来（`text` / `nextOffset` / `truncated`），游标 `afterSeq` → `nextSeq`
 * → `hasMore` 也齐。但全前端**一个消费者都没有**：
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
 */
import { useEffect, useRef, useState } from "react";
import {
  appendSandboxLog,
  emptySandboxLog,
  type SandboxLogState,
} from "./sandbox-log-buffer";

const BASE = "/api/sliderule";
/** 轮询间隔。跟 `useProjectPreview` 的 5s 同一量级，命令输出要更跟手一点。 */
const POLL_MS = 2000;
/** 一次追平最多连拉几页，防止服务端一直说 hasMore 时把这一轮卡死。 */
const MAX_PAGES_PER_TICK = 8;

type EventPage = {
  events?: Array<{ seq?: number; type?: string; payload?: Record<string, unknown> }>;
  nextSeq?: number;
  hasMore?: boolean;
};

async function fetchPage(
  operationId: string,
  afterSeq: number,
  signal: AbortSignal
): Promise<EventPage | null> {
  const response = await fetch(
    `${BASE}/project-operations/${encodeURIComponent(operationId)}/events?afterSeq=${afterSeq}&limit=200`,
    { credentials: "include", cache: "no-store", signal }
  );
  // ⚠ 读不到日志**不弹错**：它是增强项，炸了不许拖垮「它的电脑」本身
  //   （CLAUDE.md §7 增强类 fail-open）。少几行日志，好过整块面板消失。
  if (!response.ok) return null;
  return (await response.json()) as EventPage;
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
      for (let page = 0; page < MAX_PAGES_PER_TICK && !stopped; page += 1) {
        let body: EventPage | null = null;
        try {
          body = await fetchPage(id, ref.current.seq, controller.signal);
        } catch {
          return; // 取消或网络错；下一轮再说。
        }
        if (!body || stopped) return;
        let next = ref.current;
        for (const event of body.events || []) {
          if (event?.type !== "runtime.log") {
            // 非日志事件只推游标，别让它们把 afterSeq 卡住。
            if (typeof event?.seq === "number" && event.seq > next.seq) {
              next = { ...next, seq: event.seq };
            }
            continue;
          }
          const payload = event.payload || {};
          next = appendSandboxLog(next, String(payload.text ?? ""), {
            seq: typeof event.seq === "number" ? event.seq : undefined,
            truncated: Boolean(payload.truncated),
          });
        }
        if (typeof body.nextSeq === "number" && body.nextSeq > next.seq) {
          next = { ...next, seq: body.nextSeq };
        }
        if (next !== ref.current) {
          ref.current = next;
          setState(next);
        }
        // ⚠ 还有就接着拉，不等下一个周期（见文件头注）。
        if (!body.hasMore) return;
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
