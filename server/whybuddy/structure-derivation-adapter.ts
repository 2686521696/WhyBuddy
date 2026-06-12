/**
 * K5 · structure 推导适配层（只读复用旧管线）。
 *
 * 把 V5SessionState（goal / clarified / route_options 类产物 / repo.inspect 产物）
 * 映射为 spec-tree-llm-derivation 的输入形状（或等价的丰富上下文）。
 *
 * 目标：
 * - server-llm 路径下 structure.decompose 获得父/兄弟/路线上下文 + 仓库片段（对标旧管线 977 行推导）。
 * - 仍走既有 runStructureDecomposePipeline / G_SCHEMA / G_INV / structureGateLedger 全链。
 * - pilot/demo 继续走 K4 升级后的 template（双路径）。
 *
 * repo 片段：优先会话内 "repo.inspect" artifact；无则跳过（不强拉外部）。
 * 只读复用：不修改 spec-tree-llm-derivation 内部。
 */

import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import type {
  SpecTreeLlmDerivationRequest,
  BlueprintRouteSet,
} from "../routes/blueprint/spec-tree-llm-derivation.js";
import { buildSpecTreePrompt } from "../routes/blueprint/llm-spec-prompts.js";

/** 从 V5 artifacts 提取路线相关信息（route_options / clarification 等）。 */
export function extractRouteContext(state: V5SessionState, inputArtifactIds: string[] = []) {
  const arts = (state.artifacts || []).filter((a) =>
    inputArtifactIds.length === 0 || inputArtifactIds.includes(a.id)
  );

  const routeArt = arts.find((a) => a.kind === "route_options") ||
                   arts.slice().reverse().find((a) => String(a.producedBy?.capabilityId || "").includes("route"));

  let selectedRouteId = "primary";
  let routeSummary = "(no explicit route selected in session)";
  let routeSet: Partial<BlueprintRouteSet> = { routes: [] };

  if (routeArt && routeArt.content) {
    const c = String(routeArt.content);
    // 简单解析常见格式；真实场景可由上游规范化
    const idMatch = c.match(/route[-_ ]?id[:\s]*([a-z0-9-]+)/i) || c.match(/selected[:\s]*([^\n]+)/i);
    if (idMatch) selectedRouteId = idMatch[1].trim();

    routeSummary = c.slice(0, 600) + (c.length > 600 ? " …[truncated]" : "");
    // 尽量构造最小 routeSet（旧推导需要）
    routeSet = {
      routes: [
        {
          id: selectedRouteId,
          name: "Primary Route",
          summary: routeSummary.slice(0, 200),
        },
      ],
    } as any;
  }

  return { selectedRouteId, routeSummary, routeSet };
}

