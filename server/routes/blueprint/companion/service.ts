/**
 * `blueprint-v4-full-alignment` Module A — 伴随层总服务（含 Module B 留痕）。
 *
 * createCompanionLayer(ctx) 总工厂：
 * - evaluateAll() 顺序调用 critic + grounding（A.8.1）
 * - 每个 finding → checksLedger.recordCheck(companion_trace)（A.8.2 / Module B）
 * - warn/error 级 finding → push 到 job.companionFindings[]（A.8.3 / R2.8 / R3.8）
 *
 * env gate `BLUEPRINT_COMPANION_ENABLED`：关闭时返回 no-op（R1.2）。
 * 非阻塞：任何内部错误不抛出（R4.6）。
 */

import type { BlueprintServiceContext } from "../context.js";
import type {
  CompanionLayerService,
  CompanionFinding,
  CompanionTriggerContext,
  CompanionLayerPolicy,
} from "../../../../shared/blueprint/companion/types.js";
import type { BlueprintCheckStatus } from "../../../../shared/blueprint/checks-ledger/types.js";
import { createDefaultCompanionLayerPolicy } from "./policy.js";
import { createCriticService } from "./critic.js";
import { createGroundingService } from "./grounding.js";

const ENV_KEY = "BLUEPRINT_COMPANION_ENABLED";

function severityToStatus(
  severity: CompanionFinding["severity"],
): BlueprintCheckStatus {
  if (severity === "error") return "fail";
  if (severity === "warn") return "warn";
  return "pass";
}

function truncate(text: string, max = 4096): string {
  return text.length > max ? text.slice(0, max) + "\n[truncated]" : text;
}

/**
 * 把单个 finding 写入 checksLedger（Module B 留痕）+ 在 warn/error 时
 * push 到 job.companionFindings[]（露出）。
 */
function recordFinding(
  ctx: BlueprintServiceContext,
  finding: CompanionFinding,
): void {
  // Module B 留痕（R4.1/R4.2）
  try {
    ctx.checksLedger?.recordCheck({
      jobId: finding.targetArtifactId,
      stage: finding.stage,
      checkType: "companion_trace",
      checkName: `companion:${finding.role}:${finding.stage}`,
      status: severityToStatus(finding.severity),
      validator: `companion/${finding.role}.ts`,
      output: truncate(
        JSON.stringify({
          findings: finding.findings,
          citations: finding.citations,
        }),
      ),
      metadata: {
        role: finding.role,
        targetArtifactId: finding.targetArtifactId,
        findingsCount: finding.findings.length,
        severity: finding.severity,
        ...(finding.repoFilesRead
          ? { repoFilesReadCount: finding.repoFilesRead.length }
          : {}),
      },
    });
  } catch (err) {
    // 非阻塞（R4.6）
    ctx.logger.warn("companion: ledger write failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 露出（R2.8/R3.8）：warn/error 级 finding push 到 job.companionFindings[]
  if (finding.severity === "warn" || finding.severity === "error") {
    try {
      const job = ctx.jobStore.get(finding.targetArtifactId);
      if (job) {
        const jobAny = job as typeof job & {
          companionFindings?: CompanionFinding[];
        };
        if (!jobAny.companionFindings) jobAny.companionFindings = [];
        jobAny.companionFindings.push(finding);
        ctx.jobStore.save(job);
      }
    } catch (err) {
      ctx.logger.warn("companion: job surfacing failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function createCompanionLayer(
  ctx: BlueprintServiceContext,
): CompanionLayerService {
  const enabled = process.env[ENV_KEY] === "true";
  const policy: CompanionLayerPolicy =
    (ctx as { companionLayerPolicy?: CompanionLayerPolicy })
      .companionLayerPolicy ?? createDefaultCompanionLayerPolicy();

  const critic = createCriticService(ctx, policy);
  const grounding = createGroundingService(ctx, policy);

  return {
    critic,
    grounding,
    async evaluateAll(
      triggerCtx: CompanionTriggerContext,
      artifact: unknown,
    ): Promise<CompanionFinding[]> {
      if (!enabled) return [];

      const findings: CompanionFinding[] = [];

      // A.8.1: 顺序调用 critic + grounding
      if (policy.enableCritic) {
        try {
          const f = await critic.evaluate(triggerCtx, artifact);
          if (f) {
            findings.push(f);
            recordFinding(ctx, f);
          }
        } catch (err) {
          ctx.logger.warn("companion: critic threw, skipping", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (policy.enableGrounding) {
        try {
          const f = await grounding.evaluate(triggerCtx, artifact);
          if (f) {
            findings.push(f);
            recordFinding(ctx, f);
          }
        } catch (err) {
          ctx.logger.warn("companion: grounding threw, skipping", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return findings;
    },
  };
}
