/**
 * MCP GitHub capability bridge — HTTP fetcher.
 *
 * This file is the **single** module in the bridge subtree allowed to import
 * `undici.fetch`. `bridge.ts` consumes only the {@link BlueprintHttpFetcher}
 * interface declared here; all other bridge modules (`policy.ts`,
 * `url-parser.ts`, `mcp-request.ts`, `summary-derivation.ts`) are pure.
 *
 * The default fetcher enforces:
 * - https only (throws `invalid_url` for non-https initial or redirected URL)
 * - response body size ceiling (streamed read, aborts on overflow)
 * - request-level timeout via `AbortController`
 * - header whitelist (drops Authorization / Cookie / X-GitHub-Token even if
 *   a caller tries to pass them)
 * - non-2xx → `non_2xx`; network errors → `network`; aborts on timeout → `timeout`
 */

import { fetch, type Response } from "undici";

/**
 * Normalized HTTP response the bridge consumes. The shape is deliberately
 * minimal — the bridge only reads body / headers / finalUrl / status.
 */
export interface BlueprintHttpResponse {
  readonly status: number;
  readonly statusText?: string;
  /** Header map (lowercase keys). Cookies and other credential-carrying headers are dropped. */
  readonly headers: Record<string, string>;
  /** Raw response body as UTF-8 string. Truncated to `policy.maxResponseBodyBytes`. */
  readonly body: string;
  /** Final URL after redirect resolution (for allow-list re-check). */
  readonly finalUrl: string;
}

/**
 * Options for {@link BlueprintHttpFetcher.fetch}. Intentionally narrow:
 * only timeouts, header overrides and cancellation; no body / method / credentials.
 */
export interface BlueprintHttpFetcherOptions {
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

/**
 * Narrow HTTP fetcher interface.
 *
 * Implementations must enforce policy-level ceilings (body size, timeout, https)
 * and refuse to carry Authorization / Cookie / X-GitHub-Token headers even if
 * callers try to pass them in.
 */
export interface BlueprintHttpFetcher {
  fetch(
    url: string,
    options?: BlueprintHttpFetcherOptions,
  ): Promise<BlueprintHttpResponse>;
}

/**
 * Taxonomized error thrown by {@link BlueprintHttpFetcher}.
 *
 * The bridge matches on `kind` when building the fallback `provenance.error` reason.
 */
export type McpGithubFetcherErrorKind =
  | "timeout"
  | "network"
  | "non_2xx"
  | "body_too_large"
  | "invalid_url";

export class McpGithubFetcherError extends Error {
  constructor(
    message: string,
    public readonly kind: McpGithubFetcherErrorKind,
  ) {
    super(message);
    this.name = "McpGithubFetcherError";
  }
}

/**
 * Options for {@link createDefaultBlueprintHttpFetcher}.
 */
export interface CreateDefaultBlueprintHttpFetcherOptions {
  /** Max response body bytes; bridge passes `policy.maxResponseBodyBytes`. */
  readonly maxResponseBodyBytes: number;
  /** Default timeout applied when the caller doesn't pass `timeoutMs`. */
  readonly defaultTimeoutMs: number;
}

/**
 * Allowed request header keys (case-insensitive). Any other header supplied by
 * the caller is silently dropped. Authorization / Cookie / X-GitHub-Token etc.
 * never reach the wire.
 */
const ALLOWED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "accept-language",
  "user-agent",
  "if-none-match",
  "if-modified-since",
]);

/**
 * Default request headers applied when the caller doesn't override them.
 */
const DEFAULT_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  accept: "application/vnd.github+json",
  "user-agent": "blueprint-mcp-github-bridge/1.0",
};

function filterRequestHeaders(
  overrides?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...DEFAULT_REQUEST_HEADERS };
  if (!overrides) {
    return headers;
  }
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = rawKey.toLowerCase();
    if (!ALLOWED_REQUEST_HEADERS.has(key)) {
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    headers[key] = value;
  }
  return headers;
}