/** 从 repo.inspect 等 artifact 提取 github urls 和 repo 片段（K1 风格上限 + 可见截断）。 */
export function extractRepoExcerpts(state: V5SessionState, inputArtifactIds: string[] = [], maxPer = 3000, totalBudget = 12000) {
  const arts = (state.artifacts || []).filter((a) =>
    (a.kind === "repo" || String(a.producedBy?.capabilityId || "").includes("repo")) &&
    (inputArtifactIds.length === 0 || inputArtifactIds.includes(a.id))
  );

  const urls: string[] = [];
  let excerpts: string[] = [];
  let used = 0;

  for (const a of arts) {
    const text = String(a.content || a.summary || "");
    if (!text) continue;

    // 尝试抽 github url
    const urlMatches = text.match(/https?:\/\/github\.com\/[^\s"'`]+/gi) || [];
    urlMatches.forEach((u) => { if (!urls.includes(u)) urls.push(u); });

    const excerpt = text.length > maxPer ? text.slice(0, maxPer) + ` …[truncated ${text.length - maxPer} chars]` : text;
    if (used + excerpt.length > totalBudget) break;
    used += excerpt.length;
    excerpts.push(`[repo:${a.id || "inspect"}] ${excerpt}`);
  }

  return { githubUrls: urls, repoExcerpts: excerpts.join("\n\n---\n\n") || "(no repo.inspect artifacts in session)" };
}

/** 构建适合旧推导的请求（best-effort，从 V5 state 合成）。 */
export function buildSpecTreeDerivationRequest(
  state: V5SessionState,
  inputArtifactIds: string[] = []
): Partial<SpecTreeLlmDerivationRequest> & { targetText: string } {
  const goalText = state.goal?.text || "目标";
  const { selectedRouteId, routeSummary, routeSet } = extractRouteContext(state, inputArtifactIds);
  const { githubUrls, repoExcerpts } = extractRepoExcerpts(state, inputArtifactIds);

  return {
    jobId: `whybuddy-${Date.now()}`,
    routeSet: routeSet as any,
    selectedRouteId,
    githubUrls,
    targetText: goalText,
    // 额外携带 whybuddy 侧的丰富上下文，供 adapter 内部或调试使用
    // @ts-expect-error 扩展字段
    _whybuddy: {
      routeSummary,
      repoExcerpts,
      upstreamDigest: "", // 由调用方补充
    },
  };
}

/** 给当前短 prompt 注入路线 + repo 上下文（K5 核心供给增强，对标 K1）。 */
export function enrichStructureUpstream(
  baseUpstream: string,
  state: V5SessionState,
  inputArtifactIds: string[] = []
): string {
  const { routeSummary, selectedRouteId } = extractRouteContext(state, inputArtifactIds);
  const { repoExcerpts } = extractRepoExcerpts(state, inputArtifactIds);

  let enriched = baseUpstream || "";
  if (routeSummary && !routeSummary.includes("(no explicit")) {
    enriched += `\n\n[route context]\nselected: ${selectedRouteId}\n${routeSummary}`;
  }
  if (repoExcerpts && !repoExcerpts.startsWith("(no repo")) {
    enriched += `\n\n[repo excerpts]\n${repoExcerpts}`;
  }
  return enriched;
}

/**
 * Build rich context summaries for reuse of old buildSpecTreePrompt / derivation (K5).
 * Maps V5 route/repo artifacts to primaryRoute, routeSet, repo excerpts for the old prompt shape.
 * This allows calling the rich 977-line derivation logic via adapter without forking.
 */
export function buildRichStructureContextForOldDerivation(
  state: V5SessionState,
  inputArtifactIds: string[] = []
) {
  const goalText = state.goal?.text || "目标";
  const { selectedRouteId, routeSummary, routeSet } = extractRouteContext(state, inputArtifactIds);
  const { githubUrls, repoExcerpts } = extractRepoExcerpts(state, inputArtifactIds);

  // Map to old prompt inputs (primaryRoute as the selected one)
  const primaryRoute = {
    id: selectedRouteId,
    title: "Primary Route",
    summary: routeSummary,
    rationale: "Selected for MVP balance",
    steps: [], // V5 may not have detailed steps; old will handle
  } as any;

  return {
    targetText: goalText,
    routeSet: routeSet as any,
    primaryRoute,
    githubUrls,
    repoExcerpts,
    // For whybuddy V5 structure, the "node" is implicit (decompose the goal)
  };
}

/**
 * Use the old buildSpecTreePrompt (from the 977-line derivation pipeline) to produce a rich
 * prompt payload for V5 structure.decompose. This is the "适配层调用旧管线" for better
 * parent/sibling/route/repo context + output schema.
 * Returns a stringified rich user prompt section that can be appended to or used as the
 * main prompt for the LLM call (still goes through V5 redaction + G_SCHEMA/G_INV/ledger).
 */
export function buildRichSpecTreePromptFromOld(
  state: V5SessionState,
  inputArtifactIds: string[] = []
): string {
  const ctx = buildRichStructureContextForOldDerivation(state, inputArtifactIds);
  try {
    const payload = buildSpecTreePrompt({
      request: { targetText: ctx.targetText, githubUrls: ctx.githubUrls },
      routeSet: ctx.routeSet,
      primaryRoute: ctx.primaryRoute,
      repoTreeDigest: ctx.repoExcerpts,
      // keyFiles left empty; repo excerpts already in digest
    });
    // Return the userPayload as rich instruction (includes target, routes, primary, schema, invariants)
    return JSON.stringify(payload.userPayload || payload, null, 2);
  } catch (e) {
    // Fallback to simple if old builder not usable in this context
    return `[old prompt builder unavailable, using basic context] target: ${ctx.targetText}`;
  }
}
