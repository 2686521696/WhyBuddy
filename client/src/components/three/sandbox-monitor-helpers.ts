import type { ScreenshotFrame } from "@/lib/sandbox-store";
import type {
  MissionTaskDetail,
  MissionTaskSummary,
  TaskArtifact,
} from "@/lib/tasks-store";

import { compactText } from "../tasks/task-helpers";
import { selectDisplayMission } from "../tasks/mission-island-helpers";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function resolveSandboxMonitorMission(
  tasks: MissionTaskSummary[],
  detailsById: Record<string, MissionTaskDetail>,
  selectedTaskId: string | null
) {
  const selectedMission =
    tasks.find(task => task.id === selectedTaskId) ?? null;
  const displayMission = selectedMission ?? selectDisplayMission(tasks);
  const missionDetail = displayMission
    ? (detailsById[displayMission.id] ?? null)
    : null;

  return {
    selectedMission,
    displayMission,
    missionDetail,
  };
}

export function resolveBrowserPreviewFrames(
  latestScreenshot: ScreenshotFrame | null,
  previousScreenshot: ScreenshotFrame | null,
  replayScreenshot: ScreenshotFrame | null = null
) {
  const current = latestScreenshot ?? previousScreenshot ?? replayScreenshot;
  return {
    current,
    previous: latestScreenshot ? previousScreenshot : null,
  };
}

function artifactName(artifact: TaskArtifact): string {
  return `${artifact.title || ""} ${artifact.filename || ""}`.toLowerCase();
}

function findPreviewArtifact(
  artifacts: TaskArtifact[],
  preferredNames: string[],
  fallback: (artifact: TaskArtifact) => boolean
): TaskArtifact | null {
  for (const preferredName of preferredNames) {
    const match = artifacts.find(artifact =>
      artifactName(artifact).includes(preferredName)
    );
    if (match?.previewUrl) return match;
  }
  return (
    artifacts.find(artifact => artifact.previewUrl && fallback(artifact)) ??
    null
  );
}

export function resolveReplayScreenshotArtifact(
  detail: MissionTaskDetail | null
): TaskArtifact | null {
  if (!detail) return null;
  return findPreviewArtifact(
    detail.artifacts,
    ["live-preview-frame", "page-screenshot"],
    artifact =>
      artifact.previewType === "image" ||
      artifact.mimeType?.startsWith("image/") === true ||
      /\.(png|jpe?g|webp|gif)$/i.test(artifact.filename || artifact.title)
  );
}

export function resolveReplayTerminalArtifact(
  detail: MissionTaskDetail | null
): TaskArtifact | null {
  if (!detail) return null;
  return findPreviewArtifact(
    detail.artifacts,
    ["terminal-live.log", "executor.log"],
    artifact =>
      artifact.previewType === "log" ||
      artifact.mimeType?.startsWith("text/") === true ||
      /\.(log|txt)$/i.test(artifact.filename || artifact.title)
  );
}

export function resolvePaneStatusLabel(
  locale: string,
  status: string | null | undefined,
  mode: "terminal" | "browser",
  hasLiveData: boolean
) {
  if (!status) {
    return t(locale, "待命", "Standby");
  }

  if (status === "running") {
    if (hasLiveData) {
      return t(locale, mode === "terminal" ? "在线" : "直播", "Live");
    }
    return t(locale, "启动中", "Booting");
  }

  if (status === "waiting") {
    return t(locale, "等待", "Hold");
  }

  if (status === "failed") {
    return t(locale, "异常", "Alert");
  }

  if (status === "done") {
    return t(
      locale,
      mode === "browser" ? "归档" : "完成",
      mode === "browser" ? "Archive" : "Done"
    );
  }

  return t(locale, "就绪", "Ready");
}

export function resolveBrowserContextLabel(
  locale: string,
  stageLabel: string | null | undefined,
  title: string | null | undefined
) {
  return compactText(
    stageLabel ||
      title ||
      t(locale, "等待新的页面上下文", "Waiting for browser context"),
    28
  );
}
