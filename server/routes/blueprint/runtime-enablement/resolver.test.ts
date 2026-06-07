import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BRIDGE_ENABLEMENT_KEYS,
  type BridgeEnablementKey,
  resolveAgentRuntimeConfig,
  resolveAllBridgeEnablement,
  resolveBridgeEnablement,
  TRUST_GATE_ENABLEMENT_KEYS,
  type TrustGateEnablementKey,
  resolveAllTrustGateEnablement,
  resolveTrustGateEnablement,
} from "./resolver.js";

import * as resolverModule from "./resolver.js";

/**
 * Co-located unit tests for the runtime-enablement resolver module.
 *
 * Covers:
 *   - `resolveBridgeEnablement` (pure function) — 10 scenarios per Task 2.1
 *   - `resolveAllBridgeEnablement` (idempotent write-back) — 3 scenarios per Task 2.2
 *
 * No property-based testing (requirement 8.5: example-based only).
 */

const DOCKER_KEY: BridgeEnablementKey =
  "BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED";

describe("resolveBridgeEnablement", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("buildTarget=test + explicit=undefined → 'false' (test hard-lock)", () => {
    const result = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "true",
      buildTarget: "test",
    });
    expect(result).toBe("false");
  });

  it("buildTarget=test + explicit='true' → 'true' (opt-in escape)", () => {
    const result = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: "true",
      masterSwitch: "false",
      buildTarget: "test",
    });
    expect(result).toBe("true");
  });

  it("buildTarget=test + explicit='false' → 'false'", () => {
    const result = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: "false",
      masterSwitch: "true",
      buildTarget: "test",
    });
    expect(result).toBe("false");
  });

  it("buildTarget=undefined + explicit='true' → 'true' (explicit wins over master switch 'false')", () => {
    const result = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: "true",
      masterSwitch: "false",
      buildTarget: undefined,
    });
    expect(result).toBe("true");
  });

  it("buildTarget=undefined + masterSwitch='true' + no explicit → 'true'", () => {
    const result = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "true",
      buildTarget: undefined,
    });
    expect(result).toBe("true");
  });

  it("buildTarget=undefined + masterSwitch='false' + no explicit → 'false'", () => {
    const result = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "false",
      buildTarget: undefined,
    });
    expect(result).toBe("false");
  });

  it("explicit='' is treated the same as undefined (empty string not explicit)", () => {
    const withEmpty = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: "",
      masterSwitch: "true",
      buildTarget: undefined,
    });
    const withUndefined = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "true",
      buildTarget: undefined,
    });
    expect(withEmpty).toBe(withUndefined);
    expect(withEmpty).toBe("true");
  });

  it("explicit='True' (non-canonical) returned as-is per design §4.1 step 2", () => {
    const result = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: "True",
      masterSwitch: "false",
      buildTarget: undefined,
    });
    // Passed through verbatim; explicit-wins invariant not silently normalized.
    expect(result).toBe("True");
  });

  it("same input called twice returns identical result (determinism)", () => {
    const input = {
      envFlag: DOCKER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "true" as const,
      buildTarget: undefined,
    };
    const first = resolveBridgeEnablement(input);
    const second = resolveBridgeEnablement(input);
    expect(first).toBe(second);
    expect(first).toBe("true");
  });

  it("does not read from process.env — result follows parameters, not globals", () => {
    // Pollute process.env with values that would flip the decision if the
    // function were reading from it directly. Parameters explicitly contradict
    // process.env.
    vi.stubEnv("BUILD_TARGET", "test");
    vi.stubEnv("AUTOPILOT_REAL_RUNTIME", "false");
    vi.stubEnv(DOCKER_KEY, "false");

    const result = resolveBridgeEnablement({
      envFlag: DOCKER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "true",
      buildTarget: undefined,
    });

    // If the resolver had read process.env, it would have seen BUILD_TARGET=test
    // and returned "false". Since it follows the (buildTarget=undefined,
    // masterSwitch="true") parameters, the expected result is "true".
    expect(result).toBe("true");
  });
});

