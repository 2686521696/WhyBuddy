import { useEffect, useState } from "react";
import { requestProjectWorkspace } from "./project-workspace-client";

/**
 * 宿主对网页工程的交付判定：服务端 `/projects/{id}/delivery` 的 `eligible`。
 *
 * ⚠ 2026-09-25 记账网页真机 sr-20260925025649-74E9KCWHAB：结果卡只看前端自己
 *   的推断（写过源码 + 有版本号），宿主证据说没交付，卡上照样「✓ 任务已完成」。
 *   服务端那边已经停成等用户（unfinished_project_waits_for_user），前端不跟着改
 *   就是 CLAUDE.md §4 的「只改一半」。这里只取判定本身；缺什么由服务端那句人话
 *   收尾说，前端不另抄一张缺项表。
 *
 * 拉不到 / 形状不对 → null（不知道）。不知道不等于交付了：调用方把 null 当
 * 「还没拿到证据」，不许当成 true。
 *
 * ⚠ 2026-09-25 隔离真机 sr-20260925070944-QGT6D76EYV：验收被预览访问票挡住，
 *   收尾通知说「没能在这个环境里跑起来」，结果卡却写「还没通过交付验收」。
 *   把服务端的缺项码一起带回来，卡片用它分辨是哪一种——码表不另抄，只认
 *   服务端给的那一个环境码（见 turn-result-card.ts 的 onlyEnvironmentBlocked）。
 */
export interface DeliveryVerdict {
  eligible: boolean;
  blockedReasons: string[];
}

export function useProjectDeliveryVerdict(
  projectId: string | null | undefined,
  refreshKey?: unknown
): DeliveryVerdict | null {
  const [eligible, setEligible] = useState<DeliveryVerdict | null>(null);
  useEffect(() => {
    const id = String(projectId || "").trim();
    setEligible(null);
    if (!id) return;
    const ac = new AbortController();
    void requestProjectWorkspace(
      `/projects/${encodeURIComponent(id)}/delivery`,
      ac.signal
    )
      .then(response => response.json())
      .then(body => {
        if (ac.signal.aborted) return;
        setEligible(
          body && body.projectId === id && typeof body.eligible === "boolean"
            ? {
                eligible: body.eligible,
                blockedReasons: Array.isArray(body.blockedReasons)
                  ? body.blockedReasons.filter(
                      (item: unknown): item is string => typeof item === "string"
                    )
                  : [],
              }
            : null
        );
      })
      .catch(() => {
        if (!ac.signal.aborted) setEligible(null);
      });
    return () => ac.abort();
  }, [projectId, refreshKey]);
  return eligible;
}
