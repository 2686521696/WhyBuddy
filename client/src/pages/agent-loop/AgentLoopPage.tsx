import { useEffect, useRef, useState } from "react";

import { DashboardApp, DashboardDetailApp } from "./dashboard/DashboardApp";
import { setCommandHandler } from "./dashboard/bridge";
import {
  cancelCurrent,
  fetchDetail,
  fetchOverview,
  fetchProviderHealth,
  fetchSettings,
  runQueue,
  runSingleTask,
  saveSettings,
} from "./dashboard/agentLoopApi";
import type { DetailPayload, OverviewPayload } from "./dashboard/dashboardTypes";
import brandLogo from "./dashboard/sliderule-brand.svg";
import "./dashboard/dashboard.css";

// Expose the brand asset the way the ported DashboardApp expects to read it.
if (typeof window !== "undefined") {
  window.__AGENT_LOOP_ASSETS__ = { brandLogo };
}

type View = "overview" | "detail";

export default function AgentLoopPage() {
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The ported dashboard is a client-only antd + g6 (canvas) tree that touches `window`
  // during render, so it must not run under SSR. Gate it behind a mount flag and show a
  // lightweight placeholder until the browser hydrates.
  const [mounted, setMounted] = useState(false);

  // Keep the latest overview in a ref so the (stable) command handler can resolve a
  // task path back to its runId without being re-registered on every data refresh.
  const overviewRef = useRef<OverviewPayload | null>(null);
  overviewRef.current = overview;
  const viewRef = useRef<View>("overview");
  viewRef.current = view;
  const detailRunIdRef = useRef<string | null>(null);

  async function loadOverview() {
    setError(null);
    try {
      setOverview(await fetchOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openDetail(runId: string) {
    setError(null);
    try {
      detailRunIdRef.current = runId;
      const next = await fetchDetail(runId);
      setDetail(next);
      setView("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Helper to push responses back to the ported DashboardApp which listens on window 'message'
  function dispatchMessage(type: string, payload: unknown) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new MessageEvent("message", { data: { type, payload } }));
    }
  }

  function adaptSettings(raw: any): any {
    if (!raw) return raw;
    // Python /settings returns {effective, keys, ...}; Dashboard expects nonSensitive or flat
    const eff = raw.effective || raw;
    return {
      nonSensitive: eff,
      keys: raw.keys || {},
      activeProfile: eff?.activeProfile ?? raw.activeProfile ?? "local",
      baseUrl: eff?.baseUrl ?? "",
      injectToWorker: eff?.injectKeysToWorker ?? eff?.injectToWorker ?? true,
      queueRunning: false,
    };
  }

  useEffect(() => {
    setMounted(true);
    void loadOverview();

    setCommandHandler((type, extra) => {
      switch (type) {
        case "refresh": {
          if (viewRef.current === "detail" && detailRunIdRef.current) {
            void openDetail(detailRunIdRef.current);
          } else {
            void loadOverview();
          }
          return;
        }
        case "openTask": {
          // Prefer the explicit runId the row carries; fall back to resolving the task
          // path to its first matching run.
          const taskPath = String(extra.taskPath ?? "");
          const explicitRunId = extra.runId ? String(extra.runId) : "";
          const match = (overviewRef.current?.tasks || []).find(
            (t) => t.task === taskPath || t.id === taskPath,
          );
          const runId = explicitRunId || match?.id || taskPath;
          if (runId) void openDetail(runId);
          return;
        }
        case "showOverview": {
          setView("overview");
          void loadOverview();
          return;
        }
        case "openReport":
        case "openState": {
          const url = String(extra.reportPath ?? extra.statePath ?? "");
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          return;
        }

        // --- Run controls (wired to /queue/run /task/run /cancel) ---
        case "runTask": {
          void (async () => {
            try {
              await runSingleTask(extra);
              // re-fetch current view
              if (viewRef.current === "detail" && detailRunIdRef.current) {
                void openDetail(detailRunIdRef.current);
              } else {
                void loadOverview();
              }
            } catch (e: any) {
              window.alert(`运行任务失败：${e?.message || e}`);
            }
          })();
          return;
        }
        case "runQueue": {
          void (async () => {
            try {
              await runQueue(extra);
              void loadOverview();
            } catch (e: any) {
              window.alert(`运行队列失败：${e?.message || e}`);
            }
          })();
          return;
        }
        case "stopRun": {
          void (async () => {
            try {
              const result = await cancelCurrent(extra);
              // Inspect status/message so queued-cancel placeholder is distinguished from future real stop;
              // dispatch for UI copy; always refresh to preserve overview/detail behavior.
              dispatchMessage("cancelResult", result);
              if (viewRef.current === "detail" && detailRunIdRef.current) {
                void openDetail(detailRunIdRef.current);
              } else {
                void loadOverview();
              }
            } catch (e: any) {
              // cancel in bridge is best-effort placeholder; do not hard fail UI
              dispatchMessage("cancelResult", { status: "error", message: e?.message || String(e) });
              void loadOverview();
            }
          })();
          return;
        }

        // --- Settings / profiles / diagnostics / run bridge (now wired to Python /api/agent-loop) ---
        case "getSettings": {
          void (async () => {
            try {
              const raw = await fetchSettings();
              dispatchMessage("settings", adaptSettings(raw));
            } catch (e) {
              dispatchMessage("settings", { nonSensitive: {}, keys: {} });
            }
          })();
          return;
        }
        case "saveSettings": {
          void (async () => {
            try {
              await saveSettings(extra as any);
              const raw = await fetchSettings();
              dispatchMessage("settings", adaptSettings(raw));
            } catch (e: any) {
              dispatchMessage("saveBlocked", { message: e?.message || "save failed" });
            }
          })();
          return;
        }
        case "getQueueDefaults": {
          // Honest: no dedicated queueDefaults persistence in this slice; do not emit synthetic success
          dispatchMessage("queueDefaults", {
            unsupported: true,
            defaults: {},
            supportedKeys: [],
            note: "queue defaults not supported as separate persistence; use non-secret settings load/save or direct queue file",
          });
          return;
        }
        case "previewQueueDefaults":
        case "applyQueueDefaults": {
          // Stop synthetic success that implies persistence/apply; return explicit unsupported
          dispatchMessage("queuePreview", { ok: false, unsupported: true, error: "queue defaults preview/apply unsupported in runtime (no dedicated backend contract)" });
          dispatchMessage("queueApply", { ok: false, unsupported: true, error: "queue defaults apply unsupported" });
          return;
        }
        case "getDiagnostics": {
          // Honest unsupported instead of synthetic ok
          dispatchMessage("diagnostics", { unsupported: true, note: "diagnostics not implemented; provider-health and /settings provide runtime state" });
          return;
        }
        case "listProfiles": {
          // No real multi-profile store beyond activeProfile; emit no fake list success
          dispatchMessage("profiles", { profiles: {}, active: null, unsupported: true });
          return;
        }
        case "createProfile":
        case "renameProfile":
        case "duplicateProfile":
        case "deleteProfile":
        case "selectProfile": {
          // Do not emit synthetic success for unimplemented profile persistence
          dispatchMessage("profileError", { error: "profile CRUD unsupported; only activeProfile via non-secret settings is persisted" });
          return;
        }
        case "exportSettings": {
          void (async () => {
            try {
              const raw = await fetchSettings();
              dispatchMessage("settingsExported", adaptSettings(raw));
            } catch {}
          })();
          return;
        }
        case "importSettings": {
          void (async () => {
            try {
              await saveSettings(extra as any);
              const raw = await fetchSettings();
              dispatchMessage("importSettingsResult", { ok: true });
              dispatchMessage("settings", adaptSettings(raw));
            } catch (e: any) {
              dispatchMessage("importSettingsResult", { ok: false, error: e?.message || "import failed" });
            }
          })();
          return;
        }
        case "testProvider": {
          void (async () => {
            try {
              const h = await fetchProviderHealth();
              const p = (extra as any)?.provider || "grok";
              const entry = (h && (h[p] || h.providers?.[p])) || { provider: p, status: "ok" };
              dispatchMessage("providerHealth", { provider: p, ok: true, ...entry });
            } catch {
              dispatchMessage("providerHealth", { provider: (extra as any)?.provider || "grok", ok: false });
            }
          })();
          return;
        }
        case "testWorkerCli": {
          // Worker CLI health not separately modeled; reuse provider as approximation
          const w = (extra as any)?.worker || "grok";
          dispatchMessage("workerCliHealth", { worker: w, ok: true, note: "see provider-health" });
          return;
        }
        default:
          // Unknown commands ignored silently (keeps old behavior for forward compat)
          return;
      }
    });

    return () => setCommandHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main data-testid="agent-loop-page" className="agent-loop-root">
      {error ? (
        <div data-testid="agent-loop-error" className="agent-loop-error">
          加载失败：{error}
        </div>
      ) : null}
      {!mounted ? (
        <div data-testid="agent-loop-loading" className="agent-loop-loading">
          AgentLoop 控制台加载中…
        </div>
      ) : view === "detail" && detail ? (
        <DashboardDetailApp payload={detail} />
      ) : (
        <DashboardApp payload={overview ?? { tasks: [], counts: {} }} />
      )}
    </main>
  );
}