describe("resolveAllBridgeEnablement", () => {
  it("is idempotent: second call on the same env object produces no additional writes", () => {
    const env: NodeJS.ProcessEnv = {
      AUTOPILOT_REAL_RUNTIME: "true",
    };

    const firstSnapshot = resolveAllBridgeEnablement(env);
    // Capture env state after the first call (contains all resolved values).
    const envAfterFirst = { ...env };

    const secondSnapshot = resolveAllBridgeEnablement(env);
    const envAfterSecond = { ...env };

    // Second call must not mutate env further.
    expect(envAfterSecond).toEqual(envAfterFirst);
    // Resolved snapshots must be deeply equal across calls.
    expect(secondSnapshot).toEqual(firstSnapshot);

    // And the resolved values must reflect the master switch "true".
    for (const key of BRIDGE_ENABLEMENT_KEYS) {
      expect(env[key]).toBe("true");
    }
  });

  it("write-back consistency: returned snapshot values match post-write env state", () => {
    const env: NodeJS.ProcessEnv = {
      AUTOPILOT_REAL_RUNTIME: "true",
      BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED: "false", // explicit override
    };

    const snapshot = resolveAllBridgeEnablement(env);

    // The aggregated snapshot and the env after write-back are consistent.
    expect(snapshot.docker).toBe(env.BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED);
    expect(snapshot.mcpGithub).toBe(
      env.BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED,
    );
    expect(snapshot.role).toBe(env.BLUEPRINT_ROLE_CAPABILITY_BRIDGE_ENABLED);
    expect(snapshot.aigcNode).toBe(
      env.BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED,
    );
    expect(snapshot.agentCrewStageActivation).toBe(
      env.BLUEPRINT_AGENT_CREW_STAGE_ACTIVATION_ENABLED,
    );
    expect(snapshot.roleAutonomousAgent).toBe(
      env.BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED,
    );

    // Specifically confirm explicit-wins for mcpGithub.
    expect(snapshot.mcpGithub).toBe("false");
    // And master-switch propagation for the remaining flags.
    expect(snapshot.docker).toBe("true");
    expect(snapshot.role).toBe("true");
    expect(snapshot.aigcNode).toBe("true");
    expect(snapshot.agentCrewStageActivation).toBe("true");
    expect(snapshot.roleAutonomousAgent).toBe("true");
  });

  it("frozen env whose resolved values already match current values does not throw (no writes needed)", () => {
    // BUILD_TARGET=test and no explicits → every bridge resolves to "false".
    // Pre-populate the env with the resolved values so that the internal
    // `env[key] !== resolved` guard short-circuits and no write is attempted.
    const env: NodeJS.ProcessEnv = Object.freeze({
      BUILD_TARGET: "test",
      BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED: "false",
      BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED: "false",
      BLUEPRINT_ROLE_CAPABILITY_BRIDGE_ENABLED: "false",
      BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED: "false",
      BLUEPRINT_AGENT_CREW_STAGE_ACTIVATION_ENABLED: "false",
      BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED: "false",
    }) as NodeJS.ProcessEnv;

    let snapshot: ReturnType<typeof resolveAllBridgeEnablement> | undefined;
    expect(() => {
      snapshot = resolveAllBridgeEnablement(env);
    }).not.toThrow();

    expect(snapshot).toEqual({
      docker: "false",
      mcpGithub: "false",
      role: "false",
      aigcNode: "false",
      agentCrewStageActivation: "false",
      roleAutonomousAgent: "false",
    });
  });
});

/**
 * `autopilot-role-autonomous-agent` spec Task 9.6：BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED
 * 复用既有 resolver 算法（test 锁定、explicit 覆盖、master switch 默认、
 * unknown），不为该 flag 引入特殊分支。测试只验证关键 interaction 矩阵。
 */
