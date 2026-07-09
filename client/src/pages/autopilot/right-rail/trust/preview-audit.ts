/**
 * Autopilot v4 信任层 — 出图审计裁决（EP_VIS_AUDIT ◆◆）纯派生函数。
 *
 * 对应 spec：tasks.md 任务 13.1–13.3；design.md §Components 6 / Property 4；
 * requirements.md 需求 6.1 / 6.2 / 6.3 / 6.4。
 *
 * 纪律：纯、无 IO、确定、全、不抛错。
 */

import type { BlueprintChecksLedgerEntry, PreviewAuditVerdict } from "./types";

type FraudReason = "fallback_pretending" | "fake_success" | "duplicate_content";

const FRAUD_KEYWORDS: ReadonlyArray<[FraudReason, readonly string[]]> = [
  [
    "fallback_pretending",
    ["fallback_pretending", "fallback pretend", "兜底冒充"],
  ],
  ["fake_success", ["fake_success", "fake success", "假成功"]],
  ["duplicate_content", ["duplicate_content", "duplicate", "复制充数", "重复"]],
];

function readText(entry: BlueprintChecksLedgerEntry): string {
  const parts = [entry.checkName ?? "", entry.output ?? ""];
  return parts.join(" ").toLowerCase();
}

function parseFraudReasons(text: string): FraudReason[] {
  const reasons: FraudReason[] = [];
  for (const [reason, keywords] of FRAUD_KEYWORDS) {
    if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
      reasons.push(reason);
    }
  }
  return reasons;
}

function readRetryCount(entry: BlueprintChecksLedgerEntry): number {
  // 优先从 metadata.retryCount 读取，其次从 output 中解析 "retry(Count)? = N"。
  const meta = entry.metadata as { retryCount?: unknown } | undefined;
  if (
    meta &&
    typeof meta.retryCount === "number" &&
    Number.isFinite(meta.retryCount)
  ) {
    return Math.max(0, Math.trunc(meta.retryCount));
  }
  const match = (entry.output ?? "").match(/retry(?:count)?\s*[=:]\s*(\d+)/i);
  if (match) {
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * 13.1–13.3 从台账 `preview_audit` 条目派生出图审计裁决。
 *
 * Property 4：batchStatus = fail（任一 fail）> warn（任一 warn）> pass；
 * exhausted = 存在 `preview_audit_retry_exhausted`；retryCount 取条目中最大值；
 * 对缺失可选字段不抛错。
 */
export function derivePreviewAuditVerdict(
  entries: readonly BlueprintChecksLedgerEntry[] | null | undefined
): PreviewAuditVerdict {
  const auditEntries = (entries ?? []).filter(
    (entry): entry is BlueprintChecksLedgerEntry =>
      !!entry && entry.checkType === "preview_audit"
  );

  let hasFail = false;
  let hasWarn = false;
  let hasPass = false;
  let retryCount = 0;
  let exhausted = false;
  const findings: PreviewAuditVerdict["findings"] = [];

  for (const entry of auditEntries) {
    if (entry.status === "fail") hasFail = true;
    else if (entry.status === "warn") hasWarn = true;
    else if (entry.status === "pass") hasPass = true;

    retryCount = Math.max(retryCount, readRetryCount(entry));

    const name = (entry.checkName ?? "").toLowerCase();
    if (name.includes("retry_exhausted") || name.includes("回炉耗尽")) {
      exhausted = true;
    }

    const text = readText(entry);
    for (const reason of parseFraudReasons(text)) {
      findings.push({
        reason,
        details: entry.output ?? entry.checkName ?? "",
        severity: entry.status === "fail" ? "error" : "warn",
      });
    }
  }

  const batchStatus = hasFail
    ? "fail"
    : hasWarn
      ? "warn"
      : hasPass
        ? "pass"
        : "pass";

  return { batchStatus, retryCount, exhausted, findings };
}
