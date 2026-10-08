/**
 * Node 服务的错误上报：没配 DSN 不启用；配了带上服务名、机器名、脱敏钩子；入口真的调到（server/observability/error-reporting.ts）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initErrorReporting } from "../observability/error-reporting";

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
});
