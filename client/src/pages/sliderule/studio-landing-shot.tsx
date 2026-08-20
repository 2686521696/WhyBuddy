/**
 * 推演收口把落地页截成图，存进应用中心卡片。
 *
 * 首页曾经给每张 spec-first 卡挂一个 Tailwind iframe 活渲染——同屏几十张
 * 把主线程打满。正确的时机是推演刚结束：舞台上的页面已经渲染过一遍，
 * SnapDOM 拍同源 iframe（内部采 documentElement，见 lib/thumb-capture.ts），
 * POST 成 shot。下次进应用市场贴的是 <img>。
 *
 * 采的是**落地页**（导航第一项），不是用户此刻在舞台上翻到的那一页。所以
 * 另挂一个屏幕外的 HtmlAppSurface，不打扰正在看的人。
 *
 * fail-open：找不到 app_id、iframe 没编完、回传 4xx，都不挡推演收口。
 */

import React from "react";

import { captureAndUpload } from "@/lib/thumb-capture";
import { getGeneratedAppForSession } from "@/pages/agent-loop/dashboard/app-store-client";
import { specPageViewport } from "./live-runtime/canvas-scale";
import { deriveBindingSource } from "./live-runtime/derive-binding-source";
import { HtmlAppSurface } from "./live-runtime/html-app-surface";
import { seedRuntimeState } from "./live-runtime/demo-seed";
import { initRuntimeState, type RuntimeState } from "./live-runtime/live-runtime";
import type { FiveSystemModel } from "./system-screens/five-system-model";
import type { SpecPageLive } from "./live-runtime/SpecPageLiveStage";

/** 推演从 true 掉到 false 才采。打开一份已经跑完的会话不要再截一次。 */
export function rehearsalJustFinished(wasRunning: boolean, running: boolean): boolean {
  return wasRunning && !running;
}

export function landingPageFromSpec(
  specFirstPages:
    | {
        pages?: Record<string, string>;
        navItems?: unknown[];
        device?: "desktop" | "phone";
      }
    | null
    | undefined,
  specPages?: readonly Pick<SpecPageLive, "html" | "pageId" | "device">[] | null
): { html: string; device?: "desktop" | "phone" } | null {
  const pages = specFirstPages?.pages;
  const nav = Array.isArray(specFirstPages?.navItems) ? specFirstPages!.navItems : [];
  if (pages && typeof pages === "object") {
    for (const item of nav) {
      const id =
        item && typeof item === "object"
          ? String((item as { pageId?: string }).pageId || "")
          : "";
      const html = id && typeof pages[id] === "string" ? pages[id].trim() : "";
      if (html) {
        return { html, device: specFirstPages?.device };
      }
    }
    for (const html of Object.values(pages)) {
      if (typeof html === "string" && html.trim()) {
        return { html: html.trim(), device: specFirstPages?.device };
      }
    }
  }
  const first = specPages?.find(p => (p.html || "").trim());
  if (first) {
    return { html: first.html.trim(), device: first.device };
  }
  return null;
}

const SETTLE_MS = 2000;

export function StudioLandingShot({
  sessionId,
  running,
  specFirstPages,
  specPages,
  model,
  runtime,
}: {
  sessionId?: string;
  running: boolean;
  specFirstPages?: {
    pages?: Record<string, string>;
    navItems?: unknown[];
    device?: "desktop" | "phone";
  } | null;
  specPages?: SpecPageLive[];
  model?: FiveSystemModel | null;
  runtime?: RuntimeState | null;
}): React.ReactElement | null {
  const wasRunning = React.useRef(false);
  const pending = React.useRef(false);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [job, setJob] = React.useState<{
    appId: string;
    html: string;
    device?: "desktop" | "phone";
  } | null>(null);

  React.useEffect(() => {
    if (rehearsalJustFinished(wasRunning.current, running)) {
      pending.current = true;
    }
    wasRunning.current = running;
  }, [running]);

  React.useEffect(() => {
    if (!pending.current || running || !sessionId) return;
    const landing = landingPageFromSpec(specFirstPages, specPages);
    if (!landing) return;
    pending.current = false;
    let cancelled = false;
    void (async () => {
      let row = await getGeneratedAppForSession(sessionId);
      if (!row?.id) {
        await new Promise(r => setTimeout(r, 800));
        row = await getGeneratedAppForSession(sessionId);
      }
      if (cancelled || !row?.id) return;
      setJob({ appId: row.id, html: landing.html, device: landing.device });
    })();
    return () => {
      cancelled = true;
    };
  }, [running, sessionId, specFirstPages, specPages]);

  const source = React.useMemo(
    () =>
      deriveBindingSource(
        model ?? null,
        model ? runtime ?? seedRuntimeState(initRuntimeState(model), model) : null
      ),
    [model, runtime]
  );

  React.useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled || !hostRef.current) return;
      void captureAndUpload({
        appId: job.appId,
        container: hostRef.current,
        device: job.device,
        bypassBudget: true,
        replace: true,
      }).finally(() => {
        if (!cancelled) setJob(null);
      });
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job]);

  if (!job) return null;

  const viewport = specPageViewport(job.device);
  return (
    <div
      ref={hostRef}
      aria-hidden
      data-testid="studio-landing-shot"
      style={{
        position: "fixed",
        left: -10000,
        top: 0,
        width: viewport.w,
        height: viewport.h,
        overflow: "hidden",
        pointerEvents: "none",
        background: "#fff",
      }}
    >
      <HtmlAppSurface html={job.html} source={source} fillPhone={job.device === "phone"} className={job.device === "phone" ? "bg-black" : "bg-white"} />
    </div>
  );
}
