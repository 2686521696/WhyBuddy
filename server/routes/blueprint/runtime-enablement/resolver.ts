/**
 * Autopilot capability runtime enablement resolver.
 *
 * Pure functions that compute the final enabled / disabled state for each of
 * the 5 `/autopilot` capability bridges based on:
 *
 *   1. `BUILD_TARGET === "test"` — hard-lock unset flags to `"false"` so the
 *      existing 5140+ test suite keeps running against simulated fallback.
 *   2. Explicit `process.env.BLUEPRINT_*_ENABLED` — developer override always
 *      wins, including inside test runs when the test opts in with `"true"`.
 *   3. `AUTOPILOT_REAL_RUNTIME` master switch — drives the new opt-out default
 *      for `dev:all` / production deployments.
 *
 * This module is referenced by:
 * - design.md §4.1 (`resolveBridgeEnablement` contract and algorithm)
 * - design.md §4.2 (`resolveAllBridgeEnablement` idempotent write-back)
 * - requirements 1.1-1.5 (master switch semantics, purity, idempotency)
 *
 * The module MUST remain a pure data-transformation layer: no `process.env`
 * reads, no logger calls, no side effects beyond the explicit env write-back
 * performed by `resolveAllBridgeEnablement` on the caller-supplied object.
 */

/**
 * The 5 bridge-level environment variable names that gate autopilot
 * capability bridges at their tier-1 early-exit check. See design.md §D1.
 */
export const BRIDGE_ENABLEMENT_KEYS = [
  "BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED",
  "BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED",
  "BLUEPRINT_ROLE_CAPABILITY_BRIDGE_ENABLED",
  "BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED",
  "BLUEPRINT_AGENT_CREW_STAGE_ACTIVATION_ENABLED",
  // `autopilot-role-autonomous-agent` spec Task 9.1：角色自主 Agent 的 Tier-1
  // 门禁 env flag。复用既有 resolver 算法（test 锁定、explicit 覆盖、master
  // switch 默认、unknown），不为 agent flag 引入任何特殊分支。
  "BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED",
] as const;

export type BridgeEnablementKey = (typeof BRIDGE_ENABLEMENT_KEYS)[number];

/**
 * Resolved enablement state for a single bridge-level flag.
 *
 * - `"true"`  → bridge tier-1 gate is open (attempt real execution).
 * - `"false"` → bridge tier-1 gate is closed (simulated fallback).
 * - `undefined` → legacy "unset" semantics: equivalent to `"false"` today,
 *   preserved so callers can distinguish "no decision" from "explicitly off".
 */
export type ResolvedBridgeEnablementValue = "true" | "false" | undefined;

/**
 * Input tuple for {@link resolveBridgeEnablement}. All fields are string | undefined
 * to mirror `process.env` access; callers MUST NOT pass `null`.
 */
export interface ResolveBridgeEnablementInput {
  /** Specific bridge-level env variable name. */
  envFlag: BridgeEnablementKey;
  /** Current value of `process.env[envFlag]`; `undefined` when unset. */
  explicitEnvValue: string | undefined;
  /** Current value of `process.env.AUTOPILOT_REAL_RUNTIME`. */
  masterSwitch: string | undefined;
  /** Current value of `process.env.BUILD_TARGET`. */
  buildTarget: string | undefined;
}

/**
 * Aggregated resolver result produced by {@link resolveAllBridgeEnablement}.
 * The five fields correspond one-to-one with the 5 bridges.
 */
export interface ResolvedBridgeEnablement {
  docker: ResolvedBridgeEnablementValue;
  mcpGithub: ResolvedBridgeEnablementValue;
  role: ResolvedBridgeEnablementValue;
  aigcNode: ResolvedBridgeEnablementValue;
  agentCrewStageActivation: ResolvedBridgeEnablementValue;
  /**
   * `autopilot-role-autonomous-agent` spec Task 9.4：roleAutonomousAgent 的
   * Tier-1 门禁解析结果。与前 5 条 bridge 完全对称——`AUTOPILOT_REAL_RUNTIME=true`
   * 时默认 `"true"`；`BUILD_TARGET=test` 强制 `"false"`；显式
   * `BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED` 始终覆盖以上两种默认。
   */
  roleAutonomousAgent: ResolvedBridgeEnablementValue;
}

