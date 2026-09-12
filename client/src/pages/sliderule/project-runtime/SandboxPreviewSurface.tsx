import React from "react";
import type { PreviewDescriptor } from "@shared/project-runtime.generated";
import type { ProjectPreviewReference } from "./project-preview-client";
import { useProjectPreview } from "./useProjectPreview";
import { ProjectVerificationPanel } from "./ProjectVerificationPanel";

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
  const description =
    preview.error ||
    (mismatch
      ? "当前运行的是另一份源码版本，请先同步或启动当前工程。"
      : preview.snapshot?.available === false
        ? "当前环境尚未提供可用的私有预览，工程运行状态会继续保留。"
        : descriptor?.status === "ready"
          ? "点击打开工程预览。预览就绪不代表业务验收已通过。"
          : "这里显示工程的实际运行状态，应用启动就绪后可以打开预览。");

  return (
    <section
      data-testid="sandbox-preview-surface"
      data-project-id={projectId ?? ""}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-stone-200 bg-white"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-stone-800">
            {appTitle}
          </h2>
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
        ready={Boolean(
          !preview.error &&
          !preview.loading &&
          !mismatch &&
          descriptor?.status === "ready"
        )}
      />
      {preview.entryUrl ? (
        <iframe
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
    </section>
  );
}
