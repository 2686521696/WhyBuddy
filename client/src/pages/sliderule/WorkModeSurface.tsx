/**
 * WorkModeSurface — Work 模式（角色自动巡演）主面（三期沉浸化）。
 *
 * 有五系统模型时：3D 巡演舞台铺满内容区（Agentshire 式全屏画布），
 * UI 全部悬浮——顶部中央进度胶囊 + 事件横幅、右上控制钮、右侧可折叠
 * 事件流、右下巡演报告卡。角色 NPC 按剧本真跑运行时（数据真落库、
 * 流程真推进、RBAC 真拦截）——诚实原则：每个演出事件绑一次真实运行时
 * 动作，巡演结束切 Code 模式能在应用/数据表看到留痕。
 * 无模型时：诚实空态（先去 Code 模式推演出应用）。
 */

import React from "react";
import {
  CircleAlert,
  CircleCheck,
  Info,
  ListOrdered,
  Play,
  Square,
  X,
} from "lucide-react";
import type { FiveSystemModel } from "./system-screens/five-system-model";
import type { AppRuntimeSchema } from "./live-runtime/app-runtime-schema";
import {
  deriveRoleAccess,
  pageAccessForRole,
} from "./live-runtime/rbac-preview";
import { buildTourScript, type TourScript } from "./work-mode/tour-script";
import {
  runTour,
  type TourEvent,
  type TourReport,
} from "./work-mode/tour-driver";
import type { TourStageHandle } from "./work-mode/TourStage3D";
import { isMotionReduced } from "./user-prefs";

// three.js 舞台懒加载分包（three + GLTFLoader 不进主包）
const TourStage3D = React.lazy(() => import("./work-mode/TourStage3D"));

interface FeedItem {
  id: number;
  text: string;
  tone: "info" | "ok" | "blocked";
}

