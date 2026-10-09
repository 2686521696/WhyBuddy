/**
 * Node 服务的错误上报：没配 DSN 不启用；配了带上服务名、机器名、脱敏钩子；入口真的调到（server/observability/error-reporting.ts）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Sentry from "@sentry/node";
import { consoleLogLevels, initErrorReporting } from "../observability/error-reporting";

describe("Node 错误上报", () => {
  it("没配 SENTRY_DSN：什么都不做", () => {
    const calls: unknown[] = [];
    expect(initErrorReporting("node", {}, (o => void calls.push(o)) as never)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("配了：环境、机器、服务标签、脱敏钩子都带上", () => {
    let options: Record<string, any> = {};
    const ok = initErrorReporting("node", { SENTRY_DSN: "https://k@o0.ingest.sentry.io/0", NODE_ENV: "production",
      SLIDERULE_WORKER_POOL: "dev-DESKTOP-57LOSN8-8374d0ee" }, (o => { options = o as never; }) as never);
    expect(ok).toBe(true);
    expect(options.environment).toBe("production");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.serverName).toBeTruthy();
    expect(options.initialScope.tags).toEqual({ service: "node", worker_pool: "dev-DESKTOP-57LOSN8-8374d0ee" });
    const sent = options.beforeSend({ message: "connect postgresql://u:p4ss@h/db failed",
      request: { headers: { Authorization: "Bearer abcdefghijkl" } } });
    expect(JSON.stringify(sent)).not.toContain("p4ss");
    expect(sent.request.headers.Authorization).toBe("[Filtered]");
  });

  // ⚠ 2026-10-09：超过 Sentry 1 MB 的事件整条被拒收（shared/observability/error-scrub.ts 头注）。Node 进程常驻，
  //   面包屑跨请求攒满 100 条；接线要跟浏览器那份一样（§四）。
  it("面包屑不留控制台原始参数，超大的事件裁到放得下", () => {
    let options: Record<string, any> = {};
    initErrorReporting("node", { SENTRY_DSN: "https://k@o0.ingest.sentry.io/0" }, (o => { options = o as never; }) as never);
    const crumb = options.beforeBreadcrumb({ category: "console", message: "[proxy] body", data: { arguments: ["x".repeat(50_000)], logger: "console" } });
    expect(crumb.data.arguments).toBeUndefined();
    const sent = options.beforeSend({ exception: { values: [{ type: "Error", value: "boom" }] },
      breadcrumbs: Array.from({ length: 100 }, () => ({ message: "y".repeat(20_000) })) });
    expect(new TextEncoder().encode(JSON.stringify(sent)).length).toBeLessThanOrEqual(512 * 1024);
    expect(sent.exception.values[0].value).toBe("boom");
    expect(sent.tags.trimmed).toBe("breadcrumbs");
  });

  it("初始化抛错：照常启动，不抛", () => {
    expect(initErrorReporting("node", { SENTRY_DSN: "x" }, (() => { throw new Error("bad dsn"); }) as never)).toBe(false);
  });

  it("入口：.env 读完就 init，路由挂完再挂 Express 错误处理（§三：写对了 ≠ 接上了）", () => {
    const src = readFileSync(resolve(__dirname, "../index.ts"), "utf-8").replace(/\/\/.*$/gm, "");
    const env = src.indexOf("applyInternalKeyAlias();");
    const init = src.indexOf('initErrorReporting("node")');
    expect(init).toBeGreaterThan(env);
    const attach = src.indexOf("attachExpressErrorReporting(app);");
    expect(attach).toBeGreaterThan(src.indexOf('app.get("*"'));
    expect(attach).toBeLessThan(src.indexOf("server.listen(port"));
  });

  it("执行过程：console 输出走真 SDK 进 Logs，脱敏；off 关得掉（官方 enableLogs + consoleLoggingIntegration）", async () => {
    const items: Array<{ body: string; level: string; attributes?: Record<string, { value: unknown }> }> = [];
    const transport = () => ({
      send: async (envelope: any) => {
        for (const [header, payload] of envelope[1]) if (header.type === "log") items.push(...payload.items);
        return {};
      },
      flush: async () => true,
    });
    const ok = initErrorReporting("node", { SENTRY_DSN: "https://k@o0.ingest.sentry.io/0" },
      (options => Sentry.init({ ...options, transport } as never)) as never);
    expect(ok).toBe(true);
    console.log("[proxy] python upstream http://127.0.0.1:9700 token=abc123secret");
    console.warn("[preview] relay slow");
    await Sentry.flush(2000);
    await Sentry.close();
    const bodies = items.map(item => item.body);
    expect(bodies.some(b => b.startsWith("[proxy] python upstream") && b.includes("[Filtered]"))).toBe(true);
    expect(JSON.stringify(items)).not.toContain("abc123secret");
    expect(items.find(item => item.body === "[preview] relay slow")?.level).toBe("warn");
    // 线上核对时 Node 的日志行 service 是空的：跟 Python 一样能按服务筛
    expect(items.every(item => item.attributes?.service?.value === "node")).toBe(true);
  });

  it("SENTRY_LOGS_LEVEL：跟 Python 那份同一套取值", () => {
    expect(consoleLogLevels(undefined)).toEqual(["log", "info", "warn", "error"]);
    expect(consoleLogLevels("warning")).toEqual(["warn", "error"]);
    expect(consoleLogLevels("off")).toBeNull();
    let options: Record<string, any> = {};
    initErrorReporting("node", { SENTRY_DSN: "https://k@o0.ingest.sentry.io/0", SENTRY_LOGS_LEVEL: "off" },
      (o => { options = o as never; }) as never);
    expect(options.enableLogs).toBe(false);
    expect(options.integrations).toBeUndefined();
  });
});
