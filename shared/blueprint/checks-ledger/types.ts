/**
 * `blueprint-checks-ledger` spec Task 1.1：校验台账共享类型定义。
 *
 * 本模块只定义**纯类型**（无 runtime 副作用），由 server 侧
 * `server/routes/blueprint/checks-ledger/*` 在运行期消费，同时由前端
 * 驾驶舱展示校验结果列表时引用。
 *
 * 分离出独立子模块而不是塞进 `contracts.ts` 的理由：
 * - 保持 `contracts.ts` 既有对外契约稳定（本 spec 只在 `BlueprintGenerationJob`
 *   末尾追加一个可选字段 `checksLedger?: BlueprintChecksLedgerEntry[]`）。
 * - 校验台账类型体量独立（entry / summary / response 三类），放到子模块
 *   便于后续任务 2-5 的 server 实现复用。
 *
 * 对应 spec：
 * - 需求 1.5：支持的 checkType 枚举。
 * - 需求 1.1 / 1.6：Ledger_Entry 必填与可选字段。
 * - 需求 3.6：汇总统计。
 * - 需求 7.1-7.5：数据完整性约束。
 */

import type { BlueprintGenerationStage } from "../contracts.js";

/** 校验类型枚举 */
export type BlueprintCheckType =
  | "schema"
  | "invariant"
  | "content_quality"
  | "test"
  | "merge_gate"
  | "companion_trace"
  | "preview_audit"
  | "brainstorm_deliberation"
  | "brainstorm_impact"
  | "traceability_matrix";

/** 校验结果状态 */
export type BlueprintCheckStatus = "pass" | "fail" | "warn" | "skip";

/** 单条校验台账条目 */
export interface BlueprintChecksLedgerEntry {
  /** 唯一稳定 ID，格式：`chk-{jobId短前缀}-{序号}` */
  id: string;
  /** 关联的 generation job */
  jobId: string;
  /** 管线阶段 */
  stage: BlueprintGenerationStage;
  /** 校验类型 */
  checkType: BlueprintCheckType;
  /** 人类可读校验名称 */
  checkName: string;
  /** 结果状态 */
  status: BlueprintCheckStatus;
  /** 执行校验的模块路径或脚本名称 */
  validator: string;
  /** ISO 8601 触发时间戳 */
  triggeredAt: string;
  /** 脚本退出码（适用时） */
  exitCode?: number;
  /** 校验输出/消息（截断至 4096 字节） */
  output?: string;
  /** 校验耗时（毫秒） */
  durationMs?: number;
  /** 可扩展元数据 */
  metadata?: Record<string, unknown>;
}

/** 校验台账汇总统计 */
export interface BlueprintChecksLedgerSummary {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  skip: number;
}

/** 校验台账查询响应 */
export interface BlueprintChecksLedgerResponse {
  jobId: string;
  entries: BlueprintChecksLedgerEntry[];
  summary: BlueprintChecksLedgerSummary;
}