/**
 * Pure function. Computes the final enabled / disabled decision for a single
 * bridge-level env flag without reading `process.env` or producing side effects.
 *
 * Algorithm (design.md §4.1):
 *
 *   Step 1 — Test environment hard-lock:
 *     If `buildTarget === "test"`, the function returns `"false"` unless the
 *     developer explicitly set `explicitEnvValue === "true"` (allowing tests
 *     to opt in via `vi.stubEnv`).
 *
 *   Step 2 — Developer explicit value wins:
 *     If `explicitEnvValue` is a non-empty string, that value is returned
 *     as-is, overriding the master switch. This preserves requirement 1.3.
 *
 *   Step 3 — Master switch:
 *     Returns `"true"` / `"false"` when the master switch holds those values.
 *
 *   Step 4 — Unknown:
 *     Returns `undefined`, which is equivalent to today's "flag unset" default.
 *
 * See requirements 1.1-1.4.
 */
export function resolveBridgeEnablement(
  input: ResolveBridgeEnablementInput,
): ResolvedBridgeEnablementValue {
  const { explicitEnvValue, masterSwitch, buildTarget } = input;

  // Step 1 — Test environment hard-lock.
  if (buildTarget === "test") {
    if (explicitEnvValue === "true") {
      return "true";
    }
    return "false";
  }

  // Step 2 — Developer explicit value wins.
  if (explicitEnvValue !== undefined && explicitEnvValue !== "") {
    return explicitEnvValue as ResolvedBridgeEnablementValue;
  }

  // Step 3 — Master switch.
  if (masterSwitch === "true") {
    return "true";
  }
  if (masterSwitch === "false") {
    return "false";
  }

  // Step 4 — Unknown state.
  return undefined;
}

/**
 * Startup-time helper that resolves all 5 bridge-level flags in one pass and
 * writes the decisions back into the supplied env object. Subsequent reads of
 * `process.env.BLUEPRINT_*_ENABLED` by existing bridge tier-1 gates will then
 * observe the new defaults without any bridge code needing to change.
 *
 * Idempotent (requirement 1.5): calling this function twice on the same env
 * object produces identical results and — after the first call — no further
 * writes. A write-back is only performed when the resolved value is non-`undefined`
 * AND differs from the current env value.
 *
 * See design.md §4.2 for the specification.
 */
export function resolveAllBridgeEnablement(
  env: NodeJS.ProcessEnv,
): ResolvedBridgeEnablement {
  const masterSwitch = env.AUTOPILOT_REAL_RUNTIME;
  const buildTarget = env.BUILD_TARGET;

  for (const key of BRIDGE_ENABLEMENT_KEYS) {
    const resolved = resolveBridgeEnablement({
      envFlag: key,
      explicitEnvValue: env[key],
      masterSwitch,
      buildTarget,
    });

    if (resolved !== undefined && env[key] !== resolved) {
      env[key] = resolved;
    }
  }

  return {
    docker: readResolvedValue(env, "BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED"),
    mcpGithub: readResolvedValue(env, "BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED"),
    role: readResolvedValue(env, "BLUEPRINT_ROLE_CAPABILITY_BRIDGE_ENABLED"),
    aigcNode: readResolvedValue(env, "BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED"),
    agentCrewStageActivation: readResolvedValue(
      env,
      "BLUEPRINT_AGENT_CREW_STAGE_ACTIVATION_ENABLED",
    ),
    roleAutonomousAgent: readResolvedValue(
      env,
      "BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED",
    ),
  };
}

/**
 * Normalizes a post-write-back env read to the `ResolvedBridgeEnablementValue`
 * type. Preserves `undefined` when the env key was never set, and coerces the
 * two canonical string values. Any other string — which can only occur when a
 * developer has explicitly set a non-canonical value — is passed through as-is
 * so the explicit-wins invariant (requirement 1.3) is not silently lost at the
 * aggregated view.
 */
function readResolvedValue(
  env: NodeJS.ProcessEnv,
  key: BridgeEnablementKey,
): ResolvedBridgeEnablementValue {
  const value = env[key];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value as ResolvedBridgeEnablementValue;
}

// ─── Trust Gate Enablement Resolver（blueprint-trust-enforcement-model §C1） ─

