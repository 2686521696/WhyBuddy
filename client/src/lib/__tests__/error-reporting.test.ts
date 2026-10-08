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
