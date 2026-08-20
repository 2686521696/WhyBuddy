/**
 * 侧栏会话封面——和应用中心同一条回落链：有图贴图，没图活渲染。
 *
 * ⚠ 2026-08-19 第一版只打 GET /sessions/{id}/preview。很多已闭环应用
 *   在应用中心是活渲染出来的（摘要 has_preview=false，或会话对不上 app），
 *   那条 URL 404，侧栏就只剩灰方块。用户指着「最近」说要像应用中心那样
 *   动态渲出来。
 *
 * 行样式仍是 Stitch 那种小方图 + 标题。图在方格里 object-fit: cover
 * 占满（活渲染用同一套 cover 缩放），不要整页 contain 留边，也不要
 * 改成 16:9 整宽卡——用户当场说搞错了，要的是方图里的 cover。
 *
 * ⚠ 不从 AppsWorkbench 引组件：那个模块带着瀑布流 / 画廊状态，侧栏常驻
 *   欢迎页，拉进来等于把应用中心压进每一屏。贴图走 app-store-client，
 *   活渲染 React.lazy 同一套 HtmlAppSurface / AppRuntimeScreen。
 */
import React from "react";
import { requestMountPermit } from "@/lib/mount-scheduler";
import { specPageViewport } from "@/pages/sliderule/live-runtime/canvas-scale";
import { deriveBindingSource } from "@/pages/sliderule/live-runtime/derive-binding-source";
import { initRuntimeState } from "@/pages/sliderule/live-runtime/live-runtime";
import { seedRuntimeState } from "@/pages/sliderule/live-runtime/demo-seed";
import type { FiveSystemModel } from "@/pages/sliderule/system-screens/five-system-model";
import {
  appPreviewUrl,
  getApp,
  type AppStoreSummary,
} from "./app-store-client";

export const SESSION_THUMB_APP_LIMIT = 36;

const LazyHtmlAppSurface = React.lazy(() =>
  import("@/pages/sliderule/live-runtime/html-app-surface").then(m => ({
    default: m.HtmlAppSurface,
  }))
);

const LazyAppRuntimeScreen = React.lazy(() =>
  import("@/pages/sliderule/live-runtime/AppRuntimeScreen").then(m => ({
    default: m.AppRuntimeScreen,
  }))
);

export function indexAppsBySession(
  apps: readonly AppStoreSummary[]
): Map<string, AppStoreSummary> {
  const map = new Map<string, AppStoreSummary>();
  for (const app of apps) {
    const sid = String(app.session_id || "").trim();
    if (sid && !map.has(sid)) map.set(sid, app);
  }
  return map;
}

/** 方格里的 cover 缩放：max(盒/画)，跟 object-fit: cover 同一几何。 */
export function coverScale(
  boxW: number,
  boxH: number,
  designW: number,
  designH: number
): number {
  if (boxW <= 0 || boxH <= 0 || designW <= 0 || designH <= 0) return 1;
  return Math.max(boxW / designW, boxH / designH);
}

/** 和应用中心 shouldUseSheetThumb 同一口径：有 appId 且后端说有图。 */
export function sessionUsesSheet(app?: AppStoreSummary | null): boolean {
  return Boolean(app?.id && app.has_preview);
}

export function sessionRowTitle(
  goal: string,
  app?: AppStoreSummary | null
): string {
  return String(app?.product_name || "").trim() || goal.trim() || "新会话";
}

/** 取落地页 HTML。空壳 {} 必须是 null，不能挂空白 iframe。 */
export function firstLandingPage(
  raw: unknown
): { html: string; device: "desktop" | "phone" } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pagesRaw = r.pages;
  if (!pagesRaw || typeof pagesRaw !== "object") return null;
  const pages = pagesRaw as Record<string, unknown>;
  const device = r.device === "phone" ? "phone" : "desktop";
  const nav = Array.isArray(r.navItems) ? r.navItems : [];
  for (const item of nav) {
    const id =
      item && typeof item === "object"
        ? String((item as { pageId?: string }).pageId || "")
        : "";
    const html = id && typeof pages[id] === "string" ? String(pages[id]).trim() : "";
    if (html) return { html, device };
  }
  for (const value of Object.values(pages)) {
    if (typeof value === "string" && value.trim()) {
      return { html: value.trim(), device };
    }
  }
  return null;
}

function hasModel(raw: unknown): raw is FiveSystemModel {
  return Boolean(raw && typeof raw === "object" && Object.keys(raw as object).length > 0);
}

type LivePayload =
  | { kind: "html"; html: string; device: "desktop" | "phone"; model: FiveSystemModel | null }
  | { kind: "model"; model: FiveSystemModel };

