import { useCallback, useEffect, useRef } from "react";
import { keepProjectPreviewAlive } from "./project-preview-client";
import {
  PREVIEW_PRESENCE_MS,
  shouldKeepPreviewAlive,
} from "./project-preview-presence";

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * 预览页签开着、票还在、标签看得见 → 立刻报一声 keepalive，之后按 PREVIEW_PRESENCE_MS 再报。
 * 切走、藏起、卸掉立刻停。报失败 fail-open，不许拖垮预览面（§7 增强类）。
 *
 * 2026-10-10 起这一声同时续浏览器授权：服务端回新的到期时刻，交给 onAccessExtended
 * （useProjectPreview.extendAccess）把票的到期往后挪——同一张票、同一个地址，iframe 不重载。
 */
export function usePreviewPresence(input: {
  view: string;
  hasTicket: boolean;
  operationId?: string | null;
  onAccessExtended?: (operationId: string, accessExpiresAt: string) => void;
}) {
  const watching = shouldKeepPreviewAlive({
    ...input,
    visible: true,
  });
  const operationId = String(input.operationId || "").trim();
  const watchingRef = useRef(watching);
  watchingRef.current = watching;
  const extendedRef = useRef(input.onAccessExtended);
  extendedRef.current = input.onAccessExtended;

  const report = useCallback(
    (signal: AbortSignal) => {
      if (!operationId || !watchingRef.current || !pageVisible()) return;
      void keepProjectPreviewAlive(operationId, signal)
        .then(until => {
          if (until && !signal.aborted) extendedRef.current?.(operationId, until);
        })
        .catch(() => {
          /* 报时失败不许把预览面打成错误态 */
        });
    },
    [operationId]
  );

  useEffect(() => {
    if (!operationId || !watching) return;
    const controllers: AbortController[] = [];
    const beat = () => {
      const controller = new AbortController();
      controllers.push(controller);
      report(controller.signal);
    };
    const onVisibility = () => {
      if (pageVisible()) beat();
    };
    if (pageVisible()) beat();
    const timer = setInterval(() => {
      if (pageVisible()) beat();
    }, PREVIEW_PRESENCE_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const controller of controllers) controller.abort();
    };
  }, [operationId, watching, report]);

  const nudge = useCallback(() => {
    if (!operationId || !watchingRef.current || !pageVisible()) return;
    report(new AbortController().signal);
  }, [operationId, report]);

  return { nudge };
}
