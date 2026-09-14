import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";
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
    "工程已启动，但私有预览通道还没有建立。请更新状态后重试。",
  project_preview_binding_changed:
    "工程运行授权已变化，当前预览需要重新同步或启动。",
};

function previewReasonText(reason: string | null | undefined) {
  if (!reason) return null;
  return PREVIEW_REASON[reason] ?? `工程预览暂不可用（${reason}）。`;
}

export function SandboxPreviewSurface({
  projectId,
  projectRevision,
  revisionMode = "pinned",
  appTitle = "工程预览",
}: ProjectPreviewReference & { appTitle?: string }) {
  const preview = useProjectPreview({
    projectId,
    projectRevision,
    revisionMode,
  });
  const descriptor = preview.snapshot?.descriptor;
  const [tab, setTab] = useState<
    "preview" | "source" | "history" | "data" | "delivery"
  >("preview");
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
    setTab("preview");
    setWorkspaceOpened(false);
    setSelection(null);
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
        setTab("source");
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
  const status = preview.loading
    ? "正在读取工程状态"
    : preview.error
      ? "暂时无法打开预览"
      : mismatch
        ? "运行版本与当前工程不同"
        : descriptor
          ? STATUS[descriptor.status]
          : "工程尚未启动";
  const blockedReason = previewReasonText(preview.snapshot?.reason);
  const description =
    preview.error ||
    (mismatch
      ? "当前运行的是另一份源码版本，请先同步或启动当前工程。"
      : preview.loading
        ? "正在读取工程运行状态…"
        : blockedReason ||
          (!descriptor
            ? PREVIEW_REASON.project_runtime_not_started
            : descriptor.status !== "ready"
              ? `${STATUS[descriptor.status]}。这里会继续更新实际运行状态。`
              : preview.snapshot?.available === false
                ? "应用已就绪，但私有预览暂不可用，请更新状态查看具体原因。"
                : preview.opening
                  ? "正在申请本次预览访问授权…"
                  : "应用已就绪。点击「打开预览」获取本次访问授权；预览就绪不代表业务验收已通过。"));

  return (
    <section
      data-testid="sandbox-preview-surface"
      data-project-id={projectId ?? ""}
      data-project-revision={descriptor?.revision ?? ""}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-stone-200 bg-white"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-stone-800">
              {appTitle}
            </h2>
            <span
              className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
              title="工程在 E2B 沙盒中运行，预览通过受控网关访问"
            >
              E2B 沙盒
            </span>
          </div>
          <p role="status" className="text-xs text-stone-500">
            {status}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void preview.refresh()}
          disabled={preview.loading}
          className="rounded-md px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-40"
        >
          更新状态
        </button>
        <button
          type="button"
          onClick={() => void preview.open()}
          disabled={!preview.canOpen}
          data-testid="project-preview-open"
          className="rounded-md bg-stone-800 px-3 py-1.5 text-xs text-white hover:bg-stone-700 disabled:opacity-40"
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
            className="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-600 disabled:opacity-40"
          >
            {stopBusy ? "正在请求停止…" : "停止应用"}
          </button>
        ) : null}
      </div>
      {stopError ? (
        <p role="alert" className="px-4 py-2 text-xs text-amber-800">
          {stopError}
        </p>
      ) : null}
      {!preview.loading && !preview.error && blockedReason ? (
        <div
          role="status"
          data-testid="project-preview-blocked-reason"
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          <p className="font-semibold">工程预览当前不可用</p>
          <p className="mt-1 leading-5">{blockedReason}</p>
        </div>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-2">
        {/* 视图切换：对照 Manus 那张截图——它是一枚**收起来的**下拉
            （预览 / 代码 / 仪表盘 / 数据库 / 文件存储 / 设置），不是一排平铺按钮。
            平铺那版在窄屏会换行，把头部顶成三行，而地址行刚加进来，正好是
            被顶掉的那一行。

            ⚠ 用原生 <select>，不自己搭浮层：键盘、读屏、移动端的原生选择器
              全都白拿，而且不引入一个只在这里用一次的弹层组件。
              原来的 role="tab" 语义由 <select> 自带的 listbox 语义接替——
              `project-verification.test.tsx` 里那条「切走就收起验收详情」
              已经跟着改成驱动这个下拉（判据钉的是行为，不是控件长相）。 */}
        <select
          data-testid="project-mode-select"
          aria-label="工程工作台视图"
          value={tab}
          onChange={event => {
            const value = event.target.value as typeof tab;
            setTab(value);
            if (value === "source" || value === "history")
              setWorkspaceOpened(true);
          }}
          className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-1 focus:ring-stone-400"
        >
          {(
            [
              ["preview", "预览"],
              ["source", "源码"],
              ["history", "版本"],
              ["data", "数据"],
              ["delivery", "交付"],
            ] as const
          ).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!preview.entryUrl || bridgeStatus === "waiting"}
          aria-pressed={selecting}
          className="ml-auto rounded border border-stone-300 px-3 py-1 text-xs disabled:opacity-40"
          onClick={() => {
            const value = !selecting;
            setSelecting(value);
            bridge.current?.setEnabled(value);
            setTab("preview");
          }}
        >
          {" "}
          {selecting ? "退出元素选择" : "点选元素定位源码"}
        </button>
        {preview.entryUrl && bridgeStatus === "waiting" ? (
          <span className="text-xs text-stone-500">此预览尚未连接源码定位</span>
        ) : null}
        {bridgeStatus === "missing-source" ? (
          <span role="status" className="text-xs text-amber-800">
            此元素没有源码映射，请从源码列表选择文件。
          </span>
        ) : null}
      </div>
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
        compact={tab !== "preview"}
      />
      {workspaceOpened && projectId ? (
        <div
          className={
            tab === "preview" || tab === "data" || tab === "delivery"
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
        <ProjectDeliveryPanel projectId={projectId} />
      ) : null}
      <div
        className={
          tab === "preview" ? "flex min-h-0 flex-1 flex-col" : "hidden"
        }
      >
        {/* 地址行：对照 Manus 那张预览截图——它上面有一条像浏览器的行，
            一眼知道「这是一个真的在跑的站」。

            ⚠ 只画**真的能用**的那几个。两轮各删掉一个（2026-09-14）：
              · Manus 的「编辑 / 发布」——我们的发布通道没接通，画一个点不动的
                按钮比不画更糟（§7 不许伪造）。
              · 自己加的「首页」按钮——写的是 `frame.src = preview.entryUrl`，
                而 entryUrl 里那张 ticket 是**一次性**的（useProjectPreview
                每次 open() 换一张），重新导航过去等于拿一张用过的票。
                本机预览网关是通配符域名 + TLS，验不了，所以不猜——删掉。
            ⚠ 「刷新」必须是 open()，不是 refresh()：refresh() 只重拉状态快照
              （头部那颗「更新状态」就是它），重新载入页面要的是**换一张票**，
              也就是头部那颗在有 entryUrl 时显示为「刷新预览」的按钮。
              第一版接错成 refresh()，点下去页面纹丝不动。 */}
        {preview.entryUrl ? (
          <div
            className="flex shrink-0 items-center gap-1.5 border-b border-stone-200 bg-stone-50 px-2 py-1.5"
            data-testid="project-preview-addressbar"
          >
            <span
              className="min-w-0 flex-1 truncate rounded border border-stone-200 bg-white px-2 py-1 font-mono text-[11px] text-stone-500"
              title={preview.entryUrl}
              data-testid="project-preview-url"
            >
              {previewPath(preview.entryUrl)}
            </span>
            <a
              href={preview.entryUrl}
              target="_blank"
              rel="noreferrer noopener"
              title="在新标签页打开"
              className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-200"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              title="重新载入页面"
              data-testid="project-preview-reload"
              disabled={!preview.canOpen}
              onClick={() => void preview.open()}
              className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-200 disabled:opacity-40"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {preview.entryUrl ? (
          <iframe
            ref={frame}
            title={`${appTitle} · 运行页面`}
            src={preview.entryUrl}
            data-testid="project-preview-frame"
            className="min-h-0 w-full flex-1 border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex min-h-48 flex-1 items-center justify-center p-8">
            <p
              className="max-w-md text-center text-sm leading-6 text-stone-500"
              role={preview.error ? "alert" : undefined}
            >
              {description}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
