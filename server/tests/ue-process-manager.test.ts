import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import {
  UEProcessManager,
  buildUECommandArgs,
} from "../core/ue-process-manager.js";
import {
  buildUEProcessConfigFromEnv,
  UE_ENV_DEFAULTS,
  type UEProcessConfig,
} from "../../shared/ue/contracts.js";

// ── Helpers ─────────────────────────────────────────────────────

function makeConfig(overrides: Partial<UEProcessConfig> = {}): UEProcessConfig {
  return {
    ueEditorPath: "/opt/ue5/Engine/Binaries/Linux/UnrealEditor",
    projectPath: "/home/user/MyProject/MyProject.uproject",
    mapName: "/Game/Maps/MainLevel",
    resolution: { width: 1920, height: 1080 },
    pixelStreamingPort: 8888,
    ...overrides,
  };
}

/**
 * Create a fake ChildProcess-like EventEmitter with a mock stdout stream.
 */
function createFakeChild(): EventEmitter & {
  stdout: EventEmitter;
  pid: number;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.pid = 12345;
  child.killed = false;
  child.kill = vi.fn((signal?: string) => {
    child.killed = true;
    // Simulate async exit after kill
    setTimeout(() => child.emit("exit", 0, signal ?? null), 5);
    return true;
  });
  return child;
}

// ── Mock child_process.spawn ────────────────────────────────────

let latestFakeChild: ReturnType<typeof createFakeChild>;

vi.mock("node:child_process", () => ({
  spawn: vi.fn((..._args: unknown[]) => {
    latestFakeChild = createFakeChild();
    return latestFakeChild;
  }),
}));

// ── Tests ───────────────────────────────────────────────────────

describe("buildUECommandArgs", () => {
  it("produces the expected argument list", () => {
    const config = makeConfig();
    const args = buildUECommandArgs(config);

    expect(args).toContain(config.projectPath);
    expect(args).toContain(config.mapName);
    expect(args).toContain("-game");
    expect(args).toContain(`-PixelStreamingPort=${config.pixelStreamingPort}`);
    expect(args).toContain(`-ResX=${config.resolution.width}`);
    expect(args).toContain(`-ResY=${config.resolution.height}`);
    expect(args).toContain("-RenderOffScreen");
    expect(args).toContain("-Unattended");
    expect(args).toContain("-NoSplash");
    expect(args).toContain("-Log");
  });

  it("appends extra args when provided", () => {
    const config = makeConfig({ extraArgs: ["-Windowed", "-ForceRes"] });
    const args = buildUECommandArgs(config);

    expect(args).toContain("-Windowed");
    expect(args).toContain("-ForceRes");
  });

  it("does not include extra args when empty", () => {
    const config = makeConfig({ extraArgs: [] });
    const args = buildUECommandArgs(config);
    // Should still have the base args
    expect(args.length).toBeGreaterThanOrEqual(10);
  });
});

