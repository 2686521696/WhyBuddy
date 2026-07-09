/**
 * Rename-migration localStorage shim (SlideRule ← WhyBuddy).
 *
 * Runs once at app startup: copies every legacy "whybuddy:*" entry to its
 * "sliderule:*" key, then removes the legacy key. Idempotent — a new key that
 * already exists is never overwritten (the user may have produced newer state
 * after a partial migration).
 *
 * Remove together with the readEnvCompat shim and the /api/whybuddy route
 * alias once the deprecation window (4–6 weeks) closes.
 */

export const LEGACY_STORAGE_PREFIX = "whybuddy:";
export const STORAGE_PREFIX = "sliderule:";

/** Exact known keys (documentation of the migrated surface; the prefix sweep below covers them too). */
export const KEY_MAP: Record<string, string> = {
  "whybuddy:llm-pool:v1": "sliderule:llm-pool:v1",
  "whybuddy:projection-density:v1": "sliderule:projection-density:v1",
  "whybuddy:driveMode": "sliderule:driveMode",
  "whybuddy:marathonBudget": "sliderule:marathonBudget",
  "whybuddy:autopilot:pages-blueprint-demo": "sliderule:autopilot:pages-blueprint-demo",
  // "whybuddy:github-pages-demo:v2:<dynamic>" — handled by the prefix sweep.
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function migrateLegacyStorage(storage?: StorageLike): number {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!store) return 0;

  // Snapshot keys first — removing while iterating shifts Storage indices.
  const legacyKeys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && key.startsWith(LEGACY_STORAGE_PREFIX)) legacyKeys.push(key);
  }

  let migrated = 0;
  for (const oldKey of legacyKeys) {
    const newKey = STORAGE_PREFIX + oldKey.slice(LEGACY_STORAGE_PREFIX.length);
    try {
      const value = store.getItem(oldKey);
      if (value !== null && store.getItem(newKey) === null) {
        store.setItem(newKey, value);
        migrated++;
      }
      store.removeItem(oldKey);
    } catch {
      // Quota / privacy-mode failures must never block app startup.
    }
  }
  return migrated;
}