describe("resolveAllBridgeEnablement — roleAutonomousAgent flag", () => {
  const AGENT_KEY: BridgeEnablementKey =
    "BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED";

  it("BUILD_TARGET=test + no explicit → agent flag forced to 'false'", () => {
    const env: NodeJS.ProcessEnv = {
      BUILD_TARGET: "test",
    };
    const snapshot = resolveAllBridgeEnablement(env);
    expect(snapshot.roleAutonomousAgent).toBe("false");
    expect(env[AGENT_KEY]).toBe("false");
  });

  it("AUTOPILOT_REAL_RUNTIME=true + no explicit + no test → agent flag defaults to 'true'", () => {
    const env: NodeJS.ProcessEnv = {
      AUTOPILOT_REAL_RUNTIME: "true",
    };
    const snapshot = resolveAllBridgeEnablement(env);
    expect(snapshot.roleAutonomousAgent).toBe("true");
    expect(env[AGENT_KEY]).toBe("true");
  });

  it("AUTOPILOT_REAL_RUNTIME=true + explicit BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED=false → 'false'", () => {
    const env: NodeJS.ProcessEnv = {
      AUTOPILOT_REAL_RUNTIME: "true",
      BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED: "false",
    };
    const snapshot = resolveAllBridgeEnablement(env);
    expect(snapshot.roleAutonomousAgent).toBe("false");
    expect(env[AGENT_KEY]).toBe("false");
  });

  it("BUILD_TARGET=test + explicit BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED=true → 'true' (test opt-in escape)", () => {
    const env: NodeJS.ProcessEnv = {
      BUILD_TARGET: "test",
      BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED: "true",
    };
    const snapshot = resolveAllBridgeEnablement(env);
    expect(snapshot.roleAutonomousAgent).toBe("true");
    expect(env[AGENT_KEY]).toBe("true");
  });

  it("single-flag resolver returns expected value for the agent key", () => {
    const result = resolveBridgeEnablement({
      envFlag: AGENT_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "true",
      buildTarget: undefined,
    });
    expect(result).toBe("true");
  });

  it("BRIDGE_ENABLEMENT_KEYS includes the new agent flag", () => {
    expect(BRIDGE_ENABLEMENT_KEYS).toContain(AGENT_KEY);
  });
});

/**
 * `autopilot-role-autonomous-agent` spec Task 9.6：resolveAgentRuntimeConfig
 * 验证 budget / tool proxy 的 env parsing + fallback 行为。
 *
 * 测试原则：
 * - resolver 层保持纯函数；不读 `process.env`、不写 logger，测试直接传入
 *   构造好的 env 子集。
 * - 覆盖正向路径（默认值 / 合法 env 覆盖）与负向路径（非数字 / 空串 / 负数 /
 *   超端口范围 / 小于下限）。
 */
