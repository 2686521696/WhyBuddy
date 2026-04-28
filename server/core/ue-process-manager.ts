/**
 * UE5 Process Manager
 *
 * Manages the lifecycle of a local UE5 Pixel Streaming instance:
 * start, stop, restart, crash detection, and status reporting.
 *
 * State machine: stopped → starting → running → stopping → stopped
 *                                   ↘ crashed
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { UEProcessConfig, UEProcessStatus } from "../../shared/ue/contracts.js";

export interface UEProcessManagerOptions {
  /**
   * Maximum time (ms) to wait for the UE5 process to become "running"
   * after spawn. Defaults to 30 000.
   */
  startupTimeoutMs?: number;

  /**
   * Maximum time (ms) to wait for the process to exit after sending
   * a kill signal during stop(). Defaults to 10 000.
   */
  stopTimeoutMs?: number;
}

type CrashCallback = (error: Error) => void;

/**
 * Build the command-line arguments array for the UE5 editor process.
 */
export function buildUECommandArgs(config: UEProcessConfig): string[] {
  const args: string[] = [
    config.projectPath,
    config.mapName,
    "-game",
    `-PixelStreamingPort=${config.pixelStreamingPort}`,
    `-ResX=${config.resolution.width}`,
    `-ResY=${config.resolution.height}`,
    "-RenderOffScreen",
    "-Unattended",
    "-NoSplash",
    "-Log",
  ];

  if (config.extraArgs && config.extraArgs.length > 0) {
    args.push(...config.extraArgs);
  }

  return args;
}

export class UEProcessManager {
  private status: UEProcessStatus = "stopped";
  private process: ChildProcess | null = null;
  private config: UEProcessConfig | null = null;
  private crashCallbacks: CrashCallback[] = [];
  private startupTimeoutMs: number;
  private stopTimeoutMs: number;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private runningTimestamp: number | null = null;

  constructor(options: UEProcessManagerOptions = {}) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 10_000;
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Start the UE5 process. Idempotent: if already running or starting,
   * resolves immediately without spawning a second process.
   */
  async start(config: UEProcessConfig): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      return;
    }

    this.config = config;
    this.setStatus("starting");

    const args = buildUECommandArgs(config);

    return new Promise<void>((resolve, reject) => {
      try {
        const child = spawn(config.ueEditorPath, args, {
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        });

        this.process = child;

        // Startup timeout — if the process doesn't produce stdout within
        // the timeout window we consider it a failed start.
        this.startupTimer = setTimeout(() => {
          if (this.status === "starting") {
            const err = new Error(
              `UE5 process did not become ready within ${this.startupTimeoutMs}ms`,
            );
            this.handleCrash(err);
            reject(err);
          }
        }, this.startupTimeoutMs);

        // Treat first stdout data as "process is alive" → running.
        const onFirstData = () => {
          if (this.status === "starting") {
            this.clearStartupTimer();
            this.setStatus("running");
            this.runningTimestamp = Date.now();
            resolve();
          }
        };

        child.stdout?.once("data", onFirstData);

        // Handle spawn errors (e.g. executable not found).
        child.on("error", (err) => {
          this.clearStartupTimer();
          if (this.status === "starting") {
            this.setStatus("crashed");
            this.notifyCrash(err);
            reject(err);
          } else {
            this.handleCrash(err);
          }
        });

        // Handle unexpected exit.
        child.on("exit", (code, signal) => {
          this.clearStartupTimer();
          const wasRunning = this.status === "running" || this.status === "starting";

          if (this.status === "stopping") {
            // Expected exit during stop().
            this.process = null;
            this.setStatus("stopped");
            return;
          }

          this.process = null;

          if (wasRunning) {
            const err = new Error(
              `UE5 process exited unexpectedly (code=${code}, signal=${signal})`,
            );
            this.setStatus("crashed");
            this.notifyCrash(err);

            // If we were still in the start() promise, reject it.
            if (this.status === "crashed" && code !== null) {
              reject(err);
            }
          }
        });
      } catch (err) {
        this.setStatus("crashed");
        reject(err);
      }
    });
  }

  /**
   * Gracefully stop the UE5 process.
   */
  async stop(): Promise<void> {
    if (this.status === "stopped" || this.status === "crashed") {
      return;
    }

    if (!this.process) {
      this.setStatus("stopped");
      return;
    }

    this.setStatus("stopping");

    return new Promise<void>((resolve) => {
      const child = this.process!;

      const forceKillTimer = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, this.stopTimeoutMs);

      child.once("exit", () => {
        clearTimeout(forceKillTimer);
        this.process = null;
        this.setStatus("stopped");
        this.runningTimestamp = null;
        resolve();
      });

      // Send SIGTERM for graceful shutdown.
      child.kill("SIGTERM");
    });
  }

  /**
   * Restart the UE5 process using the last known configuration.
   */
  async restart(): Promise<void> {
    if (!this.config) {
      throw new Error("Cannot restart: no previous configuration available");
    }

    const config = this.config;
    await this.stop();
    await this.start(config);
  }

  /**
   * Get the current process status.
   */
  getStatus(): UEProcessStatus {
    return this.status;
  }

  /**
   * Get uptime in milliseconds since the process entered "running" state.
   * Returns 0 if not running.
   */
  getUptime(): number {
    if (this.status !== "running" || this.runningTimestamp === null) {
      return 0;
    }
    return Date.now() - this.runningTimestamp;
  }

  /**
   * Register a callback to be invoked when the UE5 process crashes.
   */
  onCrash(callback: CrashCallback): void {
    this.crashCallbacks.push(callback);
  }

  /**
   * Returns the PID of the managed child process, or null if not running.
   */
  getPid(): number | null {
    return this.process?.pid ?? null;
  }

  // ── Internal helpers ──────────────────────────────────────────

  private setStatus(next: UEProcessStatus): void {
    this.status = next;
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  private handleCrash(err: Error): void {
    this.process = null;
    this.setStatus("crashed");
    this.runningTimestamp = null;
    this.notifyCrash(err);
  }

  private notifyCrash(err: Error): void {
    for (const cb of this.crashCallbacks) {
      try {
        cb(err);
      } catch {
        // Swallow callback errors to avoid cascading failures.
      }
    }
  }
}
