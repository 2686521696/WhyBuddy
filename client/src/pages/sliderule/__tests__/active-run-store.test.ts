// E25 续播书签：按会话分键、坏数据容错、清理幂等。
// vitest 跑在 node 环境，无浏览器 localStorage——用内存版 stub 顶上。
import { describe, it, expect, beforeEach } from "vitest";
import {
  activeRunKey,
  saveActiveRun,
  loadActiveRun,
  clearActiveRun,
} from "../active-run-store";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe("active-run-store (E25 续播书签)", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
  });

  it("按会话分键：互不串味", () => {
    saveActiveRun("s1", { runId: "r1", userText: "甲", startedAt: "t1" });
    saveActiveRun("s2", { runId: "r2", userText: "乙", startedAt: "t2" });
    expect(loadActiveRun("s1")?.runId).toBe("r1");
    expect(loadActiveRun("s2")?.runId).toBe("r2");
    expect(activeRunKey("s1")).not.toBe(activeRunKey("s2"));
  });

  it("往返完整：runId/userText/startedAt 原样取回", () => {
    saveActiveRun("s1", {
      runId: "run-abc",
      userText: "做一个宠物医院系统",
      startedAt: "2026-07-16T09:00:00Z",
    });
    expect(loadActiveRun("s1")).toEqual({
      runId: "run-abc",
      userText: "做一个宠物医院系统",
      startedAt: "2026-07-16T09:00:00Z",
    });
  });

  it("坏数据容错：非 JSON / 缺 runId 一律当作无书签", () => {
    localStorage.setItem(activeRunKey("s1"), "not-json{");
    expect(loadActiveRun("s1")).toBeNull();
    localStorage.setItem(activeRunKey("s1"), JSON.stringify({ userText: "x" }));
    expect(loadActiveRun("s1")).toBeNull();
    localStorage.setItem(activeRunKey("s1"), JSON.stringify({ runId: "" }));
    expect(loadActiveRun("s1")).toBeNull();
  });

  it("清理幂等：clear 后无书签，重复 clear 不炸", () => {
    saveActiveRun("s1", { runId: "r1", userText: "", startedAt: "" });
    clearActiveRun("s1");
    expect(loadActiveRun("s1")).toBeNull();
    clearActiveRun("s1");
    expect(loadActiveRun("s1")).toBeNull();
  });
});