function headersToLowercaseRecord(
  responseHeaders: Response["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  responseHeaders.forEach((value, key) => {
    // Drop credential-bearing response headers even if the upstream echoed them.
    if (key === "set-cookie" || key === "cookie") {
      return;
    }
    out[key] = value;
  });
  return out;
}

async function readBodyWithCeiling(
  response: Response,
  maxBytes: number,
  abort: AbortController,
): Promise<string> {
  const body = response.body;
  if (!body) {
    return "";
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let acc = "";
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        abort.abort();
        reader.cancel().catch(() => undefined);
        throw new McpGithubFetcherError(
          `response body exceeded ${maxBytes} bytes`,
          "body_too_large",
        );
      }
      acc += decoder.decode(value, { stream: true });
    }
    acc += decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
  return acc;
}

/**
 * Default fetcher backed by `undici.fetch`. Follows redirects but re-validates
 * that the final URL remains `https:`; throws `invalid_url` if not.
 */
export function createDefaultBlueprintHttpFetcher(
  options: CreateDefaultBlueprintHttpFetcherOptions,
): BlueprintHttpFetcher {
  const { maxResponseBodyBytes, defaultTimeoutMs } = options;

  return {
    async fetch(url, fetcherOptions): Promise<BlueprintHttpResponse> {
      // 1. pre-flight: enforce https before any network traffic
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        throw new McpGithubFetcherError(`invalid url: ${url}`, "invalid_url");
      }
      if (target.protocol !== "https:") {
        throw new McpGithubFetcherError(
          `non-https url rejected: ${url}`,
          "invalid_url",
        );
      }

      // 2. set up timeout via AbortController
      const abort = new AbortController();
      const timeoutMs = fetcherOptions?.timeoutMs ?? defaultTimeoutMs;
      const timeoutHandle = setTimeout(() => {
        abort.abort();
      }, Math.max(1, timeoutMs));

      // 3. chain caller-supplied signal if present
      const externalSignal = fetcherOptions?.signal;
      const externalAbortHandler = () => abort.abort();
      if (externalSignal) {
        if (externalSignal.aborted) {
          abort.abort();
        } else {
          externalSignal.addEventListener("abort", externalAbortHandler, {
            once: true,
          });
        }
      }

      let response: Response;
      try {
        response = await fetch(target, {
          method: "GET",
          redirect: "follow",
          headers: filterRequestHeaders(fetcherOptions?.headers),
          signal: abort.signal,
        });
      } catch (error) {
        if (abort.signal.aborted && timeoutHandle) {
          throw new McpGithubFetcherError(
            `request timed out after ${timeoutMs}ms`,
            "timeout",
          );
        }
        throw new McpGithubFetcherError(
          error instanceof Error ? error.message : String(error),
          "network",
        );
      } finally {
        clearTimeout(timeoutHandle);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", externalAbortHandler);
        }
      }

      // 4. re-validate redirect target stayed https
      let finalUrl = response.url;
      if (!finalUrl) {
        finalUrl = target.toString();
      }
      try {
        const finalParsed = new URL(finalUrl);
        if (finalParsed.protocol !== "https:") {
          abort.abort();
          throw new McpGithubFetcherError(
            `redirected to non-https url: ${finalUrl}`,
            "invalid_url",
          );
        }
      } catch (error) {
        if (error instanceof McpGithubFetcherError) {
          throw error;
        }
        throw new McpGithubFetcherError(
          `invalid final url: ${finalUrl}`,
          "invalid_url",
        );
      }

      // 5. reject non-2xx
      if (response.status < 200 || response.status >= 300) {
        abort.abort();
        throw new McpGithubFetcherError(
          `HTTP ${response.status} ${response.statusText}`,
          "non_2xx",
        );
      }

      // 6. stream body with ceiling enforcement
      let body: string;
      try {
        body = await readBodyWithCeiling(response, maxResponseBodyBytes, abort);
      } catch (error) {
        if (error instanceof McpGithubFetcherError) {
          throw error;
        }
        throw new McpGithubFetcherError(
          error instanceof Error ? error.message : String(error),
          "network",
        );
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: headersToLowercaseRecord(response.headers),
        body,
        finalUrl,
      };
    },
  };
}