/**
 * Trust Gate default-resolution layer.
 *
 * Pure functions that resolve the enable / disable *default* of the 5 v4 Trust
 * Gates (`BLUEPRINT_CHECKS_LEDGER_ENABLED`,
 * `BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED`, `BLUEPRINT_COMPANION_ENABLED`,
 * `BLUEPRINT_TRACEABILITY_MATRIX_ENABLED`, `BLUEPRINT_PREVIEW_AUDIT_ENABLED`)
 * consistently with the `AUTOPILOT_REAL_RUNTIME` master switch, closing the
 * latent deployment hazard where a launch that bypasses `scripts/dev-all.mjs`
 * runs the 6 capability bridges as real while the trust loop stays silently off.
 *
 * This mirrors {@link resolveBridgeEnablement} one-to-one with two deliberate
 * divergences (see {@link resolveTrustGateEnablement}):
 *   1. The value space is always defined — `{"true","false"}`, never
 *      `undefined` — so every gate has a resolved default (Requirement 1.1).
 *   2. The bridge resolver's Step 3 (master-switch) + Step 4 (unknown) are
 *      collapsed into a single rule: the default is `"true"` only when the
 *      master switch equals exactly the case-sensitive string `"true"`; every
 *      other value resolves to `"false"` (Requirements 1.3, 1.4).
 *
 * This layer resolves *defaults only*. It NEVER changes the advisory /
 * non-blocking nature of any Trust Gate and NEVER introduces auto-blocking
 * (Requirement 1.9). The intentional App=advisory / Skill=hard-gate fork and
 * the Red Line that the App must never claim the Skill's "agent-can't-touch"
 * guarantee are documented in the Enforcement_Model_Decision_Record:
 * `.kiro/specs/blueprint-trust-enforcement-model/enforcement-model-decision-record.md`.
 */

/**
 * The 5 Trust Gate env flag names. Mirrors {@link BRIDGE_ENABLEMENT_KEYS}.
 * See design.md §C1 / Data Models.
 */
export const TRUST_GATE_ENABLEMENT_KEYS = [
  "BLUEPRINT_CHECKS_LEDGER_ENABLED",
  "BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED",
  "BLUEPRINT_COMPANION_ENABLED",
  "BLUEPRINT_TRACEABILITY_MATRIX_ENABLED",
  "BLUEPRINT_PREVIEW_AUDIT_ENABLED",
] as const;

export type TrustGateEnablementKey = (typeof TRUST_GATE_ENABLEMENT_KEYS)[number];

/**
 * Resolved enablement state for a single Trust Gate.
 *
 * Unlike {@link ResolvedBridgeEnablementValue}, a Trust Gate ALWAYS resolves to
 * a defined value within `{"true","false"}` (Requirement 1.1) — there is no
 * `undefined` "unset" state.
 */
export type ResolvedTrustGateValue = "true" | "false";

/**
 * Input tuple for {@link resolveTrustGateEnablement}. All fields are
 * `string | undefined` to mirror `process.env` access; callers MUST NOT pass
 * `null`.
 */
export interface ResolveTrustGateInput {
  /** Specific Trust Gate env variable name. */
  envFlag: TrustGateEnablementKey;
  /** Current value of `process.env[envFlag]`; `undefined` when unset. */
  explicitEnvValue: string | undefined;
  /** Current value of `process.env.AUTOPILOT_REAL_RUNTIME`. */
  masterSwitch: string | undefined;
  /** Current value of `process.env.BUILD_TARGET`. */
  buildTarget: string | undefined;
}

/**
 * Pure function. Computes the final enable / disable decision for a single
 * Trust Gate without reading `process.env` or producing side effects.
 *
 * Algorithm (design.md §C1 — verbatim mirror of {@link resolveBridgeEnablement}
 * with the two divergences noted on this module's section doc-comment):
 *
 *   Step 1 — Test environment hard-lock (Requirements 1.5, 1.6):
 *     If `buildTarget === "test"`, return `"true"` iff the trimmed explicit
 *     value is exactly `"true"`, else `"false"`. This test-lock takes
 *     precedence over the master switch.
 *
 *   Step 2 — Developer explicit value wins (Requirement 1.2):
 *     If the explicit value is present and non-empty after trimming whitespace,
 *     return it unchanged. A non-canonical explicit value (e.g. `"on"`) is
 *     returned as-is — explicit operator intent is never silently overridden.
 *     Whitespace-only explicit values are treated as "not set" and fall through.
 *
 *   Step 3 — Master-switch default (Requirement 1.3):
 *     Return `"true"` iff `masterSwitch === "true"` (case-sensitive).
 *
 *   Step 4 — Default (Requirement 1.4):
 *     Otherwise return `"false"` — covering unset, empty, and all non-canonical
 *     master-switch values (`"TRUE"`, `"1"`, `"yes"`, garbage).
 *
 * The output is always within `{"true","false"}` (Requirement 1.1). This layer
 * resolves defaults only and never introduces auto-blocking (Requirement 1.9).
 */
