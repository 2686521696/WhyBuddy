/**
 * SandboxMonitor - unified wall-mounted control device for terminal, task, and browser panes.
 */

import { Html } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/i18n";
import { resolveProjectTaskScope } from "@/lib/project-task-scope";
import { useProjectStore } from "@/lib/project-store";
import {
  type LogLine,
  type SandboxFocusedPane,
  type ScreenshotFrame,
  useSandboxStore,
} from "@/lib/sandbox-store";
import { FUTURE_OFFICE_COLORS } from "@/lib/scene-theme";
import { useTasksStore } from "@/lib/tasks-store";

import { ScreenshotPreview } from "../sandbox/ScreenshotPreview";
import { TerminalPreview } from "../sandbox/TerminalPreview";
import { MissionWallTaskPanel } from "./MissionWallTaskPanel";
import {
  resolveBrowserContextLabel,
  resolveBrowserPreviewFrames,
  resolvePaneStatusLabel,
  resolveReplayScreenshotArtifact,
  resolveReplayTerminalArtifact,
  resolveSandboxMonitorMission,
} from "./sandbox-monitor-helpers";

const WALL_MONITOR_POSITION: [number, number, number] = [0, 1.5, -4.79];
const DEVICE_WIDTH = 988;
const DEVICE_HEIGHT = 190;
const DEVICE_DISTANCE_FACTOR = 5.2;
const DEVICE_PANEL_Z = 0.008;

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function buildPaneShellStyle(active: boolean): React.CSSProperties {
  return {
    position: "relative",
    minWidth: 0,
    height: "100%",
    padding: 5,
    borderRadius: 16,
    background: active
      ? "linear-gradient(180deg, rgba(28,47,68,0.86), rgba(13,24,39,0.92))"
      : "linear-gradient(180deg, rgba(248,251,255,0.18), rgba(226,236,246,0.12))",
    border: active
      ? "1px solid rgba(125,211,252,0.36)"
      : "1px solid rgba(226,232,240,0.26)",
    boxShadow: active
      ? "inset 0 0 0 1px rgba(125,211,252,0.18), 0 0 22px rgba(56,189,248,0.16)"
      : "inset 0 1px 0 rgba(255,255,255,0.16)",
  };
}

function buildFlushPaneShellStyle(active: boolean): React.CSSProperties {
  return {
    ...buildPaneShellStyle(active),
    padding: 0,
    overflow: "hidden",
  };
}

function buildCenterPaneShellStyle(active: boolean): React.CSSProperties {
  return {
    position: "relative",
    minWidth: 0,
    height: "100%",
    overflow: "hidden",
    borderRadius: 16,
    background: active ? "rgba(248,251,255,0.16)" : "transparent",
    boxShadow: active ? "0 0 22px rgba(56,189,248,0.12)" : "none",
  };
}