describe("buildUEProcessConfigFromEnv", () => {
  it("builds config from complete env vars", () => {
    const env = {
      UE_EDITOR_PATH: "/opt/ue5/UnrealEditor",
      UE_PROJECT_PATH: "/home/user/Project.uproject",
      UE_MAP_NAME: "/Game/Maps/Test",
      UE_RESOLUTION_WIDTH: "2560",
      UE_RESOLUTION_HEIGHT: "1440",
      UE_PIXEL_STREAMING_PORT: "9999",
      UE_EXTRA_ARGS: "-Windowed, -ForceRes",
    };

    const config = buildUEProcessConfigFromEnv(env);

    expect(config.ueEditorPath).toBe("/opt/ue5/UnrealEditor");
    expect(config.projectPath).toBe("/home/user/Project.uproject");
    expect(config.mapName).toBe("/Game/Maps/Test");
    expect(config.resolution).toEqual({ width: 2560, height: 1440 });
    expect(config.pixelStreamingPort).toBe(9999);
    expect(config.extraArgs).toEqual(["-Windowed", "-ForceRes"]);
  });

  it("uses defaults for optional env vars", () => {
    const env = {
      UE_EDITOR_PATH: "/opt/ue5/UnrealEditor",
      UE_PROJECT_PATH: "/home/user/Project.uproject",
      UE_MAP_NAME: "/Game/Maps/Test",
    };

    const config = buildUEProcessConfigFromEnv(env);

    expect(config.resolution.width).toBe(UE_ENV_DEFAULTS.UE_RESOLUTION_WIDTH);
    expect(config.resolution.height).toBe(UE_ENV_DEFAULTS.UE_RESOLUTION_HEIGHT);
    expect(config.pixelStreamingPort).toBe(UE_ENV_DEFAULTS.UE_PIXEL_STREAMING_PORT);
    expect(config.extraArgs).toBeUndefined();
  });

  it("throws when UE_EDITOR_PATH is missing", () => {
    expect(() =>
      buildUEProcessConfigFromEnv({
        UE_PROJECT_PATH: "/p",
        UE_MAP_NAME: "/m",
      }),
    ).toThrow("UE_EDITOR_PATH");
  });

  it("throws when UE_PROJECT_PATH is missing", () => {
    expect(() =>
      buildUEProcessConfigFromEnv({
        UE_EDITOR_PATH: "/e",
        UE_MAP_NAME: "/m",
      }),
    ).toThrow("UE_PROJECT_PATH");
  });

  it("throws when UE_MAP_NAME is missing", () => {
    expect(() =>
      buildUEProcessConfigFromEnv({
        UE_EDITOR_PATH: "/e",
        UE_PROJECT_PATH: "/p",
      }),
    ).toThrow("UE_MAP_NAME");
  });
});

