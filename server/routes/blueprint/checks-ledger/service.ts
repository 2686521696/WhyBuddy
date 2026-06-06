/**
 * `blueprint-checks-ledger` spec Tasks 2.2–2.4, 3.1–3.4：
 * 校验台账服务层实现。
 *
 * `createChecksLedgerService(ctx)` 返回 closure-based ChecksLedgerService 实例。
 * 遵循与 `createSpecTreeLlmService` / `createEffectPreviewLlmService` 相同的
 * factory 模式，所有依赖通过 BlueprintServiceContext 注入。
 *
 * 核心语义：
 * - append-only：一旦写入不可更新或删除
 * - env gate：`BLUEPRINT_CHECKS_LEDGER_ENABLED !== "true"` 时静默跳过
 * - 事件发出：checks.entry.recorded / checks.gate.passed / checks.gate.failed
 */

import type { BlueprintServiceContext } from "../context.js";
import type { BlueprintGenerationJob } from "../../../../shared/blueprint/contracts.js";
import type { BlueprintChecksLedgerEntry } from "../../../../shared/blueprint/checks-ledger/types.js";
import type {
  ChecksLedgerService,
  RecordCheckInput,
  GetChecksFilter,
  BlueprintChecksLedgerResponse,
  BlueprintChecksLedgerSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENV_KEY = "BLUEPRINT_CHECKS_LEDGER_ENABLED";
const MAX_OUTPUT_BYTES = 4096;
const TRUNCATED_SUFFIX = "\n[truncated]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateOutput(output: string | undefined): string | undefined {
  if (output === undefined) return undefined;
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes <= MAX_OUTPUT_BYTES) return output;
  // Slice by bytes: encode, slice, decode
  const buf = Buffer.from(output, "utf8");
  const truncated = buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return truncated + TRUNCATED_SUFFIX;
}

function buildEntryId(jobId: string, sequence: number): string {
  return `chk-${jobId.slice(0, 8)}-${sequence}`;
}

function computeSummary(entries: BlueprintChecksLedgerEntry[]): BlueprintChecksLedgerSummary {
  let pass = 0;
  let fail = 0;
  let warn = 0;
  let skip = 0;
  for (const e of entries) {
    switch (e.status) {
      case "pass": pass++; break;
      case "fail": fail++; break;
      case "warn": warn++; break;
      case "skip": skip++; break;
    }
  }
  return { total: entries.length, pass, fail, warn, skip };
}

function validateInput(input: RecordCheckInput): void {
  const missing: string[] = [];
  if (!input.jobId) missing.push("jobId");
  if (!input.stage) missing.push("stage");
  if (!input.checkType) missing.push("checkType");
  if (!input.checkName) missing.push("checkName");
  if (!input.status) missing.push("status");
  if (!input.validator) missing.push("validator");
  if (missing.length > 0) {
    throw new Error(
      `checks-ledger: missing required fields: ${missing.join(", ")}`,
    );
  }
}

