import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_ID,
  SessionIdMismatchError,
  assertDriveSessionMatchesShell,
} from "../sliderule-session-id";

describe("assertDriveSessionMatchesShell", () => {
  it("对齐时返回壳上的 sessionId", () => {
    expect(assertDriveSessionMatchesShell("sr-1", "sr-1")).toBe("sr-1");
    expect(assertDriveSessionMatchesShell("", "sr-1")).toBe("sr-1");
  });

  it("反向：推演会话和当前会话不等必须抛，不许静默择一", () => {
    expect(() =>
      assertDriveSessionMatchesShell("sr-clinic", "sr-library")
    ).toThrow(SessionIdMismatchError);
  });
});

describe("DEFAULT_SESSION_ID 只许定义一次", () => {
  it("字面量只出现在本文件（生产代码，剥注释）", () => {
    const { readdirSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
    const { join, relative } = require("node:path") as typeof import("node:path");
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
        const stripped = readFileSync(p, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^[ \t]*\/\/.*$/gm, "");
        if (stripped.includes("sliderule-v51-product")) {
          hits.push(relative(root, p).replace(/\\/g, "/"));
        }
      }
    };
    walk(root);
    expect(hits).toEqual(["lib/sliderule-session-id.ts"]);
  });

  it("常量就是那个历史兜底桶", () => {
    expect(DEFAULT_SESSION_ID).toBe("sliderule-v51-product");
    const src = readFileSync(new URL("../sliderule-session-id.ts", import.meta.url), "utf8");
    expect(src).toContain(`export const DEFAULT_SESSION_ID = "${DEFAULT_SESSION_ID}"`);
  });
});
