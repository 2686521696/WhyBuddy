/**
 * `blueprint-v4-full-alignment` Module A — 挑刺者服务（Critic）。
 *
 * 对抗独立性（R2.7）：evaluate 只接收最终 artifact，构造的 prompt
 * 绝不包含生成方的推理 / 自辩 / chain-of-thought。每次评估是独立的
 * LLM invocation。
 *
 * 触发：fuzzinessScore > threshold（R2.1）。
 * 降级：LLM 不可用 → 返回 info 级 finding，不抛错（R2.6）。
 */

import type { BlueprintServiceContext } from "../context.js";
import type {
  CriticService,
  CompanionFinding,
  CompanionTriggerContext,
  CompanionLayerPolicy,
} from "../../../../shared/blueprint/companion/types.js";

function createId(): string {
  return `cf-critic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractArtifactText(artifact: unknown): string {
  if (typeof artifact === "string") return artifact;
  try {
    return JSON.stringify(artifact, null, 2);
  } catch {
    return String(artifact);
  }
}

/**
 * 构造 Critic 的 prompt。
 *
 * 对抗独立性保证：systemMessage 明确指示这是独立审查，userMessage 只含
 * artifact 内容本身——不含任何 "生成方为什么这么做" 的解释。
 */
function buildCriticPrompt(artifact: unknown): {
  systemMessage: string;
  userMessage: string;
} {
  const systemMessage =
    "You are an independent adversarial reviewer (Critic). You did NOT " +
    "produce the artifact below and you have NO access to its author's " +
    "reasoning. Evaluate ONLY the artifact as presented. Find holes: " +
    "ambiguous terms, unsupported claims, overconfident assumptions, " +
    "missing evidence. Respond as JSON: " +
    '{"findings": string[], "severity": "info"|"warn"|"error", ' +
    '"suggestedActions": string[], "citations": string[]}.';

  // 只放 artifact 本身，绝不含生成方推理
  const userMessage =
    "Artifact to review (artifact only, no author rationale):\n\n" +
    extractArtifactText(artifact).slice(0, 8000);

  return { systemMessage, userMessage };
}

export function createCriticService(
  ctx: BlueprintServiceContext,
  policy: CompanionLayerPolicy,
): CriticService {
  return {
    async evaluate(
      triggerCtx: CompanionTriggerContext,
      artifact: unknown,
    ): Promise<CompanionFinding | null> {
      // 触发判定（R2.1）：模糊度低于阈值则不发力
      const score = triggerCtx.fuzzinessScore ?? 0;
      if (score <= policy.fuzzinessThreshold) {
        return null;
      }

      const timestamp = ctx.now().toISOString();
      const { systemMessage, userMessage } = buildCriticPrompt(artifact);

      let config: { apiKey?: string; model?: string };
      try {
        config = ctx.llm.getConfig() as { apiKey?: string; model?: string };
      } catch {
        config = {};
      }

      // 降级（R2.6）：无 LLM 配置 → info 级 finding
      if (!config.apiKey) {
        return {
          id: createId(),
          role: "critic",
          stage: triggerCtx.stage,
          targetArtifactId: triggerCtx.jobId,
          findings: [
            `Fuzziness score ${score.toFixed(2)} exceeded threshold but LLM unavailable for deep critique.`,
          ],
          severity: "info",
          suggestedActions: ["Configure LLM to enable adversarial critique."],
          citations: [],
          timestamp,
        };
      }

      try {
        const raw = await ctx.llm.callJson(
          [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage },
          ],
          {
            model: config.model,
            temperature: 0.3,
            timeoutMs: 30_000,
            retryAttempts: 1,
            sessionId: `critic-${triggerCtx.jobId}-${triggerCtx.stage}`,
          } as any,
        );

        const parsed = (raw ?? {}) as {
          findings?: unknown;
          severity?: unknown;
          suggestedActions?: unknown;
          citations?: unknown;
        };

        const findings = Array.isArray(parsed.findings)
          ? parsed.findings.map((f) => String(f)).slice(0, policy.maxFindingsPerInvocation)
          : [];
        const severity =
          parsed.severity === "error" || parsed.severity === "warn"
            ? parsed.severity
            : "info";

        return {
          id: createId(),
          role: "critic",
          stage: triggerCtx.stage,
          targetArtifactId: triggerCtx.jobId,
          findings,
          severity,
          suggestedActions: Array.isArray(parsed.suggestedActions)
            ? parsed.suggestedActions.map((a) => String(a))
            : [],
          citations: Array.isArray(parsed.citations)
            ? parsed.citations.map((c) => String(c))
            : [],
          timestamp,
        };
      } catch (err) {
        ctx.logger.warn("critic: evaluation failed, returning info finding", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          id: createId(),
          role: "critic",
          stage: triggerCtx.stage,
          targetArtifactId: triggerCtx.jobId,
          findings: ["Critic evaluation encountered an internal error."],
          severity: "info",
          suggestedActions: [],
          citations: [],
          timestamp,
        };
      }
    },
  };
}