function createEventId(): string {
  return `chk-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const STATUS_EMOJI: Record<string, string> = {
  pass: "✅",
  fail: "❌",
  warn: "⚠️",
  skip: "⏭",
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createChecksLedgerService(
  ctx: BlueprintServiceContext,
): ChecksLedgerService {
  const enabled = process.env[ENV_KEY] === "true";

  return {
    recordCheck(input: RecordCheckInput): BlueprintChecksLedgerEntry {
      // Gate check: if disabled, return placeholder without side effects
      if (!enabled) {
        return {
          id: "chk-disabled-0",
          jobId: input.jobId,
          stage: input.stage,
          checkType: input.checkType,
          checkName: input.checkName,
          status: input.status,
          validator: input.validator,
          triggeredAt: ctx.now().toISOString(),
          exitCode: input.exitCode,
          output: input.output,
          durationMs: input.durationMs,
          metadata: input.metadata,
        };
      }

      // Validate required fields
      validateInput(input);

      // Resolve job
      const job = ctx.jobStore.get(input.jobId);
      if (!job) {
        throw new Error(`checks-ledger: job_not_found: ${input.jobId}`);
      }

      // Initialize checksLedger array if needed
      if (!job.checksLedger) {
        job.checksLedger = [];
      }

      // Check if this will be the first fail (before appending)
      const hadFailBefore = job.checksLedger.some((e) => e.status === "fail");

      // Build entry
      const sequence = job.checksLedger.length + 1;
      const entry: BlueprintChecksLedgerEntry = {
        id: buildEntryId(input.jobId, sequence),
        jobId: input.jobId,
        stage: input.stage,
        checkType: input.checkType,
        checkName: input.checkName,
        status: input.status,
        validator: input.validator,
        triggeredAt: ctx.now().toISOString(),
        exitCode: input.exitCode,
        output: truncateOutput(input.output),
        durationMs: input.durationMs,
        metadata: input.metadata,
      };

      // Append to job
      job.checksLedger.push(entry);

      // Persist
      ctx.jobStore.save(job);

      // Emit entry recorded event
      ctx.eventBus.emit({
        id: createEventId(),
        jobId: entry.jobId,
        type: "checks.entry.recorded" as any,
        family: "checks" as any,
        stage: entry.stage,
        status: "completed" as any,
        message: `check ${entry.checkName}: ${entry.status}`,
        occurredAt: entry.triggeredAt,
        payload: entry,
      } as any);

      // Gate transition logic
      if (entry.status === "fail" && !hadFailBefore) {
        // First fail → emit gate.failed
        const summary = computeSummary(job.checksLedger);
        ctx.eventBus.emit({
          id: createEventId(),
          jobId: entry.jobId,
          type: "checks.gate.failed" as any,
          family: "checks" as any,
          stage: entry.stage,
          status: "completed" as any,
          message: `quality gate recorded a failing check at ${entry.stage}`,
          occurredAt: entry.triggeredAt,
          payload: { jobId: entry.jobId, entry, summary },
        } as any);
      } else if (entry.status === "pass") {
        // Check if gate is now passed (no fails, at least 1 pass)
        const hasFail = job.checksLedger.some((e) => e.status === "fail");
        const hasPass = job.checksLedger.some((e) => e.status === "pass");
        if (!hasFail && hasPass) {
          const summary = computeSummary(job.checksLedger);
          ctx.eventBus.emit({
            id: createEventId(),
            jobId: entry.jobId,
            type: "checks.gate.passed" as any,
            family: "checks" as any,
            stage: entry.stage,
            status: "completed" as any,
            message: `quality gate passing at ${entry.stage}`,
            occurredAt: entry.triggeredAt,
            payload: { jobId: entry.jobId, summary },
          } as any);
        }
      }

      return entry;
    },

    getChecks(jobId: string, filter?: GetChecksFilter): BlueprintChecksLedgerResponse {
      const job = ctx.jobStore.get(jobId);
      if (!job) {
        return {
          jobId,
          entries: [],
          summary: { total: 0, pass: 0, fail: 0, warn: 0, skip: 0 },
        };
      }

      let entries = [...(job.checksLedger ?? [])];

      // Apply filters
      if (filter?.stage) {
        entries = entries.filter((e) => e.stage === filter.stage);
      }
      if (filter?.status) {
        entries = entries.filter((e) => e.status === filter.status);
      }
      if (filter?.checkType) {
        entries = entries.filter((e) => e.checkType === filter.checkType);
      }

      // Sort by triggeredAt ascending
      entries.sort((a, b) => a.triggeredAt.localeCompare(b.triggeredAt));

      return {
        jobId,
        entries,
        summary: computeSummary(entries),
      };
    },

    isGatePassed(jobId: string): boolean {
      const job = ctx.jobStore.get(jobId);
      if (!job) return false;
      const ledger = job.checksLedger ?? [];
      if (ledger.length === 0) return false;
      const hasFail = ledger.some((e) => e.status === "fail");
      const hasPass = ledger.some((e) => e.status === "pass");
      return !hasFail && hasPass;
    },

    renderMarkdown(jobId: string): string {
      const job = ctx.jobStore.get(jobId);
      const ledger = job?.checksLedger ?? [];

      if (ledger.length === 0) {
        return "## 校验台账 (Checks Ledger)\n\n暂无校验记录。\n";
      }

      const sorted = [...ledger].sort((a, b) =>
        a.triggeredAt.localeCompare(b.triggeredAt),
      );

      const lines: string[] = [
        "## 校验台账 (Checks Ledger)",
        "",
        "| # | 阶段 | 类型 | 名称 | 状态 | 校验器 | 时间 | 耗时 |",
        "|---|------|------|------|------|--------|------|------|",
      ];

      for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i];
        const emoji = STATUS_EMOJI[e.status] ?? e.status;
        const duration = e.durationMs !== undefined ? `${e.durationMs}ms` : "-";
        lines.push(
          `| ${i + 1} | ${e.stage} | ${e.checkType} | ${e.checkName} | ${emoji} ${e.status} | ${e.validator} | ${e.triggeredAt} | ${duration} |`,
        );
      }

      const summary = computeSummary(sorted);
      lines.push("");
      lines.push("### 汇总");
      lines.push(
        `- 总计: ${summary.total} | ✅ 通过: ${summary.pass} | ❌ 失败: ${summary.fail} | ⚠️ 警告: ${summary.warn} | ⏭ 跳过: ${summary.skip}`,
      );
      lines.push("");

      return lines.join("\n");
    },
  };
}
