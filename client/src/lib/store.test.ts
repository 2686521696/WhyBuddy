import { afterEach, describe, expect, it, vi } from "vitest";

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("useAppStore initialization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the default locale when a fake window has no location", async () => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock(),
    });

    const { useAppStore } = await import("./store");

    expect(useAppStore.getState().locale).toBe("zh-CN");
  });
});
