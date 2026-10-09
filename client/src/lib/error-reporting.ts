/**
 * 浏览器的错误上报（Sentry）。跟 Node / Python 两份同一套规矩（server/observability/error-reporting.ts 头注）：
 * 没配 VITE_SENTRY_DSN 什么都不做；上报前脱敏（shared/observability/error-scrub.ts）；带上网址里的会话号。
 *
 * 配了才动态加载 @sentry/react：没配的部署首屏包里不多一个字节。代价是挂载前那几毫秒的报错收不到。
 * React 19 渲染期没接住的错会走 reportError → window error，Sentry 的全局处理器收得到。
 */
import { fitEventSize, reportingEnvironment, scrubEvent, slimBreadcrumb } from "../../../shared/observability/error-scrub";

type Env = Record<string, string | boolean | undefined>;
type SentryLike = { init: (options: Record<string, unknown>) => unknown };

/** 网址里的会话号（/agent-loop/sliderule?session=sr-…）。按会话搜报错用它。 */
export function sessionFromLocation(href: string): string | null {
  try {
    return new URL(href).searchParams.get("session");
  } catch {
    return null;
  }
}

export function browserReportingOptions(env: Env, dsn: string, href: () => string): Record<string, unknown> {
  return {
    dsn,
    environment: reportingEnvironment(String(env.VITE_SENTRY_ENVIRONMENT || ""), String(env.MODE || "")),
    release: String(env.VITE_SENTRY_RELEASE || "").trim() || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { service: "browser" } },
    beforeSend: (event: { tags?: Record<string, unknown> }) => {
      const session = sessionFromLocation(href());
      if (session) event.tags = { ...(event.tags || {}), session_id: session };
      const scrubbed = scrubEvent(event);
      return scrubbed && fitEventSize(scrubbed);       // 超过 Sentry 的大小上限会被整条拒收（error-scrub 头注）
    },
    beforeBreadcrumb: (crumb: unknown) => slimBreadcrumb(crumb),
  };
}

export async function initBrowserErrorReporting(
  env: Env = (import.meta as unknown as { env: Env }).env,
  load: () => Promise<SentryLike> = () => import("@sentry/react") as unknown as Promise<SentryLike>,
): Promise<boolean> {
  const dsn = String(env.VITE_SENTRY_DSN || "").trim();
  if (!dsn) return false;
  try {
    const sentry = await load();
    sentry.init(browserReportingOptions(env, dsn, () => window.location.href));
    return true;
  } catch {
    return false;                                    // 增强类：加载 / 初始化失败不影响页面
  }
}