describe("resolveAgentRuntimeConfig", () => {
  it("returns defaults when no env flags are set", () => {
    const cfg = resolveAgentRuntimeConfig({});
    expect(cfg).toEqual({
      maxIterations: 20,
      maxTokens: 100_000,
      timeoutMs: 300_000,
      toolProxyPort: 0,
    });
  });

  it("parses valid numeric env overrides into the config", () => {
    const cfg = resolveAgentRuntimeConfig({
      BLUEPRINT_AGENT_MAX_ITERATIONS: "50",
      BLUEPRINT_AGENT_MAX_TOKENS: "250000",
      BLUEPRINT_AGENT_TIMEOUT_MS: "600000",
      BLUEPRINT_AGENT_TOOL_PROXY_PORT: "7890",
    });
    expect(cfg).toEqual({
      maxIterations: 50,
      maxTokens: 250_000,
      timeoutMs: 600_000,
      toolProxyPort: 7890,
    });
  });

  it("falls back to defaults for non-numeric strings", () => {
    const cfg = resolveAgentRuntimeConfig({
      BLUEPRINT_AGENT_MAX_ITERATIONS: "not-a-number",
      BLUEPRINT_AGENT_MAX_TOKENS: "NaN",
      BLUEPRINT_AGENT_TIMEOUT_MS: "",
      BLUEPRINT_AGENT_TOOL_PROXY_PORT: "abc",
    });
    expect(cfg.maxIterations).toBe(20);
    expect(cfg.maxTokens).toBe(100_000);
    expect(cfg.timeoutMs).toBe(300_000);
    expect(cfg.toolProxyPort).toBe(0);
  });

  it("falls back to defaults for negative values", () => {
    const cfg = resolveAgentRuntimeConfig({
      BLUEPRINT_AGENT_MAX_ITERATIONS: "-5",
      BLUEPRINT_AGENT_MAX_TOKENS: "-100",
      BLUEPRINT_AGENT_TIMEOUT_MS: "-1000",
      BLUEPRINT_AGENT_TOOL_PROXY_PORT: "-1",
    });
    expect(cfg.maxIterations).toBe(20);
    expect(cfg.maxTokens).toBe(100_000);
    expect(cfg.timeoutMs).toBe(300_000);
    expect(cfg.toolProxyPort).toBe(0);
  });

  it("enforces minimum bounds: maxIterations >= 1, maxTokens >= 1, timeoutMs >= 1000", () => {
    const cfg = resolveAgentRuntimeConfig({
      BLUEPRINT_AGENT_MAX_ITERATIONS: "0",
      BLUEPRINT_AGENT_MAX_TOKENS: "0",
      BLUEPRINT_AGENT_TIMEOUT_MS: "999",
    });
    expect(cfg.maxIterations).toBe(20);
    expect(cfg.maxTokens).toBe(100_000);
    expect(cfg.timeoutMs).toBe(300_000);
  });

  it("falls back to default when toolProxyPort is out of range (> 65535)", () => {
    const cfg = resolveAgentRuntimeConfig({
      BLUEPRINT_AGENT_TOOL_PROXY_PORT: "70000",
    });
    expect(cfg.toolProxyPort).toBe(0);
  });

  it("accepts toolProxyPort=0 explicitly (random-port sentinel)", () => {
    const cfg = resolveAgentRuntimeConfig({
      BLUEPRINT_AGENT_TOOL_PROXY_PORT: "0",
    });
    expect(cfg.toolProxyPort).toBe(0);
  });

  it("accepts toolProxyPort at the upper boundary (65535)", () => {
    const cfg = resolveAgentRuntimeConfig({
      BLUEPRINT_AGENT_TOOL_PROXY_PORT: "65535",
    });
    expect(cfg.toolProxyPort).toBe(65_535);
  });

  it("is independent of AUTOPILOT_REAL_RUNTIME and BUILD_TARGET", () => {
    // Agent budget config 不受 Tier-1 门禁 env 影响：即便 BUILD_TARGET=test
    // 或 master switch off，budget 解析仍应返回同一组值。
    const cfgA = resolveAgentRuntimeConfig({
      BUILD_TARGET: "test",
      AUTOPILOT_REAL_RUNTIME: "false",
      BLUEPRINT_AGENT_MAX_ITERATIONS: "15",
    });
    const cfgB = resolveAgentRuntimeConfig({
      BUILD_TARGET: "production",
      AUTOPILOT_REAL_RUNTIME: "true",
      BLUEPRINT_AGENT_MAX_ITERATIONS: "15",
    });
    expect(cfgA.maxIterations).toBe(15);
    expect(cfgB.maxIterations).toBe(15);
  });
});

/**
 * `blueprint-trust-enforcement-model` spec Task 1.5：example-based unit tests
 * for the Trust Gate resolver branches and the Requirement 1.9 defaults-only
 * structural guarantee.
 *
 * These are readable precedence docs — one concrete example per ladder branch:
 *   - Step 1a test opt-in  (BUILD_TARGET=test + explicit "true")   → "true"
 *   - Step 1b test lock     (BUILD_TARGET=test, otherwise)          → "false"
 *   - Step 2  explicit-wins (outside test, explicit present)        → value
 *   - Step 3  master-on     (master exactly "true", no explicit)    → "true"
 *   - Step 4  default       (non-canonical / unset master)          → "false"
 *
 * Property-based coverage lives in the sibling
 * `trust-gate-resolver.property.test.ts`; this file documents the branches by
 * example and asserts the pure, defaults-only shape of the API (Requirement 1.9).
 */

const CHECKS_LEDGER_KEY: TrustGateEnablementKey =
  "BLUEPRINT_CHECKS_LEDGER_ENABLED";

