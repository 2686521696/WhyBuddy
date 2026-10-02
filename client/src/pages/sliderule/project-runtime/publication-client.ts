import { useCallback, useEffect, useState } from "react";
import { requestProjectWorkspace } from "./project-workspace-client";

/**
 * 网页工程发布到应用市场（后端 routes/project_sources.publish_project）。
 *
 * ⚠ 2026-10-01 用户审查应用市场：结果卡上的「发布」一直 disabled「发布通道尚未接通」，市场里只有老 HTML
 *   推演的 24 个。发布的是通过交付验收的**这一版**：一张验收截图 + 这一版源码（别人能复刻），不含应用数据。
 *   没通过验收的，服务端 409（fail-closed）——前端的「能不能点」只是提示，判定在服务端。
 */
export interface PublicationView {
  published: boolean;
  appId: string | null;
  revision: string | null;
  /** 作者发布之后又改了：市场里还是旧那一版。 */
  stale: boolean;
}

function parse(body: unknown): PublicationView | null {
  const b = body as Partial<PublicationView> | null;
  if (!b || typeof b.published !== "boolean") return null;
  return {
    published: b.published,
    appId: typeof b.appId === "string" ? b.appId : null,
    revision: typeof b.revision === "string" ? b.revision : null,
    stale: Boolean(b.stale),
  };
}

export async function publishProject(projectId: string, signal: AbortSignal): Promise<PublicationView | null> {
  const response = await requestProjectWorkspace(`/projects/${encodeURIComponent(projectId)}/publish`, signal, {});
  return parse(await response.json());
}

/** 这个工程发布了没有；拉不到就是 null（不知道），不当成「没发布」也不当成「发布了」。 */
export function useProjectPublication(projectId: string | null | undefined, refreshKey?: unknown) {
  const [view, setView] = useState<PublicationView | null>(null);
  useEffect(() => {
    const id = String(projectId || "").trim();
    setView(null);
    if (!id) return;
    const ac = new AbortController();
    void requestProjectWorkspace(`/projects/${encodeURIComponent(id)}/publication`, ac.signal)
      .then(response => response.json())
      .then(body => { if (!ac.signal.aborted) setView(parse(body)); })
      .catch(() => { if (!ac.signal.aborted) setView(null); });
    return () => ac.abort();
  }, [projectId, refreshKey]);
  const update = useCallback((next: PublicationView | null) => setView(next), []);
  return [view, update] as const;
}

/**
 * 按钮写什么、能不能点。纯函数，判据直接喂它。
 *   delivered 不是 true（没过验收 / 还不知道）→ 不能点，说清楚为什么
 *   已发布、而且就是当前这一版 → 「已发布」
 *   已发布、作者之后又改了 → 「发布新版」
 */
export function publishButtonState(delivered: boolean | null | undefined, view: PublicationView | null) {
  if (view?.published && !view.stale) {
    return { label: "已发布", enabled: false, title: "已在应用市场；之后再改，可以发布新的一版" };
  }
  if (delivered !== true) {
    return { label: "发布", enabled: false, title: "通过交付验收之后才能发布到应用市场" };
  }
  if (view?.published && view.stale) {
    return { label: "发布新版", enabled: true, title: "市场里还是上一次发布的那一版，点一下换成现在这一版" };
  }
  return { label: "发布", enabled: true, title: "发布到应用市场：别人能看到这一版的截图，并能复刻这一版源码（不含你录入的数据）" };
}
