/**
 * F2 · Web evidence seam for SlideRule evidence.search (全网检索).
 * Reuses server/core/web-search-provider (SerpAPI / Bing CN / DuckDuckGo / graceful mock).
 */

import { readEnvCompat } from "../../shared/env/read-env-compat.js";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import { executeRealWebSearch } from "../core/web-search-provider.js";
import type { WebSearchResponse } from "../../shared/web-search.js";
export const EVIDENCE_SOURCE_WEB_SEARCH = "F2_Web_Search 取数" as const;

export type WebEvidenceResult = {
  title: string;
  summary: string;
  content: string;
  provenance: string;
  evidenceSource: typeof EVIDENCE_SOURCE_WEB_SEARCH;
  payload?: Record<string, unknown>;
};

export type WebSearchExecutor = typeof executeRealWebSearch;

let webSearchExecutor: WebSearchExecutor = executeRealWebSearch;

/** Test seam — inject mock search without network. */
export function __setWebSearchExecutorForTests(fn: WebSearchExecutor | undefined): void {
  webSearchExecutor = fn ?? executeRealWebSearch;
}

export function isWebSearchEnabled(): boolean {
  return readEnvCompat("SLIDERULE_WEB_SEARCH_ENABLED") !== "0";
}

/** Build a concise query from goal + recent user turns. */
export function buildEvidenceSearchQuery(
  state: V5SessionState,
  recentTexts: string[] = []
): string {
  const goal = (state.goal?.text || "").trim();
  const userTurns = ((state.conversation || [])
    .slice(-6)
    .filter((c) => c.role === "user")
    .map((c) => String(c.text || "").trim())
    .filter(Boolean)) as string[];

  const parts = [...recentTexts, ...userTurns, goal].filter(Boolean);
  const unique = [...new Set(parts)];
  const merged = unique.join(" · ").slice(0, 280);
  return merged || goal || "SlideRule evidence search";
}

/** True when results are from a real search provider, not the example.test mock fallback. */
export function isRealWebSearchResponse(res: WebSearchResponse): boolean {
  if (res.mode === "mock") return false;
  if (!res.results?.length) return false;
  return !res.results.every(
    (r) => /example\.test/i.test(r.url) || r.source === "mock-search-index"
  );
}

export function formatWebEvidenceLines(res: WebSearchResponse): string {
  return res.results
    .map(
      (r, i) =>
        `${i + 1}. ${r.title}\n   URL: ${r.url}\n   摘要: ${String(r.snippet || "").slice(0, 280)}\n   source=${r.source}`
    )
    .join("\n\n");
}

export async function executeWebEvidenceSearch(
  state: V5SessionState,
  recentTexts: string[] = [],
  topK = 5
): Promise<WebEvidenceResult | null> {
  if (!isWebSearchEnabled()) return null;

  const query = buildEvidenceSearchQuery(state, recentTexts);
  try {
    const res = await webSearchExecutor({ query, options: { topK } });
    if (!isRealWebSearchResponse(res)) return null;

    const lines = formatWebEvidenceLines(res);
    const domains = [
      ...new Set(
        res.results
          .map((r) => {
            try {
              return new URL(r.url).hostname;
            } catch {
              return "";
            }
          })
          .filter(Boolean)
      ),
    ];

    return {
      title: "全网外部证据检索",
      summary: `【来源: ${EVIDENCE_SOURCE_WEB_SEARCH}】检索「${query.slice(0, 80)}」· ${res.results.length} 条`,
      content:
        `【全网检索 · query=${query}】\n` +
        `mode=${res.mode} · latencyMs=${res.latencyMs} · domains=${domains.join(", ")}\n\n` +
        lines,
      provenance: "web:search",
      evidenceSource: EVIDENCE_SOURCE_WEB_SEARCH,
      payload: {
        query,
        resultCount: res.results.length,
        mode: res.mode,
        domains,
      },
    };
  } catch {
    return null;
  }
}