describe("resolveTrustGateEnablement — ladder branches (example-based)", () => {
  it("Step 1a — BUILD_TARGET=test + explicit 'true' → 'true' (test opt-in escape, beats master 'false')", () => {
    const result = resolveTrustGateEnablement({
      envFlag: CHECKS_LEDGER_KEY,
      explicitEnvValue: "true",
      masterSwitch: "false",
      buildTarget: "test",
    });
    expect(result).toBe("true");
  });

  it("Step 1b — BUILD_TARGET=test + no explicit → 'false' (test hard-lock beats master 'true')", () => {
    const result = resolveTrustGateEnablement({
      envFlag: CHECKS_LEDGER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "true",
      buildTarget: "test",
    });
    expect(result).toBe("false");
  });

  it("Step 1b — BUILD_TARGET=test + explicit 'false' → 'false' (test lock)", () => {
    const result = resolveTrustGateEnablement({
      envFlag: CHECKS_LEDGER_KEY,
      explicitEnvValue: "false",
      masterSwitch: "true",
      buildTarget: "test",
    });
    expect(result).toBe("false");
  });

  it("Step 2 — explicit-wins outside test: explicit 'true' overrides master 'false'", () => {
    const result = resolveTrustGateEnablement({
      envFlag: CHECKS_LEDGER_KEY,
      explicitEnvValue: "true",
      masterSwitch: "false",
      buildTarget: undefined,
    });
    expect(result).toBe("true");
  });

  it("Step 2 — explicit-wins outside test: explicit 'false' overrides master 'true'", () => {
    const result = resolveTrustGateEnablement({
      envFlag: CHECKS_LEDGER_KEY,
      explicitEnvValue: "false",
      masterSwitch: "true",
      buildTarget: undefined,
    });
    expect(result).toBe("false");
  });

  it("Step 2 — whitespace-only explicit value is treated as 'not set' and falls through to master default", () => {
    const result = resolveTrustGateEnablement({
      envFlag: CHECKS_LEDGER_KEY,
      explicitEnvValue: "   ",
      masterSwitch: "true",
      buildTarget: undefined,
    });
    expect(result).toBe("true");
  });

  it("Step 3 — master-on default: master exactly 'true' + no explicit → 'true'", () => {
    const result = resolveTrustGateEnablement({
      envFlag: CHECKS_LEDGER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "true",
      buildTarget: undefined,
    });
    expect(result).toBe("true");
  });

  it("Step 4 — non-canonical master 'TRUE' (case-sensitive) + no explicit → 'false'", () => {
    const result = resolveTrustGateEnablement({
      envFlag: CHECKS_LEDGER_KEY,
      explicitEnvValue: undefined,
      masterSwitch: "TRUE",
      buildTarget: undefined,
    });
    expect(result).toBe("false");
  });

  it("Step 4 — non-canonical master lookalikes ('1', 'yes', 'on') + unset → 'false'", () => {
    for (const master of ["1", "yes", "on", "", undefined]) {
      const result = resolveTrustGateEnablement({
        envFlag: CHECKS_LEDGER_KEY,
        explicitEnvValue: undefined,
        masterSwitch: master,
        buildTarget: undefined,
      });
      expect(result).toBe("false");
    }
  });
});

describe("resolveAllTrustGateEnablement — aggregate ladder branches (example-based)", () => {
  it("master 'true' + no explicits + not test → all 5 gates resolve 'true' (dev:all default shape)", () => {
    const env: NodeJS.ProcessEnv = { AUTOPILOT_REAL_RUNTIME: "true" };
    const snapshot = resolveAllTrustGateEnablement(env);

    expect(snapshot).toEqual({
      checksLedger: "true",
      contentQuality: "true",
      companion: "true",
      traceabilityMatrix: "true",
      previewAudit: "true",
    });
    for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
      expect(env[key]).toBe("true");
    }
  });

  it("BUILD_TARGET=test + no explicits → all 5 gates resolve 'false' (test hard-lock)", () => {
    const env: NodeJS.ProcessEnv = { BUILD_TARGET: "test" };
    const snapshot = resolveAllTrustGateEnablement(env);

    expect(snapshot).toEqual({
      checksLedger: "false",
      contentQuality: "false",
      companion: "false",
      traceabilityMatrix: "false",
      previewAudit: "false",
    });
    for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
      expect(env[key]).toBe("false");
    }
  });

  it("non-canonical master 'TRUE' + no explicits → all 5 gates resolve 'false' (latent-hazard default)", () => {
    const env: NodeJS.ProcessEnv = { AUTOPILOT_REAL_RUNTIME: "TRUE" };
    const snapshot = resolveAllTrustGateEnablement(env);

    expect(snapshot).toEqual({
      checksLedger: "false",
      contentQuality: "false",
      companion: "false",
      traceabilityMatrix: "false",
      previewAudit: "false",
    });
  });

  it("explicit per-gate value wins over master default outside test", () => {
    const env: NodeJS.ProcessEnv = {
      AUTOPILOT_REAL_RUNTIME: "true",
      BLUEPRINT_COMPANION_ENABLED: "false", // explicit opt-out
    };
    const snapshot = resolveAllTrustGateEnablement(env);

    expect(snapshot.companion).toBe("false");
    expect(snapshot.checksLedger).toBe("true");
    expect(snapshot.contentQuality).toBe("true");
    expect(snapshot.traceabilityMatrix).toBe("true");
    expect(snapshot.previewAudit).toBe("true");
  });
});