export function resolveTrustGateEnablement(
  input: ResolveTrustGateInput,
): ResolvedTrustGateValue {
  const { explicitEnvValue, masterSwitch, buildTarget } = input;

  const trimmedExplicit =
    explicitEnvValue === undefined ? undefined : explicitEnvValue.trim();

  // Step 1 — Test environment hard-lock (beats the master switch).
  if (buildTarget === "test") {
    return trimmedExplicit === "true" ? "true" : "false";
  }

  // Step 2 — Developer explicit value wins (whitespace-only treated as unset).
  if (trimmedExplicit !== undefined && trimmedExplicit !== "") {
    return trimmedExplicit as ResolvedTrustGateValue;
  }

  // Step 3 — Master-switch default (case-sensitive exact "true").
  if (masterSwitch === "true") {
    return "true";
  }

  // Step 4 — Default: every other value resolves to "false".
  return "false";
}

/**
 * Aggregated resolver result produced by {@link resolveAllTrustGateEnablement}.
 * The five fields correspond one-to-one with the 5 Trust Gates. Mirrors
 * {@link ResolvedBridgeEnablement}, but every field is always a defined value
 * within `{"true","false"}` (Requirement 1.1).
 */
export interface ResolvedTrustGates {
  checksLedger: ResolvedTrustGateValue;
  contentQuality: ResolvedTrustGateValue;
  companion: ResolvedTrustGateValue;
  traceabilityMatrix: ResolvedTrustGateValue;
  previewAudit: ResolvedTrustGateValue;
}

/**
 * Startup-time helper that resolves all 5 Trust Gate flags in one pass and
 * writes the resolved defaults back into the supplied env object. Subsequent
 * reads of `process.env.BLUEPRINT_*_ENABLED` by `buildBlueprintServiceContext`
 * and each gate service will then observe the new defaults without any gate
 * code needing to change.
 *
 * Idempotent (Requirement 1.7): a write-back is only performed when the
 * resolved value differs from the current env value (`env[key] !== resolved`).
 * Calling this function twice on the same env object produces identical results
 * and — after the first call — performs no further writes.
 *
 * This layer resolves *defaults only* and NEVER changes the advisory /
 * non-blocking nature of any Trust Gate (Requirement 1.9).
 *
 * See design.md §C2 for the specification.
 */
export function resolveAllTrustGateEnablement(
  env: NodeJS.ProcessEnv,
): ResolvedTrustGates {
  const masterSwitch = env.AUTOPILOT_REAL_RUNTIME;
  const buildTarget = env.BUILD_TARGET;

  for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
    const resolved = resolveTrustGateEnablement({
      envFlag: key,
      explicitEnvValue: env[key],
      masterSwitch,
      buildTarget,
    });

    if (env[key] !== resolved) {
      env[key] = resolved;
    }
  }

  return {
    checksLedger: readResolvedTrustGateValue(env, "BLUEPRINT_CHECKS_LEDGER_ENABLED"),
    contentQuality: readResolvedTrustGateValue(
      env,
      "BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED",
    ),
    companion: readResolvedTrustGateValue(env, "BLUEPRINT_COMPANION_ENABLED"),
    traceabilityMatrix: readResolvedTrustGateValue(
      env,
      "BLUEPRINT_TRACEABILITY_MATRIX_ENABLED",
    ),
    previewAudit: readResolvedTrustGateValue(env, "BLUEPRINT_PREVIEW_AUDIT_ENABLED"),
  };
}

/**
 * Normalizes a post-write-back env read to the `ResolvedTrustGateValue` type.
 * Mirrors {@link readResolvedValue} but never returns `undefined`: every Trust
 * Gate is written back with a defined default, so the only way a non-canonical
 * value can surface here is an explicit operator value preserved by Step 2 of
 * {@link resolveTrustGateEnablement} (explicit-wins). Such a value is passed
 * through as-is so the explicit-wins invariant (Requirement 1.2) is not silently
 * lost at the aggregated view, matching the bridge resolver's behavior.
 */
function readResolvedTrustGateValue(
  env: NodeJS.ProcessEnv,
  key: TrustGateEnablementKey,
): ResolvedTrustGateValue {
  return env[key] as ResolvedTrustGateValue;
}

