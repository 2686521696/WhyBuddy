/**
 * UE5 Debug Service
 *
 * Manages debug mode state, collects performance metrics from the
 * UE5 process, and pushes them via a callback (e.g. Socket.IO).
 *
 * When debug mode is enabled, a periodic timer collects metrics
 * (FPS, GPU usage, VRAM, latency) and invokes the push callback.
 * Debug mode can be toggled at runtime without restarting UE5.
 */

import type { UEProcessManager } from "./ue-process-manager.js";
import type { SignalingProxy } from "./ue-signaling-proxy.js";
import type { UEHealthResponse } from "../../shared/ue/contracts.js";

// ── Types ───────────────────────────────────────────────────────

export interface UEDebugMetrics {
  fps: number;
  gpuUsage: number;
  vramUsage: number;
  latency: number;
  connectedClients: number;
  timestamp: number;
}

export interface UEDebugState {
  enabled: boolean;
  intervalMs: number;
}

export type MetricsPushCallback = (metrics: UEDebugMetrics) => void;

export interface UEDebugServiceOptions {
  /** Interval in ms between metric pushes. Defaults to 1000. */
  intervalMs?: number;
}

// ── UEDebugService ─────────────────────────────────────────────

export class UEDebugService {
  private processManager: UEProcessManager;
  private signalingProxy: SignalingProxy;
  private pushCallback: MetricsPushCallback | null = null;

  private debugEnabled = false;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    processManager: UEProcessManager,
    signalingProxy: SignalingProxy,
    options: UEDebugServiceOptions = {},
  ) {
    this.processManager = processManager;
    this.signalingProxy = signalingProxy;
    this.intervalMs = options.intervalMs ?? 1000;
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Register a callback that receives debug metrics on each tick.
   * Typically wired to Socket.IO emit or similar push mechanism.
   */
  onMetrics(callback: MetricsPushCallback): void {
    this.pushCallback = callback;
  }

  /**
   * Toggle debug mode on or off. Does not restart UE5.
   */
  toggle(enabled?: boolean): void {
    const next = enabled !== undefined ? enabled : !this.debugEnabled;

    if (next === this.debugEnabled) return;

    this.debugEnabled = next;

    if (this.debugEnabled) {
      this.startPushing();
    } else {
      this.stopPushing();
    }
  }

  /**
   * Returns whether debug mode is currently enabled.
   */
  isEnabled(): boolean {
    return this.debugEnabled;
  }

  /**
   * Returns the current debug state.
   */
  getDebugState(): UEDebugState {
    return {
      enabled: this.debugEnabled,
      intervalMs: this.intervalMs,
    };
  }

  /**
   * Returns the current UE health response by combining real data
   * from the process manager and signaling proxy with simulated
   * performance metrics.
   */
  getHealth(): UEHealthResponse {
    const status = this.processManager.getStatus();
    const uptime = this.processManager.getUptime();
    const connectedClients = this.signalingProxy.getConnectionCount();

    // Simulated metrics — in a real deployment these would come from
    // parsing UE5 stdout or a dedicated metrics endpoint.
    const metrics = this.collectMetrics();

    return {
      status,
      fps: metrics.fps,
      gpuUsage: metrics.gpuUsage,
      vramUsage: metrics.vramUsage,
      connectedClients,
      uptime,
    };
  }

  /**
   * Clean up timers. Call when shutting down.
   */
  dispose(): void {
    this.stopPushing();
    this.pushCallback = null;
  }

  // ── Internal ────────────────────────────────────────────────

  private startPushing(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      const metrics = this.collectMetrics();
      if (this.pushCallback) {
        this.pushCallback(metrics);
      }
    }, this.intervalMs);
  }

  private stopPushing(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Collect current metrics. Returns real data where available
   * and simulated placeholders for GPU metrics.
   *
   * In a real deployment, fps/gpuUsage/vramUsage would be populated
   * by parsing UE5 stdout or querying a dedicated metrics endpoint.
   */
  private collectMetrics(): UEDebugMetrics {
    const status = this.processManager.getStatus();
    const isRunning = status === "running";

    return {
      fps: isRunning ? 30 + Math.random() * 30 : 0,
      gpuUsage: isRunning ? 40 + Math.random() * 40 : 0,
      vramUsage: isRunning ? 2048 + Math.random() * 2048 : 0,
      latency: isRunning ? 5 + Math.random() * 15 : 0,
      connectedClients: this.signalingProxy.getConnectionCount(),
      timestamp: Date.now(),
    };
  }
}