/**
 * Requirement 1.9 (structural): the new Trust Gate resolver API exposes only
 * pure resolution returning the `ResolvedTrustGateValue` union. There is no
 * blocking / throwing API — the resolver decides a `"true" | "false"` *default*
 * and never auto-blocks, confirming defaults-only resolution.
 */
describe("Trust Gate resolver — defaults-only structural guarantee (Requirement 1.9)", () => {
  const ADVERSARIAL_VALUES: Array<string | undefined> = [
    "true",
    "false",
    "",
    "   ",
    "TRUE",
    "True",
    "1",
    "yes",
    "on",
    "block",
    "🚫",
    undefined,
  ];

  // The "not set" forms that always trigger *default* resolution: the
  // defaults-only guarantee (Requirement 1.9) is about the resolved default,
  // not about an explicit operator value (which Step 2 passes through as-is).
  const UNSET_EXPLICIT_VALUES: Array<string | undefined> = [
    undefined,
    "",
    "   ",
  ];

  it("default resolution yields only the {'true','false'} union for every key and adversarial master/build input", () => {
    for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
      for (const explicit of UNSET_EXPLICIT_VALUES) {
        for (const master of ADVERSARIAL_VALUES) {
          for (const buildTarget of [undefined, "test", "production"]) {
            const result = resolveTrustGateEnablement({
              envFlag: key,
              explicitEnvValue: explicit,
              masterSwitch: master,
              buildTarget,
            });
            // Defaults-only: the resolver yields a binary enable/disable
            // default — never a blocking verdict or any other token.
            expect(result === "true" || result === "false").toBe(true);
          }
        }
      }
    }
  });

  it("never throws on degenerate inputs — there is no throwing/blocking API surface", () => {
    expect(() =>
      resolveTrustGateEnablement({
        envFlag: CHECKS_LEDGER_KEY,
        explicitEnvValue: undefined,
        masterSwitch: undefined,
        buildTarget: undefined,
      }),
    ).not.toThrow();

    expect(() => resolveAllTrustGateEnablement({})).not.toThrow();
  });

  it("exposes only pure resolution helpers — no exported name implies blocking/enforcement", () => {
    // The Trust Gate surface is exactly the pure resolver + aggregate + the key
    // table. No exported member advertises a blocking / enforcing / throwing API.
    const trustExports = Object.keys(resolverModule).filter((name) =>
      /trust_?gate/i.test(name),
    );
    expect(trustExports).toEqual(
      expect.arrayContaining([
        "TRUST_GATE_ENABLEMENT_KEYS",
        "resolveTrustGateEnablement",
        "resolveAllTrustGateEnablement",
      ]),
    );

    const forbidden = /block|enforce|throw|reject|deny|abort/i;
    for (const name of trustExports) {
      expect(forbidden.test(name)).toBe(false);
    }
  });

  it("aggregate resolves all 5 Trust Gates to a defined union value (no undefined 'unset' state)", () => {
    const snapshot = resolveAllTrustGateEnablement({
      AUTOPILOT_REAL_RUNTIME: "true",
    });
    for (const value of Object.values(snapshot)) {
      expect(value === "true" || value === "false").toBe(true);
    }
  });
});
