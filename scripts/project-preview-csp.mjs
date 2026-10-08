/**
 * 2026-09-13: the real Studio rendered a ready E2B preview, but its iframe never
 * requested a ticket: the workbench CSP fell back to default-src 'self'. Keep
 * that policy for other resources and authorize only the configured preview
 * hostname suffix for frames. This is the public origin template used by the
 * Python authority, never the gateway credential or an iframe-supplied URL.
 *
 * CSP cannot express exactly one wildcard DNS label. The dedicated preview
 * suffix limits this transport permission; the API, ticket and gateway still
 * authorize the exact runtime, source revision and account on every request.
 */

export const PROJECT_PREVIEW_ORIGIN_ENV = "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE";

/** @param {string | undefined} template */
export function previewFrameSource(template) {
  if (template === undefined || template === "") return undefined;
  if (typeof template !== "string") throw new Error("project_preview_origin_invalid");

  // Validate the unparsed spelling first: WHATWG URLs silently normalize case,
  // whitespace, leading-zero ports and backslashes which the authority rejects.
  const parsed = /^(https?):\/\/\{runtimeId\}\.([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/.exec(template);
  if (!parsed) throw new Error("project_preview_origin_invalid");
  const [, scheme, suffix, portText] = parsed;
  const labels = suffix.split(".");
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || `rt-configuration-probe.${suffix}`.length > 253
      || (portText !== undefined && Number(portText) > 65535)
      || (scheme === "http" && suffix !== "localhost" && !suffix.endsWith(".localhost"))) {
    throw new Error("project_preview_origin_invalid");
  }

  // Browser URL.origin and the authority both omit :443/:80 for their scheme.
  let port;
  try {
    port = new URL(template.replace("{runtimeId}", "rt-configuration-probe")).port;
  } catch {
    throw new Error("project_preview_origin_invalid");
  }
  return `${scheme}://*.${suffix}${port ? `:${port}` : ""}`;
}

export const SENTRY_DSN_ENV = "VITE_SENTRY_DSN";

/**
 * 浏览器错误上报的投递地址，进 connect-src。
 *
 * ⚠ 2026-10-08：接入浏览器 Sentry（client/src/lib/error-reporting.ts）时漏了这一处——connect-src 只放了几家
 *   模型 API，SDK 往 o….ingest.us.sentry.io 发的报告会被 CSP 当场拦掉，页面不报错、Sentry 也收不到（§四：
 *   生成侧 / 消费侧只改一半）。只放 DSN 里**那一个**主机，不放 *.sentry.io；没配 DSN 什么都不加。
 *   DSN 写坏了也不加、不抛：上报是增强类，别为它把整个前端构建弄挂。
 * @param {string | undefined} dsn
 */
export function sentryConnectSource(dsn) {
  if (typeof dsn !== "string" || !dsn.trim()) return undefined;
  try {
    const url = new URL(dsn.trim());
    return url.protocol === "https:" && url.hostname ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {string | undefined} previewOriginTemplate
 * @param {string | undefined} [sentryDsn]
 */
export function workbenchContentSecurityPolicy(previewOriginTemplate, sentryDsn) {
  const preview = previewFrameSource(previewOriginTemplate);
  const sentry = sentryConnectSource(sentryDsn);
  // Internal fallback iframes E2B's published host (sandbox.get_host).
  // Only added when the dedicated preview suffix is already configured.
  const published = preview ? " https://*.e2b.app https://*.e2b.dev" : "";
  // wasm-unsafe-eval：@silurus/ooxml 的解析器是 WASM。worker-src 的 blob/data
  // 是它把解析丢进 Worker 的两种地址；不写的话 script-src 'self' 会把 Worker 拦住。
  return `default-src 'self'; frame-src 'self'${preview ? ` ${preview}` : ""}${published}; connect-src 'self' blob: https://api.openai.com https://api.deepseek.com https://openrouter.ai https://api.anthropic.com https://api.groq.com${sentry ? ` ${sentry}` : ""} data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:;`;
}
