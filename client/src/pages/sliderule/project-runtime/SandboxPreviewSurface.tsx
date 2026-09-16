import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RotateCw,
} from "lucide-react";
import type { PreviewDescriptor } from "@shared/project-runtime.generated";
import type { ProjectPreviewReference } from "./project-preview-client";
import { useProjectPreview } from "./useProjectPreview";
import { ProjectVerificationPanel } from "./ProjectVerificationPanel";
import {
  ProjectWorkspacePanel,
  type SourceSelection,
} from "./ProjectWorkspacePanel";
import { connectPreviewSelection } from "./preview-selection-bridge";
import { ProjectDataPanel } from "./ProjectDataPanel";
import { ProjectDeliveryPanel } from "./ProjectDeliveryPanel";
import {
  ProjectWorkspaceError,
  requestProjectWorkspace,
} from "./project-workspace-client";
import { ProjectComputerPanel } from "../ProjectComputerPanel";
import { StudioShareToggle } from "../StudioShareToggle";
import { deriveProjectActivity, projectComputerView } from "../project-activity";
import {
  computerViewForAction,
  dispatchFollowComputer,
  dispatchInspectAction,
  FOLLOW_COMPUTER_EVENT,
  INSPECT_ACTION_EVENT,
  inspectActionDetail,
  resolveComputerView,
  type ComputerView,
} from "../project-computer-view";
import { sandboxCommandLine } from "../sandbox-session-transcript";
import type { UiTurn } from "../types";

/**
 * 地址栏只显示**路径**，不显示那串 runtimeId 主机名。
 *
 * ⚠ 主机名是 `{runtimeId}.预览域`，对用户没有信息量，却会把这一行撑满
 *   （Manus 那张截图里显示的也只是 `/`）。完整地址仍在 title 和外开链接上。
 */
function previewPath(entryUrl: string): string {
  try {
    const url = new URL(entryUrl);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return entryUrl;
  }
}

const STATUS: Record<PreviewDescriptor["status"], string> = {
  provisioning: "正在准备运行环境",
  syncing: "正在同步工程源码",
  installing: "正在安装依赖",
  executing: "正在执行工程任务",
  starting: "正在启动应用",
  ready: "预览就绪",
  stopping: "正在停止应用",
  stopped: "应用已停止",
  expired: "运行环境已过期",
  failed: "应用运行失败",
  reconciling: "正在核对运行状态",
};

/** Stable server reason codes are translated here so rollout gates are visible
 * at the point where a user tries to open the project. */
const PREVIEW_REASON: Record<string, string> = {
  project_rollout_disabled:
    "工程模式当前已关闭（WHYBUDDY_PROJECT_ROLLOUT=disabled）。管理员开启工程 rollout 后才能启动沙盒。",
  project_preview_not_configured:
    "工程预览尚未配置独立预览域名、网关密钥或其他必要参数。",
  project_preview_gateway_not_configured:
    "工程预览网关尚未配置，暂时不能提供私有预览。",
  project_private_preview_origin_required:
    "工程预览缺少独立 HTTPS 来源，不能安全打开生成应用。",
  project_runtime_not_started:
    "工程还没有启动运行实例。请先启动工程，系统会在沙盒准备好后提供预览。",
  project_runtime_not_ready:
    "工程运行实例还没有就绪，请等待启动完成后再打开预览。",
  project_preview_tunnel_not_started:
    "工程已启动，但私有预览通道还没有建立。",
  project_preview_binding_changed:
    "工程运行授权已变化，当前预览需要重新同步或启动。",
};

function previewReasonText(reason: string | null | undefined) {
  if (!reason) return null;
  return PREVIEW_REASON[reason] ?? `工程预览暂不可用（${reason}）。`;
}

const SESSION_MODES = [
  ["computer", "终端"],
  ["preview", "预览"],
  ["source", "源码"],
  ["history", "版本"],
  ["data", "数据"],
  ["delivery", "交付"],
] as const;
const APP_MODES = SESSION_MODES.filter(([value]) => value !== "computer");