async function loadLivePayload(
  sessionId: string,
  app?: AppStoreSummary | null
): Promise<LivePayload | null> {
  if (app?.id) {
    const rec = await getApp(app.id);
    const page = firstLandingPage(rec?.pages_json);
    if (page) {
      return {
        kind: "html",
        html: page.html,
        device: page.device,
        model: hasModel(rec?.model_json) ? rec!.model_json as FiveSystemModel : null,
      };
    }
    if (hasModel(rec?.model_json)) return { kind: "model", model: rec!.model_json as FiveSystemModel };
  }
  try {
    const res = await fetch(`/api/sliderule/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: Record<string, unknown> };
    const state = body?.state;
    if (!state || typeof state !== "object") return null;
    const page = firstLandingPage(state.specFirstPages);
    if (page) {
      return { kind: "html", html: page.html, device: page.device, model: null };
    }
  } catch {
    /* fail-open：封面是增强，拉不到就回落字母 */
  }
  return null;
}

function useThumbVisible(): {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
} {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(false);
  const [granted, setGranted] = React.useState(false);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "80px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!inView) return;
    return requestMountPermit(() => setGranted(true));
  }, [inView]);

  return { wrapRef, visible: inView && granted };
}

function LetterThumb({ title }: { title: string }) {
  return (
    <span className="native-agent-session-thumb-letter">{title.slice(0, 1)}</span>
  );
}

function useCoverScale(designW: number, designH: number) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setScale(coverScale(el.clientWidth, el.clientHeight, designW, designH));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designW, designH]);
  return { ref, scale };
}

function LiveCanvas({
  payload,
  sessionId,
  title,
}: {
  payload: LivePayload;
  sessionId: string;
  title: string;
}) {
  const viewport =
    payload.kind === "html" ? specPageViewport(payload.device) : { w: 1280, h: 720 };
  const { ref: fitRef, scale } = useCoverScale(viewport.w, viewport.h);
  const source = React.useMemo(() => {
    if (payload.kind !== "html") return { rows: {}, fields: {} };
    return deriveBindingSource(
      payload.model,
      payload.model
        ? seedRuntimeState(initRuntimeState(payload.model), payload.model)
        : null
    );
  }, [payload]);

  return (
    <div
      ref={fitRef}
      className="relative h-full w-full overflow-hidden"
      data-testid="sidebar-session-thumb-live"
    >
      <React.Suspense fallback={<div className="h-full w-full bg-[#eceef1]" />}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            width: viewport.w,
            height: viewport.h,
            transform: `translateX(-50%) scale(${scale})`,
            transformOrigin: "top center",
            background: "#fff",
          }}
        >
          {payload.kind === "html" ? (
            <LazyHtmlAppSurface
              html={payload.html}
              source={source}
              fillPhone={payload.device === "phone"}
            />
          ) : (
            <LazyAppRuntimeScreen
              model={payload.model}
              sessionId={`sidebar-thumb:${sessionId}`}
              appTitle={title}
              scaleFit="contain"
              showScaleBadge={false}
            />
          )}
        </div>
      </React.Suspense>
    </div>
  );
}

function SessionLiveThumb({
  sessionId,
  title,
  app,
}: {
  sessionId: string;
  title: string;
  app?: AppStoreSummary | null;
}) {
  const { wrapRef, visible } = useThumbVisible();
  const [payload, setPayload] = React.useState<LivePayload | null | undefined>(
    undefined
  );

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void loadLivePayload(sessionId, app).then(next => {
      if (!cancelled) setPayload(next);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, sessionId, app?.id]);

  return (
    <div ref={wrapRef} className="h-full w-full">
      {payload === undefined ? (
        <div className="h-full w-full bg-[#eceef1]" />
      ) : payload ? (
        <LiveCanvas payload={payload} sessionId={sessionId} title={title} />
      ) : (
        <LetterThumb title={title} />
      )}
    </div>
  );
}

export function SessionThumb({
  sessionId,
  title,
  app,
}: {
  sessionId: string;
  title: string;
  app?: AppStoreSummary | null;
}) {
  const [sheetFailed, setSheetFailed] = React.useState(false);
  React.useEffect(() => setSheetFailed(false), [sessionId, app?.id, app?.preview_tag]);

  const sheet = sessionUsesSheet(app) && !sheetFailed;
  return (
    <span className="native-agent-session-thumb" aria-hidden>
      {sheet ? (
        <img
          src={appPreviewUrl(app!.id, app!.preview_tag)}
          alt=""
          data-testid="sidebar-session-thumb-sheet"
          onError={() => setSheetFailed(true)}
        />
      ) : (
        <SessionLiveThumb sessionId={sessionId} title={title} app={app} />
      )}
    </span>
  );
}
