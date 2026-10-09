/**
 * 浏览器错误上报：没配 VITE_SENTRY_DSN 连包都不加载；配了带上网址里的会话号、脱敏（lib/error-reporting.ts）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browserReportingOptions, initBrowserErrorReporting, sessionFromLocation } from "../error-reporting";

describe("浏览器错误上报", () => {
  it("没配：不加载 @sentry/react（首屏不多一个字节）", async () => {
    let loaded = false;
    const ok = await initBrowserErrorReporting({ MODE: "production" }, async () => {
      loaded = true;
      return { init: () => {} };
    });
    expect(ok).toBe(false);
    expect(loaded).toBe(false);
  });

  it("配了：加载并 init；事件带上会话号，脱敏", async () => {
    let options: Record<string, any> = {};
    const ok = await initBrowserErrorReporting({ VITE_SENTRY_DSN: "https://k@o0.ingest.sentry.io/0", MODE: "development" },
      async () => ({ init: (o: Record<string, unknown>) => { options = o; } }));
    expect(ok).toBe(true);
    expect(options.environment).toBe("development");
    const href = "http://localhost:3000/agent-loop/sliderule?session=sr-20261008092556-8PW0MNC7ZW";
    const opts = browserReportingOptions({}, "dsn", () => href);
    const sent = (opts.beforeSend as (e: unknown) => any)({ message: "Bearer abcdefghijklmnop failed" });
    expect(sent.tags.session_id).toBe("sr-20261008092556-8PW0MNC7ZW");
    expect(sent.message).not.toContain("abcdefghijklmnop");
  });

  // ⚠ 2026-10-09 审 Sentry：一天里 6 条浏览器错误被以 too_large:event 拒收（shared/observability/error-scrub.ts 头注）。
  //   面包屑照 Sentry 浏览器 SDK 给 console.log 生成的样子：message 是拼好的一行，data.arguments 是原始参数对象。
  it("工作台往控制台打过大对象：出错时事件仍放得下，错误本身完好", () => {
    const opts = browserReportingOptions({}, "dsn", () => "http://localhost:3000/");
    const state = { controlTranscript: Array.from({ length: 300 }, (_, i) => ({ kind: "tool_result", text: "结果".repeat(60) + i })) };
    const rawCrumb = (i: number) => ({ category: "console", level: "log", timestamp: i,
      message: "[control] state " + JSON.stringify(state).slice(0, 5000), data: { arguments: ["[control] state", state], logger: "console" } });
    const exception = { values: [{ type: "TypeError", value: "Cannot read properties of undefined (reading 'revision')",
      stacktrace: { frames: [{ filename: "app.js", function: "applyRun", lineno: 1, colno: 2 }] } }] };
    const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    const unslimmed = { exception, breadcrumbs: Array.from({ length: 100 }, (_, i) => rawCrumb(i)) };
    expect(size(unslimmed)).toBeGreaterThan(1024 * 1024);                        // 前提：不处理就超过 Sentry 的 1 MB
    const crumbs = unslimmed.breadcrumbs.map(c => (opts.beforeBreadcrumb as (c: unknown) => any)(c));
    expect(crumbs.every(c => c.data.arguments === undefined && c.data.logger === "console")).toBe(true);
    const sent = (opts.beforeSend as (e: unknown) => any)({ exception, breadcrumbs: crumbs, extra: { blob: "x".repeat(900_000) } });
    expect(size(sent)).toBeLessThanOrEqual(512 * 1024);
    expect(sent.exception.values[0].value).toBe("Cannot read properties of undefined (reading 'revision')");
    expect(sent.tags.trimmed).toContain("extra");
  });

  it("小事件原样发，不打 trimmed 标签", () => {
    const opts = browserReportingOptions({}, "dsn", () => "http://localhost:3000/");
    const sent = (opts.beforeSend as (e: unknown) => any)({ message: "boom", breadcrumbs: [{ message: "click" }] });
    expect(sent.breadcrumbs).toEqual([{ message: "click" }]);
    expect(sent.tags?.trimmed).toBeUndefined();
  });

  it("加载失败不影响页面", async () => {
    expect(await initBrowserErrorReporting({ VITE_SENTRY_DSN: "x" }, async () => { throw new Error("offline"); })).toBe(false);
  });

  it("会话号：没有就是 null", () => {
    expect(sessionFromLocation("http://localhost:3000/")).toBeNull();
  });

  it("入口真的调到", () => {
    const main = readFileSync(resolve(__dirname, "../../main.tsx"), "utf-8").replace(/\/\/.*$/gm, "");
    expect(main).toContain("void initBrowserErrorReporting();");
  });
});
