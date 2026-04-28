/**
 * Shared contracts for UE5 local streaming runtime.
 *
 * Defines configuration, status, and health response types
 * used by both server-side process manager and client-side consumers.
 */

// ── UE Process Configuration ──────────────────────────────────────

export interface UEProcessConfig {
  /** Absolute path to the UE5 editor executable (e.g. UnrealEditor.exe). */
  ueEditorPath: string;
  /** Absolute path to the .uproject file. */
  projectPath: string;
  /** Map/level name to load on startup. */
  mapName: string;
  /** Render resolution. */
  resolution: { width: number; height: number };
  /** Pixel Streaming signaling port. */
  pixelStreamingPort: number;
  /** Additional UE5 command-line arguments. */
  extraArgs?: string[];
}

// ── UE Process Status ─────────────────────────────────────────────

export type UEProcessStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "crashed";

// ── UE Health Response ────────────────────────────────────────────

export interface UEHealthResponse {
  status: UEProcessStatus;
  fps: number;
  gpuUsage: number;
  vramUsage: number;
  connectedClients: number;
  /** Uptime in milliseconds since the UE5 process entered "running" state. */
  uptime: number;
}

// ── Environment Variable Defaults ─────────────────────────────────

export const UE_ENV_DEFAULTS = {
  UE_RESOLUTION_WIDTH: 1920,
  UE_RESOLUTION_HEIGHT: 1080,
  UE_PIXEL_STREAMING_PORT: 8888,
  UE_STARTUP_TIMEOUT_MS: 30_000,
} as const;

/**
 * Build a UEProcessConfig from environment variables.
 *
 * Required env vars: UE_EDITOR_PATH, UE_PROJECT_PATH, UE_MAP_NAME.
 * Optional env vars use defaults from UE_ENV_DEFAULTS.
 */
export function buildUEProcessConfigFromEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): UEProcessConfig {
  const ueEditorPath = env.UE_EDITOR_PATH;
  const projectPath = env.UE_PROJECT_PATH;
  const mapName = env.UE_MAP_NAME;

  if (!ueEditorPath) throw new Error("UE_EDITOR_PATH environment variable is required");
  if (!projectPath) throw new Error("UE_PROJECT_PATH environment variable is required");
  if (!mapName) throw new Error("UE_MAP_NAME environment variable is required");

  const width = env.UE_RESOLUTION_WIDTH
    ? parseInt(env.UE_RESOLUTION_WIDTH, 10)
    : UE_ENV_DEFAULTS.UE_RESOLUTION_WIDTH;
  const height = env.UE_RESOLUTION_HEIGHT
    ? parseInt(env.UE_RESOLUTION_HEIGHT, 10)
    : UE_ENV_DEFAULTS.UE_RESOLUTION_HEIGHT;
  const pixelStreamingPort = env.UE_PIXEL_STREAMING_PORT
    ? parseInt(env.UE_PIXEL_STREAMING_PORT, 10)
    : UE_ENV_DEFAULTS.UE_PIXEL_STREAMING_PORT;

  const extraArgs = env.UE_EXTRA_ARGS
    ? env.UE_EXTRA_ARGS.split(",").map((a) => a.trim()).filter(Boolean)
    : undefined;

  return {
    ueEditorPath,
    projectPath,
    mapName,
    resolution: { width, height },
    pixelStreamingPort,
    extraArgs,
  };
}

/**
 * Read the startup timeout from environment, falling back to the default.
 */
export function getUEStartupTimeoutMs(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): number {
  return env.UE_STARTUP_TIMEOUT_MS
    ? parseInt(env.UE_STARTUP_TIMEOUT_MS, 10)
    : UE_ENV_DEFAULTS.UE_STARTUP_TIMEOUT_MS;
}