export function WorkModeSurface({
  model,
  schema,
  sessionId,
  appTitle,
}: {
  model: FiveSystemModel | null;
  schema: AppRuntimeSchema | null;
  sessionId: string;
  appTitle?: string;
}) {
  const script: TourScript | null = React.useMemo(
    () => buildTourScript(model, schema),
    [model, schema]
  );

  const stageRef = React.useRef<TourStageHandle | null>(null);
  const cancelRef = React.useRef(false);
  const [running, setRunning] = React.useState(false);
  const [feed, setFeed] = React.useState<FeedItem[]>([]);
  const [feedOpen, setFeedOpen] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    current: number;
    total: number;
  } | null>(null);
  const [banner, setBanner] = React.useState<FeedItem | null>(null);
  const [report, setReport] = React.useState<TourReport | null>(null);
  const [profileNpcId, setProfileNpcId] = React.useState<string | null>(null);
  const feedSeq = React.useRef(0);
  const feedEndRef = React.useRef<HTMLDivElement | null>(null);
  const bannerTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // 角色档案（人事卡）：全部从五系统 model 确定性推导，与运行应用同源判定
  const profile = React.useMemo(() => {
    if (!profileNpcId || !script || !model || !schema) return null;
    const actor = script.cast.find(a => a.npcId === profileNpcId);
    if (!actor) return null;
    const access = deriveRoleAccess(model).find(r => r.role === actor.roleId);
    const pages = pageAccessForRole(schema.pages, access);
    const nodes = (model.workflow?.nodes ?? []).filter(
      n => n.assigneeRole === actor.roleId
    );
    return {
      actor,
      permissions: access?.permissions ?? [],
      menuLabels: access?.menuLabels ?? [],
      visiblePages: pages.filter(p => p.visible),
      deniedPages: pages.filter(p => !p.visible),
      nodes,
    };
  }, [profileNpcId, script, model, schema]);

  const onEvent = React.useCallback((event: TourEvent) => {
    stageRef.current?.dispatch(event);
    if (event.type === "narration") {
      setFeed(prev => [
        ...prev,
        { id: ++feedSeq.current, text: event.text, tone: event.tone },
      ]);
      // 顶部事件横幅：只播关键事件（落库/推进/拦截），info 级走位不打扰
      if (event.tone !== "info") {
        const item = {
          id: ++feedSeq.current,
          text: event.text,
          tone: event.tone,
        };
        setBanner(item);
        if (bannerTimer.current) clearTimeout(bannerTimer.current);
        bannerTimer.current = setTimeout(() => setBanner(null), 3400);
      }
    } else if (event.type === "progress") {
      setProgress({ current: event.current, total: event.total });
    }
  }, []);

  React.useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: "end" });
  }, [feed.length]);

  React.useEffect(
    () => () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    },
    []
  );

  const startTour = React.useCallback(async () => {
    if (!script || !model || !schema || running) return;
    cancelRef.current = false;
    setFeed([]);
    setReport(null);
    setBanner(null);
    setRunning(true);
    try {
      const result = await runTour(script, {
        model,
        schema,
        sessionId,
        onEvent,
        // 减少动效偏好下巡演节奏更快（不空等演出）
        pause: () =>
          new Promise(r => setTimeout(r, isMotionReduced() ? 220 : 950)),
        isCancelled: () => cancelRef.current,
      });
      setReport(result);
    } finally {
      setRunning(false);
    }
  }, [script, model, schema, sessionId, running, onEvent]);

  // ── 无模型：诚实空态 ─────────────────────────────────────────
  if (!script) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-4 px-6"
        data-testid="sliderule-work-mode"
      >
        <div className="text-[17px] font-semibold text-stone-700">
          Work 模式 · 角色自动巡演
        </div>
        <p className="max-w-[480px] text-center text-[13px] leading-6 text-stone-500">
          这里会让各业务角色自动跑通你推演出的应用：数据真实落库、权限真实
          拦截、流程真实推进，最后产出角色巡演报告。
        </p>
        <p
          className="text-xs text-stone-400"
          data-testid="sliderule-work-empty"
        >
          本话题还没有五系统模型——先切到 Code 模式发一句业务意图，推演出
          应用后回来开演。
        </p>
      </div>
    );
  }

  // ── 有模型：全屏沉浸巡演面（舞台铺满，HUD 悬浮）─────────────────
  return (
    <div
      className="relative h-full min-h-0 overflow-hidden"
      data-testid="sliderule-work-mode"
    >
      {/* 3D 舞台铺满内容区（SSR/测试环境不挂 WebGL）；点击角色出档案卡 */}
      <div className="absolute inset-0">
        {typeof window !== "undefined" ? (
          <React.Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xs text-stone-400">
                舞台装配中…
              </div>
            }
          >
            <TourStage3D
              key={`${sessionId}-${script.cast.length}-${script.stations.length}`}
              cast={script.cast}
              stations={script.stations}
              zones={script.zones}
              onReady={handle => {
                stageRef.current = handle;
              }}
              onActorClick={setProfileNpcId}
            />
          </React.Suspense>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-stone-400">
            3D 舞台需要浏览器环境
          </div>
        )}
      </div>

      {/* 左上：应用名 + 剧本规模（角色巡演） */}
      <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-1.5 backdrop-blur">
        <span className="max-w-[220px] truncate text-[12px] font-semibold text-white">
          {appTitle || "推演应用"} · 角色巡演
        </span>
        <span className="text-[11px] text-white/60">
          {script.cast.length} 角色 · {script.stations.length} 工位 ·{" "}
          {script.steps.length} 步
        </span>
      </div>

      {/* 顶部中央：进度胶囊（Agentshire「工作中 n/N」式）+ 事件横幅 */}
      <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-2">
        {running && progress && (
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-1.5 backdrop-blur">
            <span className="text-[12px] font-semibold text-white">工作中</span>
            <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-white/20">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-[#4ade80] transition-all"
                style={{
                  width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%`,
                }}
              />
            </span>
            <span className="font-mono text-[11px] text-white/70">
              {progress.current}/{progress.total}
            </span>
          </div>
        )}
        {banner && (
          <div
            className={`flex max-w-[520px] items-center gap-2 rounded-lg px-3.5 py-1.5 text-[12px] font-medium backdrop-blur ${
              banner.tone === "blocked"
                ? "bg-[#a8353f]/90 text-white"
                : "bg-black/70 text-white"
            }`}
            data-testid="sliderule-tour-banner"
          >
            {banner.tone === "blocked" ? (
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <CircleCheck className="h-3.5 w-3.5 shrink-0 text-[#4ade80]" />
            )}
            <span className="truncate">{banner.text}</span>
          </div>
        )}
      </div>

      {/* 右上：控制钮 + 事件流开关 */}
      <div className="absolute right-4 top-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFeedOpen(v => !v)}
          className={`flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition ${
            feedOpen
              ? "bg-white text-stone-700"
              : "bg-black/55 text-white hover:bg-black/70"
          }`}
          aria-label="巡演事件流"
          aria-pressed={feedOpen}
        >
          <ListOrdered className="h-4 w-4" />
        </button>
        {running ? (
          <button
            type="button"
            data-testid="sliderule-tour-stop"
            onClick={() => {
              cancelRef.current = true;
            }}
            className="flex h-8 items-center gap-1.5 rounded-full bg-white/90 px-3.5 text-[12px] font-semibold text-stone-700 shadow-sm backdrop-blur transition hover:bg-white"
          >
            <Square className="h-3.5 w-3.5" />
            停止
          </button>
        ) : (
          <button
            type="button"
            data-testid="sliderule-tour-start"
            onClick={startTour}
            className="flex h-8 items-center gap-1.5 rounded-full bg-[#1677ff] px-4 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[#0958d9]"
          >
            <Play className="h-3.5 w-3.5" />
            开始巡演
          </button>
        )}
      </div>

      {/* 右侧：可折叠事件流（悬浮面板） */}
      {feedOpen && (
        <div className="absolute bottom-4 right-4 top-14 w-[300px] overflow-y-auto rounded-lg bg-white/92 p-3 shadow-lg backdrop-blur">
          {feed.length === 0 ? (
            <p className="text-xs leading-5 text-stone-400">
              点「开始巡演」：角色将按 workflow 链路真实跑一遍——录入数据、
              发起并推进流程、演示权限拦截。全程真调运行时，留痕可在 Code
              模式的应用里查验。
            </p>
          ) : (
            <div className="space-y-1.5" data-testid="sliderule-tour-feed">
              {feed.map(item => (
                <div
                  key={item.id}
                  className="flex items-start gap-1.5 text-xs leading-5"
                >
                  {item.tone === "ok" ? (
                    <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : item.tone === "blocked" ? (
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                  ) : (
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-300" />
                  )}
                  <span
                    className={
                      item.tone === "blocked"
                        ? "text-rose-600"
                        : "text-stone-600"
                    }
                  >
                    {item.text}
                  </span>
                </div>
              ))}
              <div ref={feedEndRef} />
            </div>
          )}
        </div>
      )}

      {/* 右下：巡演报告卡（事件流展开时让位不叠） */}
      {report && !feedOpen && (
        <div
          className="absolute bottom-4 right-4 w-[280px] rounded-lg bg-white/92 p-3 shadow-lg backdrop-blur"
          data-testid="sliderule-tour-report"
        >
          <div className="text-[12px] font-semibold text-stone-700">
            巡演报告
          </div>
          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-stone-500">
            <li>
              真实落库 {report.rowsCreated} 行 · 流程实例{" "}
              {report.instancesStarted} 个
            </li>
            <li>
              审批通过 {report.approvals} 步 ·{" "}
              {report.instanceCompleted ? "流程走到终态" : "流程未到终态"}
            </li>
            <li className={report.denials.length ? "text-rose-600" : ""}>
              RBAC 拦截 {report.denials.length} 处
              {report.denials.length > 0 &&
                `（${[...new Set(report.denials.map(d => d.roleId))].join("、")}）`}
            </li>
            {report.errors.map((e, i) => (
              <li key={i} className="text-amber-700">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 角色档案卡（人事卡）——全部 schema 推导，与运行应用同源 */}
      {profile && (
        <div
          className="absolute left-4 top-14 w-[264px] rounded-lg bg-white/95 p-3 shadow-lg backdrop-blur"
          data-testid="sliderule-actor-profile"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-stone-800">
                {profile.actor.roleId}
              </div>
              <div className="text-[11px] text-stone-400">
                {profile.menuLabels.join(" · ") || "未挂任何部门菜单"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setProfileNpcId(null)}
              className="shrink-0 rounded p-0.5 text-stone-400 hover:bg-[#eef0f4] hover:text-stone-600"
              aria-label="关闭档案卡"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 space-y-2 text-xs leading-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                权限（{profile.permissions.length}）
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {profile.permissions.length === 0 ? (
                  <span className="text-stone-400">无</span>
                ) : (
                  profile.permissions.map(p => (
                    <span
                      key={p}
                      className="rounded bg-[#e9edf2] px-1.5 py-0.5 font-mono text-[10px] text-stone-600"
                    >
                      {p}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                可见页面（{profile.visiblePages.length}）
              </div>
              <div className="text-stone-600">
                {profile.visiblePages.map(p => p.title).join("、") || "无"}
              </div>
              {profile.deniedPages.length > 0 && (
                <div className="text-rose-600">
                  无权：{profile.deniedPages.map(p => p.title).join("、")}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                流程职责（{profile.nodes.length}）
              </div>
              <div className="text-stone-600">
                {profile.nodes.map(n => n.name || n.id).join(" → ") ||
                  "不在任何审批节点上"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
