/**
 * `blueprint-v4-full-alignment` spec — Module F (R19/R20) + Module E (R12/R15)
 * 共享类型定义。
 *
 * 本文件是 provenance 产出方（Module F，扩展 EffectPreviewImageService）和
 * 审计消费方（Module E，PreviewAuditService）的唯一类型来源（R20 统一约定）。
 *
 * 纯类型，无 runtime 副作用。
 */

import type { BlueprintCheckStatus } from "../checks-ledger/types.js";

/**
 * R19.1 / R20：统一的图片来源元数据类型。
 *
 * 由 EffectPreviewImageService 在每个出口产出，供 PreviewAuditService 消费。
 *
 * 关键语义区分（R12.4）：
 * - 造假兜底冒充 = `source: "fallback"` AND `ok: true`（占位图冒充真生成）
 * - 诚实失败 = `source: "fallback"` AND `ok: false`（缺图，不是造假，不写文件）
 * - 合法模板 = `source: "template"` AND `ok: true`（env-off / 无 key 的正当路径）
 */
export interface BlueprintPreviewProvenance {
  /** 图片来源：真模型生成 / 模板路径 / 兜底（失败或占位） */
  source: "model" | "template" | "fallback";
  /** 是否真实成功产出 */
  ok: boolean;
  /** 失败/异常指示符，如 "503_exhausted"、"read_timeout_no_retry" */
  errorIndicators: string[];
  /** ISO 8601 产出时间 */
  generatedAt: string;
  /** 实际使用的模型名（真生成时填写） */
  modelUsed?: string;
  /** 提示词哈希，用于追溯 */
  promptHash?: string;
  /** 重试次数（503 重试累加） */
  retryCount: number;
}

/**
 * R15.2：单张预览图的审计输入元数据。
 * provenance 字段复用统一的 BlueprintPreviewProvenance（R20）。
 */
export interface PreviewImageMeta {
  imageId: string;
  jobId: string;
  nodeId: string;
  filePath: string;
  contentHash: string;
  fileSizeBytes: number;
  provenance: BlueprintPreviewProvenance;
}

/**
 * R15.3：单条审计发现。
 */
export interface PreviewAuditFinding {
  imageId: string;
  reason: "fallback_pretending" | "fake_success" | "duplicate_content";
  details: string;
  severity: "warn" | "error";
}

/**
 * R15.4：审计结果汇总。
 */
export interface PreviewAuditResult {
  jobId: string;
  auditedAt: string;
  totalImages: number;
  passCount: number;
  failCount: number;
  findings: PreviewAuditFinding[];
  overallStatus: BlueprintCheckStatus;
}

/**
 * R15.5：审计服务接口。
 */
export interface PreviewAuditService {
  auditPreviews(
    jobId: string,
    previews: PreviewImageMeta[],
  ): Promise<PreviewAuditResult>;
}