// ─── Agent Runtime Config（spec Task 9.2 / 9.3） ──────────────────────────

/**
 * Agent budget 与 tool proxy 的运行期配置。
 *
 * 与 Tier-1 bridge enablement 的主要差异：
 * - **不受 `AUTOPILOT_REAL_RUNTIME` / `BUILD_TARGET` 影响**。本接口只反映
 *   "budget / proxy port 应该取什么数值"，而是否真正启动 Agent 仍由
 *   {@link ResolvedBridgeEnablement#roleAutonomousAgent} 决定。
 * - **只做解析，不做副作用**。resolver 层保持纯函数：不读 `process.env` 以外
 *   的 I/O、不写 logger、不写回 env。
 * - **越界值静默回退到默认**。非数字、空串、负数或 NaN 一律按默认值处理，
 *   避免运行期因一个错字导致 Agent 直接崩。
 *
 * 字段语义（引自 design.md §11 / requirements 10.2-10.5）：
 *
 * | 字段 | 默认 | env flag | 含义 |
 * | --- | --- | --- | --- |
 * | `maxIterations` | `20` | `BLUEPRINT_AGENT_MAX_ITERATIONS` | Agent ReAct loop 最大迭代数 |
 * | `maxTokens` | `100000` | `BLUEPRINT_AGENT_MAX_TOKENS` | Agent 单次任务最大 token 预算 |
 * | `timeoutMs` | `300000` (5 分钟) | `BLUEPRINT_AGENT_TIMEOUT_MS` | Agent 单次任务超时阈值 |
 * | `toolProxyPort` | `0`（随机） | `BLUEPRINT_AGENT_TOOL_PROXY_PORT` | ToolProxyServer HTTP 监听端口 |
 */
export interface AgentRuntimeConfig {
  maxIterations: number;
  maxTokens: number;
  timeoutMs: number;
  toolProxyPort: number;
}

const DEFAULT_AGENT_MAX_ITERATIONS = 20;
const DEFAULT_AGENT_MAX_TOKENS = 100_000;
const DEFAULT_AGENT_TIMEOUT_MS = 300_000;
const DEFAULT_AGENT_TOOL_PROXY_PORT = 0;

/**
 * 解析 Agent 运行期配置。
 *
 * Preconditions:
 * - `env` 是调用方提供的环境变量对象（通常为 `process.env`）；可传入子集用于
 *   测试。
 *
 * Postconditions:
 * - 返回对象每个字段均为非负有限整数。
 * - 对任一 env flag，若取值为 `undefined` / `""` / 非数字 / 负数 / `NaN`，
 *   则对应字段回退到默认值。
 * - `maxIterations` / `maxTokens` / `timeoutMs` 遵守下限（最小 1 / 1 / 1000）；
 *   不达下限时回退到默认。
 * - `toolProxyPort` 合法范围 `0-65535`；越界回退到默认 `0`（随机端口）。
 *
 * 纯函数：不读 env 对象以外的状态，不写 logger。
 */
export function resolveAgentRuntimeConfig(
  env: NodeJS.ProcessEnv,
): AgentRuntimeConfig {
  return {
    maxIterations: parsePositiveIntWithDefault(
      env.BLUEPRINT_AGENT_MAX_ITERATIONS,
      DEFAULT_AGENT_MAX_ITERATIONS,
      1,
    ),
    maxTokens: parsePositiveIntWithDefault(
      env.BLUEPRINT_AGENT_MAX_TOKENS,
      DEFAULT_AGENT_MAX_TOKENS,
      1,
    ),
    timeoutMs: parsePositiveIntWithDefault(
      env.BLUEPRINT_AGENT_TIMEOUT_MS,
      DEFAULT_AGENT_TIMEOUT_MS,
      1000,
    ),
    toolProxyPort: parsePortWithDefault(
      env.BLUEPRINT_AGENT_TOOL_PROXY_PORT,
      DEFAULT_AGENT_TOOL_PROXY_PORT,
    ),
  };
}

/**
 * 解析带最小下限的正整数 env flag。
 *
 * - `undefined` / `""` → `defaultValue`
 * - 非有限数 / 负数 / 小于 `minValue` → `defaultValue`
 * - 小数部分向下取整
 */
function parsePositiveIntWithDefault(
  value: string | undefined,
  defaultValue: number,
  minValue: number,
): number {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < minValue) return defaultValue;
  return parsed;
}