describe("UEProcessManager", () => {
  let manager: UEProcessManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new UEProcessManager({ startupTimeoutMs: 5000, stopTimeoutMs: 3000 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Status & initial state ──────────────────────────────────

  it("starts in stopped state", () => {
    expect(manager.getStatus()).toBe("stopped");
  });

  it("returns 0 uptime when not running", () => {
    expect(manager.getUptime()).toBe(0);
  });

  it("returns null PID when not running", () => {
    expect(manager.getPid()).toBeNull();
  });

  // ── start() ─────────────────────────────────────────────────

  it("transitions to starting then running on successful start", async () => {
    const config = makeConfig();
    const startPromise = manager.start(config);

    expect(manager.getStatus()).toBe("starting");

    // Simulate UE5 producing stdout output (process is alive).
    latestFakeChild.stdout.emit("data", Buffer.from("LogInit: ready"));

    await startPromise;

    expect(manager.getStatus()).toBe("running");
    expect(manager.getPid()).toBe(12345);
  });

  it("is idempotent — second start() while running resolves immediately", async () => {
    const config = makeConfig();
    const startPromise = manager.start(config);
    latestFakeChild.stdout.emit("data", Buffer.from("ready"));
    await startPromise;

    // Second call should not spawn a new process.
    const { spawn } = await import("node:child_process");
    const callCountBefore = (spawn as ReturnType<typeof vi.fn>).mock.calls.length;

    await manager.start(config);

    const callCountAfter = (spawn as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);
    expect(manager.getStatus()).toBe("running");
  });

  it("is idempotent — second start() while starting resolves immediately", async () => {
    const config = makeConfig();
    const startPromise = manager.start(config);

    // Don't emit stdout yet — still in "starting" state.
    expect(manager.getStatus()).toBe("starting");

    const { spawn } = await import("node:child_process");
    const callCountBefore = (spawn as ReturnType<typeof vi.fn>).mock.calls.length;

    // Second call while starting.
    await manager.start(config);

    const callCountAfter = (spawn as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);

    // Clean up: let the first start complete.
    latestFakeChild.stdout.emit("data", Buffer.from("ready"));
    await startPromise;
  });

  // ── Crash detection ─────────────────────────────────────────

  it("transitions to crashed on spawn error", async () => {
    const config = makeConfig();
    const crashSpy = vi.fn();
    manager.onCrash(crashSpy);

    const startPromise = manager.start(config);

    // Simulate spawn error (e.g. ENOENT).
    latestFakeChild.emit("error", new Error("spawn ENOENT"));

    await expect(startPromise).rejects.toThrow("spawn ENOENT");
    expect(manager.getStatus()).toBe("crashed");
    expect(crashSpy).toHaveBeenCalledOnce();
    expect(crashSpy.mock.calls[0][0].message).toBe("spawn ENOENT");
  });

  it("transitions to crashed on unexpected exit while running", async () => {
    const config = makeConfig();
    const crashSpy = vi.fn();
    manager.onCrash(crashSpy);

    const startPromise = manager.start(config);
    latestFakeChild.stdout.emit("data", Buffer.from("ready"));
    await startPromise;

    expect(manager.getStatus()).toBe("running");

    // Simulate unexpected exit.
    latestFakeChild.emit("exit", 1, null);

    expect(manager.getStatus()).toBe("crashed");
    expect(crashSpy).toHaveBeenCalledOnce();
    expect(crashSpy.mock.calls[0][0].message).toContain("exited unexpectedly");
  });

  it("transitions to crashed on startup timeout", async () => {
    const config = makeConfig();
    const crashSpy = vi.fn();
    manager.onCrash(crashSpy);

    const startPromise = manager.start(config);

    expect(manager.getStatus()).toBe("starting");

    // Advance past the startup timeout without emitting stdout.
    vi.advanceTimersByTime(6000);

    await expect(startPromise).rejects.toThrow("did not become ready");
    expect(manager.getStatus()).toBe("crashed");
    expect(crashSpy).toHaveBeenCalledOnce();
  });

  it("swallows errors thrown by crash callbacks", async () => {
    const config = makeConfig();
    manager.onCrash(() => {
      throw new Error("callback boom");
    });
    const secondSpy = vi.fn();
    manager.onCrash(secondSpy);

    const startPromise = manager.start(config);
    latestFakeChild.emit("error", new Error("spawn ENOENT"));

    await expect(startPromise).rejects.toThrow("spawn ENOENT");
    // Second callback should still be called despite first throwing.
    expect(secondSpy).toHaveBeenCalledOnce();
  });

  // ── stop() ──────────────────────────────────────────────────

  it("stops a running process gracefully", async () => {
    const config = makeConfig();
    const startPromise = manager.start(config);
    latestFakeChild.stdout.emit("data", Buffer.from("ready"));
    await startPromise;

    const stopPromise = manager.stop();
    expect(manager.getStatus()).toBe("stopping");

    // The mock kill triggers an exit event after 5ms.
    vi.advanceTimersByTime(10);
    await stopPromise;

    expect(manager.getStatus()).toBe("stopped");
    expect(manager.getPid()).toBeNull();
    expect(latestFakeChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("stop() is a no-op when already stopped", async () => {
    expect(manager.getStatus()).toBe("stopped");
    await manager.stop();
    expect(manager.getStatus()).toBe("stopped");
  });

  it("stop() is a no-op when crashed", async () => {
    const config = makeConfig();
    const startPromise = manager.start(config);
    latestFakeChild.emit("error", new Error("spawn ENOENT"));
    await expect(startPromise).rejects.toThrow();

    expect(manager.getStatus()).toBe("crashed");
    await manager.stop();
    expect(manager.getStatus()).toBe("crashed");
  });

  // ── restart() ───────────────────────────────────────────────

  it("restarts a running process", async () => {
    const config = makeConfig();
    const startPromise = manager.start(config);
    latestFakeChild.stdout.emit("data", Buffer.from("ready"));
    await startPromise;

    const restartPromise = manager.restart();

    // stop phase: advance timers to let the kill/exit happen.
    vi.advanceTimersByTime(10);

    // After stop completes, a new spawn happens. Emit stdout for the new child.
    // We need to wait a tick for the new spawn to occur.
    await vi.advanceTimersByTimeAsync(10);
    latestFakeChild.stdout.emit("data", Buffer.from("ready again"));

    await restartPromise;

    expect(manager.getStatus()).toBe("running");
  });

  it("restart() throws when no previous config exists", async () => {
    await expect(manager.restart()).rejects.toThrow("no previous configuration");
  });

  // ── Uptime tracking ─────────────────────────────────────────

  it("tracks uptime while running", async () => {
    vi.useRealTimers();
    const mgr = new UEProcessManager({ startupTimeoutMs: 5000 });
    const config = makeConfig();
    const startPromise = mgr.start(config);
    latestFakeChild.stdout.emit("data", Buffer.from("ready"));
    await startPromise;

    // Small delay to accumulate uptime.
    await new Promise((r) => setTimeout(r, 50));
    expect(mgr.getUptime()).toBeGreaterThan(0);
  });
});
