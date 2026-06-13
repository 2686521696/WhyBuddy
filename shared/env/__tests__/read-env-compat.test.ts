/**
 * Env contract test for the WhyBuddy → SlideRule rename (R0/R3).
 *
 * Mechanical acceptance for the env shim: for every renamed variable the
 * effective value must be identical whether the deployment sets only the old
 * name, only the new name, or both (new name wins).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readEnvCompat, legacyEnvName } from "../read-env-compat.js";
import { resolveNarrationBrandWords } from "../../blueprint/sliderule-narration-immunity.js";

const RENAMED_ENV_VARS = [
  "SLIDERULE_SESSIONS_FILE",
  "SLIDERULE_ENABLE_TEST_HELPERS",
  "SLIDERULE_DISABLE_ROLE_PERSISTENCE",
  "SLIDERULE_BRAINSTORM_DEGRADE",
  "SLIDERULE_CAPABILITY_POOL_ENABLED",
  "SLIDERULE_POOL_TIMEOUT_MS",
  "SLIDERULE_POOL_RACE_MODE",
  "SLIDERULE_SKIP_PRIMARY_AFTER_POOL",
  "SLIDERULE_WEB_SEARCH_ENABLED",
  "SLIDERULE_NARRATION_BRAND_WORDS",
  "SLIDERULE_API_BASE",
  "SLIDERULE_SMOKE_PORT",
] as const;

const touched: string[] = [];
function setEnv(name: string, value: string | undefined) {
  touched.push(name);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const name of touched.splice(0)) delete process.env[name];
});

describe("readEnvCompat contract (only-old / only-new / both)", () => {
  it("legacyEnvName maps SLIDERULE_ → WHYBUDDY_", () => {
    expect(legacyEnvName("SLIDERULE_SESSIONS_FILE")).toBe("WHYBUDDY_SESSIONS_FILE");
  });

  it.each(RENAMED_ENV_VARS)("%s: effective value identical across the three set-ups", (name) => {
    const legacy = legacyEnvName(name);

    setEnv(name, undefined);
    setEnv(legacy, undefined);
    expect(readEnvCompat(name)).toBeUndefined();

    // only old name set — legacy deployment keeps working
    setEnv(legacy, "legacy-value");
    expect(readEnvCompat(name)).toBe("legacy-value");

    // both set — new name wins
    setEnv(name, "new-value");
    expect(readEnvCompat(name)).toBe("new-value");

    // only new name set
    setEnv(legacy, undefined);
    expect(readEnvCompat(name)).toBe("new-value");
  });

  it("explicit env object overrides process.env", () => {
    expect(readEnvCompat("SLIDERULE_X", { WHYBUDDY_X: "a" })).toBe("a");
    expect(readEnvCompat("SLIDERULE_X", { WHYBUDDY_X: "a", SLIDERULE_X: "b" })).toBe("b");
  });
});

describe("real read site honors the legacy name", () => {
  it("resolveNarrationBrandWords reads WHYBUDDY_NARRATION_BRAND_WORDS when only it is set", () => {
    setEnv("SLIDERULE_NARRATION_BRAND_WORDS", undefined);
    setEnv("WHYBUDDY_NARRATION_BRAND_WORDS", "BrandA,BrandB");
    expect(resolveNarrationBrandWords()).toEqual(["BrandA", "BrandB"]);

    setEnv("SLIDERULE_NARRATION_BRAND_WORDS", "BrandC");
    expect(resolveNarrationBrandWords()).toEqual(["BrandC"]);
  });
});
