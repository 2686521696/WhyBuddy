/**
 * Rename-migration env shim (SlideRule ← WhyBuddy).
 *
 * Reads SLIDERULE_* with fallback to the legacy WHYBUDDY_* name so deployments
 * that only set the old variables keep working for one release cycle.
 * New name always wins when both are set.
 *
 * Remove together with the /api/whybuddy route alias and the localStorage
 * KEY_MAP migration once the deprecation window (4–6 weeks) closes.
 */

export const LEGACY_ENV_PREFIX = "WHYBUDDY_";
export const ENV_PREFIX = "SLIDERULE_";

export function legacyEnvName(newName: string): string {
  return newName.replace(ENV_PREFIX, LEGACY_ENV_PREFIX);
}

export function readEnvCompat(
  newName: string,
  env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {}) as Record<
    string,
    string | undefined
  >
): string | undefined {
  return env[newName] ?? env[legacyEnvName(newName)];
}
