/**
 * Node 服务的错误上报（Sentry）。跟 Python 那份（slide-rule-python/services/error_reporting.py）同一套规矩：
 *   - 没配 SENTRY_DSN 就什么都不做（增强类，CLAUDE.md §七 fail-open：初始化失败也只记一行、照常启动）；
 *   - 上报前脱敏（shared/observability/error-scrub.ts，两侧同一份样本钉着）；
 *   - environment / release / server_name / service 标签，能分清是谁的机器、哪一版代码。
 *
 * ⚠ 2026-10-08 为什么要它：同一天四次真机故障的报错都只在出事那台机器的控制台里，排查只能从数据库倒推。
 *
 * 只收进程级未捕获异常 / 未处理的 Promise 拒绝、Express 路由里抛出来的错。不收 console.error：Node 这边
 * console.error 用得很多、大半是预期内的，全收会把真问题淹掉。进程级兜底处理器（server/index.ts 末尾）
 * 照旧「记日志、不退出」，Sentry 自带的处理器在已有处理器时也不会让进程退出。
 *
 * 执行过程（Sentry Logs）：照官方写法 enableLogs + consoleLoggingIntegration + beforeSendLog。console 输出
 * 进的是 Logs、不是问题，所以上面「不收 console.error」那条不变。SENTRY_LOGS_LEVEL 跟 Python 那份同一个开关：
 * info（默认：log / info / warn / error）/ warning（warn / error）/ off。
 */
import os from "node:os";
import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { reportingEnvironment, scrubEvent, scrubValue } from "../../shared/observability/error-scrub.js";

let active = false;

type ConsoleLevel = "log" | "info" | "warn" | "error";

/** SENTRY_LOGS_LEVEL → 抄进 Logs 的 console 级别；off 返回 null。跟 Python 的 _logs_level 同一套取值。 */
export function consoleLogLevels(raw: string | undefined): ConsoleLevel[] | null {
  const level = (raw || "info").trim().toLowerCase();
  if (level === "off") return null;
  return level === "warning" ? ["warn", "error"] : ["log", "info", "warn", "error"];
}

export function errorReportingActive(): boolean {
  return active;
}

export function initErrorReporting(
  service: string,
  env: Record<string, string | undefined> = process.env,
  init: typeof Sentry.init = Sentry.init,
): boolean {
  const dsn = (env.SENTRY_DSN || "").trim();
  if (!dsn) return false;
  const levels = consoleLogLevels(env.SENTRY_LOGS_LEVEL);
  try {
    init({
      dsn,
      environment: reportingEnvironment(env.SENTRY_ENVIRONMENT, env.NODE_ENV || env.APP_ENV),
      release: (env.SENTRY_RELEASE || env.GIT_SHA || env.SOURCE_COMMIT || "").trim() || undefined,
      serverName: os.hostname(),
      sendDefaultPii: false,
      tracesSampleRate: Math.min(1, Math.max(0, Number(env.SENTRY_TRACES_SAMPLE_RATE) || 0)),
      beforeSend: event => scrubEvent(event),
      beforeSendTransaction: event => scrubEvent(event),
      beforeBreadcrumb: crumb => scrubEvent(crumb),
      enableLogs: levels !== null,
      beforeSendLog: log => {
        try { return scrubValue(log) as typeof log; } catch { return null; }      // 脱敏炸了就不发
      },
      ...(levels ? { integrations: [Sentry.consoleLoggingIntegration({ levels })] } : {}),
      initialScope: { tags: { service, ...(env.SLIDERULE_WORKER_POOL ? { worker_pool: env.SLIDERULE_WORKER_POOL } : {}) } },
    });
  } catch (error) {
    console.warn("[error-reporting] init failed; continuing without it:", (error as Error)?.message);
    return false;
  }
  active = true;
  return true;
}

/** 路由都挂完之后调：Express 里抛出来的错进 Sentry（没接上就不挂）。 */
export function attachExpressErrorReporting(app: Express): void {
  if (!active) return;
  try {
    Sentry.setupExpressErrorHandler(app);
  } catch (error) {
    console.warn("[error-reporting] express handler not attached:", (error as Error)?.message);
  }
}
