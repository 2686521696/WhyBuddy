import { describe, expect, it } from "vitest";
import {
  readShellSidebarCollapsed,
  SHELL_SIDEBAR_KEY,
  writeShellSidebarCollapsed,
} from "../shell-sidebar-layout";

describe("shell-sidebar-layout", () => {
  it("读写同一把 key，不是 1 以外的真值", () => {
    const mem = new Map<string, string>();
    const prev = globalThis.localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    };
    try {
      expect(readShellSidebarCollapsed()).toBe(false);
      writeShellSidebarCollapsed(true);
      expect(mem.get(SHELL_SIDEBAR_KEY)).toBe("1");
      expect(readShellSidebarCollapsed()).toBe(true);
      writeShellSidebarCollapsed(false);
      expect(mem.get(SHELL_SIDEBAR_KEY)).toBe("0");
      expect(readShellSidebarCollapsed()).toBe(false);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
  });
});