function replayTimestamp(
  detail: { completedAt?: number | null; updatedAt?: number | null } | null
): string {
  const value = detail?.completedAt ?? detail?.updatedAt ?? null;
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

export function SandboxMonitor({ projectId = null }: { projectId?: string | null }) {
  const { locale } = useI18n();

  const tasks = useTasksStore(s => s.tasks);
  const detailsById = useTasksStore(s => s.detailsById);
  const selectedTaskId = useTasksStore(s => s.selectedTaskId);
  const projectMissions = useProjectStore(state => state.missions);

  const logLines = useSandboxStore(s => s.logLines);
  const isStreaming = useSandboxStore(s => s.isStreaming);
  const focusedPane = useSandboxStore(s => s.focusedPane);
  const activeMissionId = useSandboxStore(s => s.activeMissionId);
  const latestScreenshot = useSandboxStore(s => s.latestScreenshot);
  const previousScreenshot = useSandboxStore(s => s.previousScreenshot);
  const setActiveMission = useSandboxStore(s => s.setActiveMission);
  const setFocusedPane = useSandboxStore(s => s.setFocusedPane);
  const [replayScreenshot, setReplayScreenshot] =
    useState<ScreenshotFrame | null>(null);
  const [replayLogLines, setReplayLogLines] = useState<LogLine[]>([]);
  const scopedTasks = useMemo(
    () =>
      resolveProjectTaskScope({
        projectId,
        projectMissions,
        tasks,
      }).tasks,
    [projectId, projectMissions, tasks]
  );

  const { displayMission, missionDetail } = useMemo(
    () => resolveSandboxMonitorMission(scopedTasks, detailsById, selectedTaskId),
    [detailsById, selectedTaskId, scopedTasks]
  );
  const replayScreenshotArtifact = useMemo(
    () => resolveReplayScreenshotArtifact(missionDetail),
    [missionDetail]
  );
  const replayTerminalArtifact = useMemo(
    () => resolveReplayTerminalArtifact(missionDetail),
    [missionDetail]
  );
  const liveDataMatchesMission =
    Boolean(displayMission?.id) && activeMissionId === displayMission?.id;
  const scopedLatestScreenshot = liveDataMatchesMission
    ? latestScreenshot
    : null;
  const scopedPreviousScreenshot = liveDataMatchesMission
    ? previousScreenshot
    : null;
  const scopedLogLines = liveDataMatchesMission ? logLines : [];
  const scopedStreaming = liveDataMatchesMission ? isStreaming : false;

  const { current: browserCurrentFrame, previous: browserPreviousFrame } =
    useMemo(
      () =>
        resolveBrowserPreviewFrames(
          scopedLatestScreenshot,
          scopedPreviousScreenshot,
          replayScreenshot
        ),
      [scopedLatestScreenshot, scopedPreviousScreenshot, replayScreenshot]
    );
  const terminalLogLines =
    scopedLogLines.length > 0 ? scopedLogLines : replayLogLines;
  const terminalStreaming = scopedStreaming || terminalLogLines.length > 0;

  useEffect(() => {
    const nextMissionId = displayMission?.id ?? null;
    if (activeMissionId !== nextMissionId) {
      setActiveMission(nextMissionId);
    }
  }, [activeMissionId, displayMission?.id, setActiveMission]);

  useEffect(() => {
    let cancelled = false;
    setReplayScreenshot(null);
    const previewUrl = replayScreenshotArtifact?.previewUrl;
    if (scopedLatestScreenshot || scopedPreviousScreenshot || !previewUrl) {
      return () => {
        cancelled = true;
      };
    }

    void fetch(previewUrl)
      .then(async response => {
        if (!response.ok) throw new Error("Screenshot replay unavailable");
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        if (cancelled) return;
        const imageData = dataUrl.includes(",")
          ? dataUrl.slice(dataUrl.indexOf(",") + 1)
          : dataUrl;
        setReplayScreenshot({
          stepIndex: 0,
          imageData,
          width: 0,
          height: 0,
          timestamp: replayTimestamp(missionDetail),
        });
      })
      .catch(() => {
        if (!cancelled) setReplayScreenshot(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    missionDetail?.completedAt,
    missionDetail?.updatedAt,
    replayScreenshotArtifact?.previewUrl,
    scopedLatestScreenshot,
    scopedPreviousScreenshot,
  ]);

  useEffect(() => {
    let cancelled = false;
    setReplayLogLines([]);
    const previewUrl = replayTerminalArtifact?.previewUrl;
    if (scopedLogLines.length > 0 || !previewUrl) {
      return () => {
        cancelled = true;
      };
    }

    void fetch(previewUrl)
      .then(async response => {
        if (!response.ok) throw new Error("Terminal replay unavailable");
        return response.text();
      })
      .then(text => {
        if (cancelled) return;
        const lines = text
          .split(/\r?\n/)
          .map(line => line.trimEnd())
          .filter(Boolean)
          .slice(-80)
          .map((line, index) => ({
            stepIndex: index,
            stream: line.includes("[stderr]") ? "stderr" : "stdout",
            data: line,
            timestamp: replayTimestamp(missionDetail),
          }) satisfies LogLine);
        setReplayLogLines(lines);
      })
      .catch(() => {
        if (!cancelled) setReplayLogLines([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    missionDetail?.completedAt,
    missionDetail?.updatedAt,
    replayTerminalArtifact?.previewUrl,
    scopedLogLines.length,
  ]);

  const taskStageLabel =
    missionDetail?.currentStageLabel ||
    displayMission?.currentStageLabel ||
    t(locale, "等待任务", "Awaiting mission");

  const terminalStatus = resolvePaneStatusLabel(
    locale,
    displayMission?.status,
    "terminal",
    terminalStreaming
  );
  const browserStatus = resolvePaneStatusLabel(
    locale,
    displayMission?.status,
    "browser",
    Boolean(browserCurrentFrame)
  );
  const browserContext = resolveBrowserContextLabel(
    locale,
    taskStageLabel,
    displayMission?.title
  );

  const closePaneFocus = () => setFocusedPane(null);
  const togglePane = (pane: SandboxFocusedPane) => {
    setFocusedPane(focusedPane === pane ? null : pane);
  };

  return (
    <>
      <group position={WALL_MONITOR_POSITION}>
        <Html
          transform
          position={[0, 0, DEVICE_PANEL_Z]}
          center
          distanceFactor={DEVICE_DISTANCE_FACTOR}
          style={{
            pointerEvents: "auto",
            width: DEVICE_WIDTH,
            height: DEVICE_HEIGHT,
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "hidden",
              borderRadius: 20,
              padding: 8,
              background:
                "linear-gradient(180deg, rgba(248,251,255,0.82), rgba(222,235,247,0.7))",
              border: "1px solid rgba(203,213,225,0.54)",
              boxShadow:
                "0 22px 46px rgba(86,105,126,0.2), inset 0 1px 0 rgba(255,255,255,0.65)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `radial-gradient(circle at top, ${FUTURE_OFFICE_COLORS.cyan}22, transparent 26%), radial-gradient(circle at bottom, ${FUTURE_OFFICE_COLORS.blue}18, transparent 30%)`,
                pointerEvents: "none",
              }}
            />

            <div
              style={{
                position: "relative",
                zIndex: 1,
                display: "grid",
                gridTemplateColumns: "1fr 1.55fr 1fr",
                gap: 8,
                width: "100%",
                height: "100%",
              }}
            >
              <div style={buildFlushPaneShellStyle(focusedPane === "terminal")}>
                <TerminalPreview
                  logLines={terminalLogLines}
                  isStreaming={terminalStreaming}
                  fullscreen={false}
                  onToggleFullscreen={closePaneFocus}
                  embedded
                  onActivate={() => togglePane("terminal")}
                  showFullscreenButton={false}
                  title={t(locale, "执行流", "Execution Feed")}
                  statusLabel={terminalStatus}
                  variant="wall"
                  headerMode="hidden"
                />
              </div>

              <div style={buildCenterPaneShellStyle(focusedPane === "task")}>
                <MissionWallTaskPanel
                  mission={displayMission}
                  detail={missionDetail}
                  onActivate={() => togglePane("task")}
                />
              </div>

              <div style={buildFlushPaneShellStyle(focusedPane === "browser")}>
                <ScreenshotPreview
                  current={browserCurrentFrame}
                  previous={browserPreviousFrame}
                  onClickZoom={() => togglePane("browser")}
                  embedded
                  fullscreen={false}
                  onToggleFullscreen={closePaneFocus}
                  showFullscreenButton={false}
                  title={t(locale, "浏览器回传", "Browser Live")}
                  statusLabel={browserStatus}
                  contextLabel={browserContext}
                  variant="wall"
                  headerMode="hidden"
                />
              </div>
            </div>
          </div>
        </Html>
      </group>

      {focusedPane === "terminal" ? (
        <Html fullscreen style={{ pointerEvents: "auto" }}>
          <TerminalPreview
            logLines={terminalLogLines}
            isStreaming={terminalStreaming}
            fullscreen
            onToggleFullscreen={closePaneFocus}
            title={t(locale, "执行流", "Execution Feed")}
            statusLabel={terminalStatus}
            variant="wall"
          />
        </Html>
      ) : null}

      {focusedPane === "task" ? (
        <Html fullscreen style={{ pointerEvents: "auto" }}>
          <MissionWallTaskPanel
            mission={displayMission}
            detail={missionDetail}
            fullscreen
            onClose={closePaneFocus}
          />
        </Html>
      ) : null}

      {focusedPane === "browser" ? (
        <Html fullscreen style={{ pointerEvents: "auto" }}>
          <ScreenshotPreview
            current={browserCurrentFrame}
            previous={browserPreviousFrame}
            onClickZoom={() => undefined}
            fullscreen
            onToggleFullscreen={closePaneFocus}
            title={t(locale, "浏览器回传", "Browser Live")}
            statusLabel={browserStatus}
            contextLabel={browserContext}
            variant="wall"
          />
        </Html>
      ) : null}
    </>
  );
}