/**
 * 切档。对照 Cursor 的模型/视图菜单：触发器是安静的字 + 箭头，
 * 浮层自己画，不用系统 `<select>`——Windows 原生列表会把整条顶栏
 * 撑成一块系统控件（2026-09-14 真机圈的）。
 *
 * ⚠ 2026-09-14 点开「看着没有」：菜单是 absolute，父级
 *   `overflow-x-auto` 会把 overflow-y 也收成裁切（CSS 规定），
 *   32px 高的顶栏把整张菜单剪没。终端又在后面画，没 z-index
 *   也会盖住漏出来的那一点。头条要 `relative z-10`，齿轮条
 *   不许写 overflow-x-auto。
 */
function ComputerModeSelect({
  tab,
  hasSession,
  onPick,
}: {
  tab: ComputerView;
  hasSession: boolean;
  onPick: (value: ComputerView) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const modes = hasSession ? SESSION_MODES : APP_MODES;
  const current = modes.find(([value]) => value === tab)?.[1] ?? modes[0][1];
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className="relative"
      data-testid="project-mode-select"
      data-mode={tab}
      aria-label="工程工作台视图"
    >
      <button
        type="button"
        data-testid="project-mode-trigger"
        aria-label="工程工作台视图"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(value => !value)}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5]"
      >
        <span>{current}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#8a8a8a]" aria-hidden />
      </button>
      <ul
        role="listbox"
        hidden={!open}
        className="absolute right-0 z-30 mt-1 min-w-[8rem] rounded-lg border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgb(15_23_42/0.12)]"
      >
        {modes.map(([value, label]) => {
          const selected = tab === value;
          return (
            <li key={value}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                data-mode-label={label}
                onClick={() => {
                  onPick(value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] ${
                  selected
                    ? "bg-[#f4f4f5] font-medium text-[#1f1f1f]"
                    : "text-[#3c3c3c] hover:bg-[#f7f7f8]"
                }`}
              >
                <Check
                  className={`h-3.5 w-3.5 ${selected ? "text-[#1f1f1f]" : "opacity-0"}`}
                  aria-hidden
                />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 2026-09-15 对照 Manus 电脑底栏：提示符、回放轴、「实时」。
 * 画在外壳上，不画进面板——再叠一条就是 2026-09-14 拆掉的第二层壳。
 * 「实时」只在真有动作在跑且跟着最新时亮。
 */
function ComputerReplayDock({
  rows,
  focusId,
}: {
  rows: ReturnType<typeof deriveProjectActivity>;
  focusId: string | null;
}) {
  const focusIndex = focusId ? rows.findIndex(row => row.id === focusId) : -1;
  const { index, live, following } = projectComputerView(
    rows,
    focusIndex >= 0 ? focusIndex : null
  );
  const seek = (next: number) => {
    const row = rows[next];
    if (!row) return;
    dispatchInspectAction({ id: row.id, tool: row.tool, keepView: true });
  };
  return (
    <footer
      data-testid="project-computer-promptbar"
      className="flex shrink-0 items-center gap-2 border-t border-stone-200 px-3 py-1.5"
    >
      <span className="font-mono text-[12px] text-stone-400" aria-hidden>
        $
      </span>
      <button
        type="button"
        aria-label="上一步"
        data-testid="project-computer-prev"
        disabled={index <= 0}
        onClick={() => seek(Math.max(index - 1, 0))}
        className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(rows.length - 1, 0)}
        value={index}
        aria-label="回放进度"
        onChange={event => seek(Number(event.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-blue-500"
      />
      <button
        type="button"
        aria-label="下一步"
        data-testid="project-computer-next"
        disabled={index >= rows.length - 1}
        onClick={() => seek(Math.min(index + 1, rows.length - 1))}
        className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {following ? (
        <span
          className={`shrink-0 text-[11px] ${live ? "text-blue-600" : "text-stone-400"}`}
          data-testid="project-computer-live"
        >
          {live ? "实时" : `${index + 1} / ${rows.length}`}
        </span>
      ) : (
        <button
          type="button"
          data-testid="project-computer-follow"
          onClick={() => dispatchFollowComputer()}
          className="shrink-0 text-[11px] text-blue-600 hover:underline"
        >
          跳到实时
        </button>
      )}
    </footer>
  );
}

/**
 * 预览没打开时的脸。2026-09-16 第二轮对照 Manus 空态：
 * 窗骨架 + 一句「预览已暂停，点击以唤醒。」+ 黑底「唤醒」。
 * 配置/HTTP 错误才加第二行；「工程还没启动」那种说明书不许再写。
 *
 * 唤醒 = 能开就换票（open），过期/停止就 POST /preview/wake；
 * 失败必须把原因写在第二行，不许假装刷新就好了。
 */
function PreviewPausedFace({
  title,
  detail,
  waking,
  disabled,
  alert,
  onWake,
}: {
  title: string;
  detail: string | null;
  waking: boolean;
  disabled: boolean;
  alert?: boolean;
  onWake: () => void;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white"
      data-testid="project-preview-paused"
    >
      <div
        className="mb-5 h-[88px] w-[148px] rounded-xl bg-[#f4f4f5] p-3"
        aria-hidden
      >
        <div className="mb-3 flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[#d4d4d8]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#d4d4d8]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#d4d4d8]" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 flex-1 rounded-md bg-white/80" />
          <div className="h-10 flex-1 rounded-md bg-white/80" />
        </div>
      </div>
      <p className="text-[13px] text-[#8a8a8a]">{title}</p>
      {detail ? (
        <p
          role={alert ? "alert" : undefined}
          className="mt-1 max-w-sm px-6 text-center text-[12px] leading-5 text-[#a1a1aa]"
        >
          {detail}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="project-preview-wake"
        disabled={disabled}
        onClick={onWake}
        className="mt-4 rounded-full bg-[#171717] px-5 py-1.5 text-[13px] text-white disabled:opacity-40"
      >
        {waking ? "正在打开…" : "唤醒"}
      </button>
    </div>
  );
}

/**
 * 对照 Manus：预览档地址一直在头条，没打开也画 `/`。
 * 完整 URL 只进 title / 外开，行里只留路径。
 */
function PreviewAddressBar({
  entryUrl,
  canReload,
  onReload,
}: {
  entryUrl: string | null;
  canReload: boolean;
  onReload: () => void;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1"
      data-testid="project-preview-addressbar"
    >
      <span
        className="flex h-6 min-w-0 flex-1 items-center rounded-full bg-[#f4f4f5] px-3 font-mono text-[12px] text-[#8a8a8a]"
        title={entryUrl ?? undefined}
        data-testid="project-preview-url"
      >
        {entryUrl ? previewPath(entryUrl) : "/"}
      </span>
      {entryUrl ? (
        <>
          <a
            href={entryUrl}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="project-preview-open-external"
            title="在新标签页打开"
            aria-label="在新标签页打开预览"
            className="flex h-6 w-6 items-center justify-center rounded text-[#8a8a8a] hover:bg-[#f4f4f5]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            title="重新载入页面"
            data-testid="project-preview-reload"
            disabled={!canReload}
            onClick={onReload}
            className="flex h-6 w-6 items-center justify-center rounded text-[#8a8a8a] hover:bg-[#f4f4f5] disabled:opacity-40"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </>
      ) : null}
    </div>
  );
}

/** 配置/通道类理由才写在空态第二行；未启动、未就绪跟 Manus 一样只说暂停。 */
const PREVIEW_FACE_REASONS = new Set([
  "project_preview_not_configured",
  "project_preview_gateway_not_configured",
  "project_private_preview_origin_required",
  "project_preview_tunnel_not_started",
  "project_preview_binding_changed",
  "project_rollout_disabled",
]);

export function SandboxPreviewSurface({
  projectId,
  projectRevision,
  revisionMode = "pinned",
  appTitle = "工程预览",
  turns,
  className = "",
  chromeSlot,
  resetSlot,
  sessionId,
  isRunning = false,
  projectCreateError = null,
}: ProjectPreviewReference & {
  appTitle?: string;
  /**
   * 会话工作台才传。有它，「终端」才进下拉，并按 `resolveComputerView`
   * 自动切档。应用中心那条预览链不传——那边没有正在干活的动作流。
   */
  turns?: UiTurn[];
  className?: string;
  /**
   * 舞台头条右侧：分栏 / 全屏 + 交付物。从 ProjectStudio 挪进来，
   * 跟「打开预览」同一条，不再在电脑壳上面另叠一行。
   */
  chromeSlot?: React.ReactNode;
  /** 标题左侧：重置会话。HTML 推演顶栏同一颗，工程档也要够得着。 */
  resetSlot?: React.ReactNode;
  sessionId?: string;
  isRunning?: boolean;
  /** 会话工作台：工程还没落库时的创建失败。应用中心不传。 */
  projectCreateError?: string | null;
}) {
  const preview = useProjectPreview({
    projectId,
    projectRevision,
    revisionMode,
  });
  const descriptor = preview.snapshot?.descriptor;
  const [userPinned, setUserPinned] = useState<ComputerView | null>(null);
  const activityRows = useMemo(
    () => (turns ? deriveProjectActivity(turns) : []),
    [turns]
  );
  const computerLive = projectComputerView(activityRows, null).live;
  const previewReady = Boolean(preview.entryUrl);
  const lastTool =
    activityRows.length > 0
      ? activityRows[activityRows.length - 1]?.tool
      : null;
  const hasConsole = activityRows.some(
    row => Boolean(sandboxCommandLine(row) && row.operationId)
  );
  const awaitingProject = Boolean(turns) && !projectId;
  // ⚠ 2026-09-15：工程还没落库时不许改口钉死「computer」。
  //   TicketStream 那趟 create + list 已经有动作，短接会让
  //   resolveComputerView 根本跑不到，右侧白纸。
  const tab: ComputerView = turns
    ? resolveComputerView({
        userPinned,
        live: computerLive,
        hasActivity: activityRows.length > 0,
        previewReady,
        lastTool,
        hasConsole,
      })
    : userPinned && userPinned !== "computer"
      ? userPinned
      : "preview";
  const [stopBusy, setStopBusy] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const stopRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setStopBusy(false);
    setStopError(null);
    return () => {
      stopRequest.current?.abort();
      stopRequest.current = null;
    };
  }, [projectId, preview.snapshot?.operationId]);
  const stopRuntime = async () => {
    const operationId = preview.snapshot?.operationId;
    if (!operationId || stopRequest.current) return;
    const controller = new AbortController();
    stopRequest.current = controller;
    setStopBusy(true);
    setStopError(null);
    try {
      await requestProjectWorkspace(
        `/project-operations/${encodeURIComponent(operationId)}/cancel`,
        controller.signal,
        {}
      );
      if (!controller.signal.aborted) await preview.refresh();
    } catch (error) {
      if (!controller.signal.aborted)
        setStopError(
          error instanceof ProjectWorkspaceError
            ? error.message
            : "停止请求未能确认，请更新运行状态后重试。"
        );
    } finally {
      if (stopRequest.current === controller) stopRequest.current = null;
      if (!controller.signal.aborted) setStopBusy(false);
    }
  };
  const [workspaceOpened, setWorkspaceOpened] = useState(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [focusId, setFocusId] = useState<string | null>(null);
  const focusIndex = focusId
    ? activityRows.findIndex(row => row.id === focusId)
    : -1;
  const computerNow = projectComputerView(
    activityRows,
    focusIndex >= 0 ? focusIndex : null
  );
  const pinView = (value: ComputerView) => {
    setUserPinned(value);
    if (value === "source" || value === "history") setWorkspaceOpened(true);
  };
  useEffect(() => {
    if (tab === "source" || tab === "history") setWorkspaceOpened(true);
  }, [tab]);
  const goPreview = () => {
    pinView("preview");
    void preview.open();
  };
  const canStop = Boolean(
    preview.snapshot?.operationId &&
    descriptor &&
    !["stopped", "expired", "failed"].includes(descriptor.status)
  );
  useEffect(() => {
    const onInspect = (event: Event) => {
      const detail = inspectActionDetail((event as CustomEvent).detail);
      if (!detail) return;
      setFocusId(detail.id);
      if (detail.keepView) return;
      const view = computerViewForAction(detail.tool);
      pinView(view);
    };
    const onFollow = () => {
      // 人已经在看终端，跳回最新那条——不许因为预览就绪被自动切走。
      setFocusId(null);
      setUserPinned("computer");
    };
    window.addEventListener(INSPECT_ACTION_EVENT, onInspect);
    window.addEventListener(FOLLOW_COMPUTER_EVENT, onFollow);
    return () => {
      window.removeEventListener(INSPECT_ACTION_EVENT, onInspect);
      window.removeEventListener(FOLLOW_COMPUTER_EVENT, onFollow);
    };
  }, []);
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<
    "waiting" | "ready" | "missing-source"
  >("waiting");
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof connectPreviewSelection> | null>(
    null
  );
  useEffect(() => {
    setUserPinned(null);
    setFocusId(null);
    setSelection(null);
    // ⚠ 2026-09-15 真机团长工作台 `sr-20260915161915-B2601PBD1Q`：
    //   计划批准后右侧已经停在「代码」等 id，projectId 落到
    //   `prj-4ec824406ad35125a3595c4d419c9eb0` 时这里曾经无条件
    //   `setWorkspaceOpened(false)`。tab 还是 source，下面那条
    //   `[tab]` 不重跑；waiting 卸了（已经有 id），面板又没挂上——
    //   标题写着「代码」，下面整面白纸。用户圈了那张图。
    //   换工程仍要卸上一份的钉档/点选；当前已经在代码/版本档
    //   就立刻再打开，不许经过一个空窗。
    const view = tabRef.current;
    setWorkspaceOpened(view === "source" || view === "history");
  }, [projectId]);
  useEffect(() => {
    setSelecting(false);
    setBridgeStatus("waiting");
    setSelection(null);
    if (!frame.current || !preview.entryUrl || !descriptor) return;
    const connection = connectPreviewSelection({
      frame: frame.current,
      origin: new URL(preview.entryUrl).origin,
      scope: {
        projectId: descriptor.projectId,
        runtimeId: descriptor.runtimeId,
        revision: descriptor.revision,
      },
      onStatus: setBridgeStatus,
      onSelection: location => {
        setSelection({
          ...location,
          revision: descriptor.revision,
          selectionId: crypto.randomUUID(),
        });
        setWorkspaceOpened(true);
        pinView("source");
        setSelecting(false);
        connection.setEnabled(false);
      },
    });
    bridge.current = connection;
    return () => {
      connection.dispose();
      if (bridge.current === connection) bridge.current = null;
    };
  }, [
    preview.entryUrl,
    descriptor?.projectId,
    descriptor?.runtimeId,
    descriptor?.revision,
  ]);
  const mismatch =
    revisionMode === "pinned" &&
    descriptor &&
    projectRevision &&
    descriptor.revision !== projectRevision;
  const previewError = awaitingProject ? projectCreateError : preview.error;
  const previewIdle =
    !descriptor ||
    descriptor.status === "stopped" ||
    descriptor.status === "expired" ||
    descriptor.status === "ready";
  const blockedReason = previewReasonText(preview.snapshot?.reason);
  const faceReason =
    !previewError &&
    !mismatch &&
    preview.snapshot?.reason &&
    PREVIEW_FACE_REASONS.has(preview.snapshot.reason)
      ? blockedReason
      : null;
  const pausedTitle = preview.opening
    ? "正在打开预览…"
    : preview.starting
      ? "正在启动应用…"
      : preview.loading
        ? "正在准备预览…"
        : previewError
          ? "暂时无法打开预览"
          : awaitingProject
            ? "正在准备工程"
            : mismatch
              ? "运行版本与当前工程不同"
              : faceReason
                ? "暂时无法打开预览"
                : previewIdle
                  ? "预览已暂停，点击以唤醒。"
                  : STATUS[descriptor!.status];
  const pausedDetail = previewError
    ? previewError
    : mismatch
      ? "当前运行的是另一份源码版本，请先同步或启动当前工程。"
      : faceReason;
  const canWake = Boolean(
    projectId && !preview.opening && !preview.starting && !awaitingProject
  );
  const wakePreview = () => {
    void preview.wake();
  };
  const showPreviewPick = tab === "preview" && Boolean(preview.entryUrl);
  const previewPickButton = showPreviewPick ? (
    <button
      type="button"
      disabled={bridgeStatus === "waiting"}
      aria-pressed={selecting}
      className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
      onClick={() => {
        const value = !selecting;
        setSelecting(value);
        bridge.current?.setEnabled(value);
        pinView("preview");
      }}
    >
      {selecting ? "退出点选" : "点选"}
    </button>
  ) : null;

  return (
    <section
      data-testid="sandbox-preview-surface"
      data-project-id={projectId ?? ""}
      data-project-revision={descriptor?.revision ?? ""}
      data-computer-view={tab}
      data-preview-status={descriptor?.status ?? "none"}
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden border border-stone-200 bg-white ${
        // 会话工作台贴边铺满：圆角会在四角漏出舞台底色（2026-09-14 真机圈的）。
        // 应用中心那条链没有 turns，仍是卡片，保留 rounded-lg。
        turns ? "" : "rounded-lg "
      }${className}`}
    >
      {turns ? (
        <div
          className="relative z-10 flex h-8 min-w-0 shrink-0 items-center gap-2 border-b border-[#e5e7eb] px-2"
          data-testid="project-computer-chrome"
          data-header-pattern="primer-page-header"
        >
          {/* ⚠ 2026-09-14：对照 HTML 推演那条 sliderule-app-stage-bar——
              功能堆在同一行，不另叠「重置 / 分栏」在电脑壳上头。
              只堆**已经接通**的。2026-09-16 预览档再对照 Manus：
              头条只留切档 + 地址（没打开也是 `/`），打开/停止/私有
              不进预览脸。空画布一句唤醒，验收在交付。

              ⚠ 2026-09-15 真机圈的：源码档把「工程尚未启动 + 检查应用 +
              源码版本工具条 + 编辑器路径」叠成四条顶栏。Manus 源码只有
              「代码 + 当前路径」一行。预览状态、打开预览、停止、私有
              都不属于代码脸，切走预览就卸掉。 */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {resetSlot}
            {tab === "preview" ? (
              <>
                <ComputerModeSelect tab={tab} hasSession onPick={pinView} />
                <PreviewAddressBar
                  entryUrl={preview.entryUrl}
                  canReload={preview.canOpen}
                  onReload={() => void preview.open()}
                />
              </>
            ) : (
              <h2
                className="truncate text-[12px] font-medium text-[#3c3c3c]"
                data-testid="project-computer-title"
              >
                {tab === "source" || tab === "history" ? "代码" : "它的电脑"}
              </h2>
            )}
            {tab === "computer" && computerNow.current?.status === "running" ? (
              <p
                role="status"
                className="min-w-0 truncate text-[11px] text-[#8a8a8a]"
                data-testid="project-computer-live-command"
              >
                正在执行{" "}
                {sandboxCommandLine(computerNow.current) ||
                  computerNow.current.label}
              </p>
            ) : null}
          </div>
          <div
            className="ml-auto flex min-w-0 items-center"
            data-testid="project-computer-gears"
          >
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {tab === "preview" ? null : (
                <ComputerModeSelect tab={tab} hasSession onPick={pinView} />
              )}
              {tab === "source" ? (
                <div
                  data-testid="project-source-tools-host"
                  className="contents"
                />
              ) : null}
              {previewPickButton}
              {tab === "source" || tab === "history" || tab === "preview" ? null : (
                <>
                  <button
                    type="button"
                    onClick={goPreview}
                    disabled={!preview.canOpen}
                    data-testid="project-preview-open"
                    className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
                  >
                    {preview.opening
                      ? "正在授权…"
                      : preview.entryUrl
                        ? "刷新预览"
                        : "打开预览"}
                  </button>
                  {canStop ? (
                    <button
                      type="button"
                      disabled={stopBusy || descriptor?.status === "stopping"}
                      onClick={() => void stopRuntime()}
                      className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
                    >
                      {stopBusy ? "正在请求停止…" : "停止应用"}
                    </button>
                  ) : null}
                  <StudioShareToggle
                    sessionId={sessionId}
                    running={isRunning}
                  />
                </>
              )}
              {chromeSlot}
            </div>
          </div>
        </div>
      ) : (
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[#e5e7eb] px-2">
        <ComputerModeSelect
          tab={tab}
          hasSession={false}
          onPick={pinView}
        />
        {tab === "preview" ? (
          <PreviewAddressBar
            entryUrl={preview.entryUrl}
            canReload={preview.canOpen}
            onReload={() => void preview.open()}
          />
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <div className="flex shrink-0 items-center gap-1">
          {previewPickButton}
          <button
            type="button"
            onClick={() => void preview.refresh()}
            disabled={preview.loading}
            className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
          >
            更新状态
          </button>
          <button
            type="button"
            onClick={() => void preview.open()}
            disabled={!preview.canOpen}
            data-testid="project-preview-open"
            className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
          >
            {preview.opening
              ? "正在授权…"
              : preview.entryUrl
                ? "刷新预览"
                : "打开预览"}
          </button>
          {preview.snapshot?.operationId &&
          descriptor &&
          !["stopped", "expired", "failed"].includes(descriptor.status) ? (
            <button
              type="button"
              disabled={stopBusy || descriptor.status === "stopping"}
              onClick={() => void stopRuntime()}
              className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
            >
              {stopBusy ? "正在请求停止…" : "停止应用"}
            </button>
          ) : null}
        </div>
      </div>
      )}
      {tab === "computer" && turns ? null : stopError ? (
        <p role="alert" className="px-4 py-2 text-xs text-amber-800">
          {stopError}
        </p>
      ) : null}
      {/* 告警条只留给占位区说的是另一件事的时候（版本钉住对不上）。
          未启动 / 通道未建写在空态，不再叠一条黄条。 */}
      {!(tab === "computer" && turns) &&
      mismatch &&
      !preview.loading &&
      !preview.error &&
      blockedReason ? (
        <div
          role="status"
          data-testid="project-preview-blocked-reason"
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          <p className="font-semibold">工程预览当前不可用</p>
          <p className="mt-1 leading-5">{blockedReason}</p>
        </div>
      ) : null}
      {tab === "computer" ? (
        activityRows.length > 0 ? (
          <ProjectComputerPanel
            turns={turns ?? []}
            embedded
            focusId={focusId}
            runtimeOperationId={preview.snapshot?.operationId}
            className="min-h-0 flex-1"
          />
        ) : (
          <div
            className="flex min-h-0 flex-1 items-center justify-center p-8"
            data-testid="project-computer-empty"
          >
            <p className="max-w-md text-center text-sm leading-6 text-stone-500">
              {awaitingProject
                ? projectCreateError ||
                  "计划已批准，正在创建工程。命令会写在这里。"
                : "还没有工程动作。模型开始干活之后，这里会显示它正在跑的命令。"}
            </p>
          </div>
        )
      ) : null}
      {tab === "computer" && turns && activityRows.length > 0 ? (
        <ComputerReplayDock rows={activityRows} focusId={focusId} />
      ) : null}
      {tab === "source" && !projectId ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center p-8"
          data-testid="project-source-waiting"
        >
          <p className="max-w-md text-center text-sm leading-6 text-stone-500">
            {projectCreateError ||
              "计划已批准，正在创建工程。源码会出现在这里。"}
          </p>
        </div>
      ) : null}
      {/* ⚠ 挂面板不能只听 workspaceOpened。真机那张白纸：tab 已经是
          source、projectId 也有了，换 id 把 opened 扳回 false，首屏
          在 effect 跑完前（以及 [tab] 不重跑之后）什么都不画。
          人正在看代码/版本档、有工程，就必须挂；opened 只负责切走
          预览时把草稿藏着不卸。 */}
      {(workspaceOpened || tab === "source" || tab === "history") &&
      projectId ? (
        <div
          className={
            tab === "preview" ||
            tab === "data" ||
            tab === "delivery" ||
            tab === "computer"
              ? "hidden"
              : "flex min-h-0 flex-1 flex-col"
          }
        >
          <ProjectWorkspacePanel
            projectId={projectId}
            projectRevision={projectRevision}
            revisionMode={revisionMode}
            tab={tab === "history" ? "history" : "source"}
            selection={selection}
            onChanged={() => void preview.refresh()}
          />
        </div>
      ) : null}
      {tab === "data" && projectId ? (
        <ProjectDataPanel
          projectId={projectId}
          runtimeStopped={Boolean(
            !preview.loading &&
            !preview.error &&
            (!descriptor || descriptor.status === "stopped")
          )}
        />
      ) : null}
      {tab === "delivery" && projectId ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ProjectVerificationPanel
            projectId={projectId}
            revision={
              revisionMode === "current"
                ? descriptor?.revision
                : (projectRevision ?? descriptor?.revision)
            }
            runtimeOperationId={preview.snapshot?.operationId}
            runtimeId={descriptor?.runtimeId}
            suiteVersion={descriptor?.capabilities
              ?.find(capability => capability.startsWith("verification:"))
              ?.slice("verification:".length)}
            ready={Boolean(
              !preview.error &&
              !preview.loading &&
              !mismatch &&
              descriptor?.status === "ready"
            )}
          />
          <ProjectDeliveryPanel projectId={projectId} />
        </div>
      ) : null}
      <div
        className={
          tab === "preview" ? "flex min-h-0 flex-1 flex-col" : "hidden"
        }
      >
        {/* ⚠ 2026-09-16 TicketStream 预览：工程 iframe 必须是真实 CSS
            像素，不许套 transform:scale（HTML 舞台手机框那条会让点
            的位置和看到的位置错开，看着能点其实点不中）。
            touch-action:manipulation 让移动端点按落到框里，不被宿主
            当成要滚/要拖。pointer-events-auto 钉死——拖缝时
            [data-studio-resizing] 会临时关掉，松手必须回到能点。

            ⚠ 2026-09-16 晚：粗指针上盖过一层 target=_blank。设备工具栏
            把 pointer 收成 coarse，点登录框就新开标签——用户圈了。
            预览点按必须进 iframe，外开只留地址行那颗。 */}
        {preview.entryUrl ? (
          <iframe
            ref={frame}
            title={`${appTitle} · 运行页面`}
            src={preview.entryUrl}
            data-testid="project-preview-frame"
            tabIndex={-1}
            onPointerDown={() => frame.current?.focus()}
            className="min-h-0 w-full flex-1 border-0 bg-white pointer-events-auto [touch-action:manipulation]"
            sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads"
            referrerPolicy="no-referrer"
          />
        ) : (
          <PreviewPausedFace
            title={pausedTitle}
            detail={pausedDetail}
            waking={preview.opening || preview.starting}
            disabled={!canWake}
            alert={Boolean(previewError)}
            onWake={wakePreview}
          />
        )}
      </div>
    </section>
  );
}
