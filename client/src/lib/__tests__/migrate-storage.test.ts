/**
 * localStorage rename-migration shim test (R3①, WhyBuddy → SlideRule).
 * The hard requirement: the user's BYOK key pool must survive byte-for-byte.
 */
import { describe, it, expect } from "vitest";
import {
  migrateLegacyStorage,
  KEY_MAP,
  type StorageLike,
} from "../migrate-storage";

function makeStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key(i: number) {
      return Array.from(map.keys())[i] ?? null;
    },
    getItem(k: string) {
      return map.has(k) ? map.get(k)! : null;
    },
    setItem(k: string, v: string) {
      map.set(k, String(v));
    },
    removeItem(k: string) {
      map.delete(k);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

const BYOK_POOL = JSON.stringify({
  version: 1,
  entries: [
    { id: "k1", baseUrl: "https://api.example.com/v1", apiKey: "sk-user-key-001", model: "m1" },
    { id: "k2", baseUrl: "https://api.other.com/v1", apiKey: "sk-user-key-002", model: "m2" },
  ],
});

describe("migrateLegacyStorage (whybuddy:* → sliderule:*)", () => {
  it("migrates every documented key, removes the legacy keys, BYOK pool survives field-for-field", () => {
    const store = makeStorage({
      "whybuddy:llm-pool:v1": BYOK_POOL,
      "whybuddy:projection-density:v1": "compact",
      "whybuddy:driveMode": "marathon",
      "whybuddy:marathonBudget": JSON.stringify({ maxTokens: 24000 }),
      "whybuddy:autopilot:pages-blueprint-demo": "demo-state",
      "unrelated:key": "untouched",
    });

    const migrated = migrateLegacyStorage(store);
    expect(migrated).toBe(5);

    for (const [oldKey, newKey] of Object.entries(KEY_MAP)) {
      expect(store.getItem(oldKey)).toBeNull();
      expect(newKey.startsWith("sliderule:")).toBe(true);
    }

    // BYOK pool: every field of every key entry must be identical (一把都不能丢)
    const pool = JSON.parse(store.getItem("sliderule:llm-pool:v1")!);
    expect(pool).toEqual(JSON.parse(BYOK_POOL));

    expect(store.getItem("sliderule:projection-density:v1")).toBe("compact");
    expect(store.getItem("sliderule:driveMode")).toBe("marathon");
    expect(JSON.parse(store.getItem("sliderule:marathonBudget")!)).toEqual({ maxTokens: 24000 });
    expect(store.getItem("sliderule:autopilot:pages-blueprint-demo")).toBe("demo-state");
    expect(store.getItem("unrelated:key")).toBe("untouched");
  });

  it("migrates dynamic prefix-family keys (github-pages-demo:v2:<id>)", () => {
    const store = makeStorage({
      "whybuddy:github-pages-demo:v2:session-abc": "{}",
      "whybuddy:github-pages-demo:v2:session-def": "[1]",
    });
    expect(migrateLegacyStorage(store)).toBe(2);
    expect(store.getItem("sliderule:github-pages-demo:v2:session-abc")).toBe("{}");
    expect(store.getItem("sliderule:github-pages-demo:v2:session-def")).toBe("[1]");
    expect(store.getItem("whybuddy:github-pages-demo:v2:session-abc")).toBeNull();
  });

  it("is idempotent and never overwrites a newer sliderule:* value", () => {
    const store = makeStorage({
      "whybuddy:driveMode": "single",
      "sliderule:driveMode": "marathon", // user already produced newer state
    });
    expect(migrateLegacyStorage(store)).toBe(0);
    expect(store.getItem("sliderule:driveMode")).toBe("marathon");
    expect(store.getItem("whybuddy:driveMode")).toBeNull();

    // second run: nothing left to do
    expect(migrateLegacyStorage(store)).toBe(0);
  });

  it("no-ops without a storage (SSR safety)", () => {
    expect(migrateLegacyStorage(undefined)).toBe(0);
  });
});