/**
 * 解析端口号 env flag。合法范围 `0-65535`（0 表示让 OS 随机分配）。
 *
 * - `undefined` / `""` → `defaultValue`
 * - 非有限数 / 负数 / 超过 65535 → `defaultValue`
 */
function parsePortWithDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65_535) {
    return defaultValue;
  }
  return parsed;
}

// ─── Brainstorm Runtime Config ────────────────────────────────────────────

/**
 * Brainstorm orchestrator runtime configuration.
 *
 * Resolves environment variables governing the multi-agent brainstorm system
 * including token budgets, tool call limits, timeouts, and the master enable
 * switch. Follows the same pure-function pattern as {@link AgentRuntimeConfig}.
 *
 * | Field | Default | Env Flag | Description |
 * | --- | --- | --- | --- |
 * | `maxTokens` | `50000` | `BRAINSTORM_MAX_TOKENS` | Max total token budget per brainstorm session |
 * | `maxToolCalls` | `20` | `BRAINSTORM_MAX_TOOL_CALLS` | Max tool invocations per session |
 * | `sessionTimeoutMs` | `120000` | `BRAINSTORM_SESSION_TIMEOUT_MS` | Force-termination timeout (ms) |
 * | `decisionGateTimeoutMs` | `5000` | `BRAINSTORM_DECISION_GATE_TIMEOUT_MS` | Decision gate LLM call timeout (ms) |
 * | `enabled` | `false` | `BLUEPRINT_BRAINSTORM_ENABLED` | Master enable switch |
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §Environment Variables
 * Requirements: 3.6, 4.5, 10.5
 */
export interface BrainstormRuntimeConfig {
  /** Maximum total token budget per brainstorm session. */
  maxTokens: number;
  /** Maximum tool invocations per session. */
  maxToolCalls: number;
  /** Force-termination timeout in milliseconds (120 seconds default). */
  sessionTimeoutMs: number;
  /** Decision gate LLM call timeout in milliseconds (5 seconds default). */
  decisionGateTimeoutMs: number;
  /** Whether the brainstorm orchestrator is enabled. */
  enabled: boolean;
}

const DEFAULT_BRAINSTORM_MAX_TOKENS = 50_000;
const DEFAULT_BRAINSTORM_MAX_TOOL_CALLS = 20;
const DEFAULT_BRAINSTORM_SESSION_TIMEOUT_MS = 120_000;
const DEFAULT_BRAINSTORM_DECISION_GATE_TIMEOUT_MS = 5_000;

/**
 * Resolves brainstorm orchestrator runtime configuration from environment variables.
 *
 * Preconditions:
 * - `env` is the caller-supplied environment variable object (typically `process.env`);
 *   a subset can be passed for testing.
 *
 * Postconditions:
 * - `maxTokens` ≥ 1 (minimum 1 token).
 * - `maxToolCalls` ≥ 1 (minimum 1 call).
 * - `sessionTimeoutMs` ≥ 1000 (minimum 1 second).
 * - `decisionGateTimeoutMs` ≥ 1000 (minimum 1 second).
 * - `enabled` is `true` only when `BLUEPRINT_BRAINSTORM_ENABLED === "true"`.
 * - Invalid or missing values silently fall back to defaults.
 *
 * Pure function: no I/O, no logger, no side effects.
 */
export function resolveBrainstormRuntimeConfig(
  env: NodeJS.ProcessEnv,
): BrainstormRuntimeConfig {
  return {
    maxTokens: parsePositiveIntWithDefault(
      env.BRAINSTORM_MAX_TOKENS,
      DEFAULT_BRAINSTORM_MAX_TOKENS,
      1,
    ),
    maxToolCalls: parsePositiveIntWithDefault(
      env.BRAINSTORM_MAX_TOOL_CALLS,
      DEFAULT_BRAINSTORM_MAX_TOOL_CALLS,
      1,
    ),
    sessionTimeoutMs: parsePositiveIntWithDefault(
      env.BRAINSTORM_SESSION_TIMEOUT_MS,
      DEFAULT_BRAINSTORM_SESSION_TIMEOUT_MS,
      1000,
    ),
    decisionGateTimeoutMs: parsePositiveIntWithDefault(
      env.BRAINSTORM_DECISION_GATE_TIMEOUT_MS,
      DEFAULT_BRAINSTORM_DECISION_GATE_TIMEOUT_MS,
      1000,
    ),
    enabled: env.BLUEPRINT_BRAINSTORM_ENABLED === "true",
  };
}
