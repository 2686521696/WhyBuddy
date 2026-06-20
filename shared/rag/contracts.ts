/**
 * RAG Pipeline 步骤链契约
 *
 * 从 rbac-system-pc/backend/src/ai/rag/ 迁移并改造。
 * 原版依赖 Sequelize + Milvus SDK，此版改为纯接口，
 * 适配 sliderule 的本地向量存储和浏览器/服务端双运行时。
 *
 * 使用场景：
 * - vector-db-rag-pipeline: 完整 RAG 管道实现
 * - knowledge-graph: 图谱检索步骤可作为 Pipeline Step 注册
 * - memory-system: 中期记忆检索可复用 Retrieve 步骤
 */

// ---------------------------------------------------------------------------
// Pipeline 上下文（从 rbac-system-pc PipelineContext 迁移）
// ---------------------------------------------------------------------------

export interface RAGRetrievedDoc {
  content: string;
  score: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface RAGPipelineContext {
  /** 输入 */
  query?: string;
  fileContent?: string;
  filePath?: string;
  agentId?: string;
  workflowId?: string;
  missionId?: string;

  /** 中间状态 */
  parsedText?: string;
  chunks?: string[];
  vectors?: number[][];
  retrievedDocs?: RAGRetrievedDoc[];

  /** 输出 */
  answer?: string;
  sources?: RAGRetrievedDoc[];

  /** 错误 */
  error?: string;

  /** 元数据（步骤间传递的额外信息） */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pipeline 步骤接口（从 rbac-system-pc IPipelineStep 迁移）
// ---------------------------------------------------------------------------

export interface IRAGPipelineStep {
  /** 步骤名称（如 "parse"、"chunk"、"embed"、"store"、"retrieve"、"generate"） */
  readonly name: string;
  /** 执行步骤，接收上下文并返回更新后的上下文 */
  execute(ctx: RAGPipelineContext): Promise<RAGPipelineContext>;
}

// ---------------------------------------------------------------------------
// Pipeline 配置
// ---------------------------------------------------------------------------

export const RAG_STEP_TYPES = [
  "parse",      // 文档解析（PDF/Word/Excel/HTML → 纯文本）
  "chunk",      // 文本分片（按段落/句子/固定长度）
  "embed",      // 向量化（调用 embedding 模型）
  "store",      // 存储（写入向量库）
  "retrieve",   // 检索（从向量库查询 topK）
  "rerank",     // 重排序（可选，对检索结果二次排序）
  "generate",   // 生成（基于检索结果调用 LLM 生成答案）
] as const;

export type RAGStepType = (typeof RAG_STEP_TYPES)[number];

export interface RAGStepConfig {
  type: RAGStepType;
  options?: Record<string, unknown>;
}

export interface RAGPipelineConfig {
  /** 管道名称 */
  name: string;
  /** 步骤序列 */
  steps: RAGStepConfig[];
}

// ---------------------------------------------------------------------------
// Pipeline 执行结果
// ---------------------------------------------------------------------------

export interface RAGStepLog {
  stepName: string;
  stepType: RAGStepType;
  durationMs: number;
  status: "success" | "failed" | "skipped";
  error?: string;
  /** 步骤产出的中间数据摘要（如 chunk 数量、检索结果数量） */
  summary?: string;
}

export interface RAGPipelineResult {
  status: "completed" | "failed";
  answer?: string;
  sources?: RAGRetrievedDoc[];
  logs: RAGStepLog[];
  totalDurationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Pipeline 步骤注册表
// ---------------------------------------------------------------------------

export type RAGStepFactory = (options?: Record<string, unknown>) => IRAGPipelineStep;

export interface IRAGStepRegistry {
  /** 注册步骤工厂 */
  register(type: RAGStepType, factory: RAGStepFactory): void;
  /** 创建步骤实例 */
  create(config: RAGStepConfig): IRAGPipelineStep;
  /** 检查是否已注册 */
  has(type: RAGStepType): boolean;
  /** 列出所有已注册类型 */
  list(): RAGStepType[];
}

// ---------------------------------------------------------------------------
// 向量库抽象接口（从 rbac-system-pc VectorDbService 简化）
// ---------------------------------------------------------------------------

export interface VectorRecord {
  id: string;
  vector: number[];
  content: string;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface IVectorStore {
  /** 插入向量记录 */
  insert(collection: string, records: VectorRecord[]): Promise<void>;
  /** 语义搜索 */
  search(collection: string, queryVector: number[], topK: number): Promise<VectorSearchResult[]>;
  /** 删除记录 */
  delete(collection: string, ids: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// 现有实现的适配说明
// ---------------------------------------------------------------------------

/**
 * 当前 sliderule 的映射关系：
 *
 * IVectorStore.search()  → VectorStore.searchMemorySummaries() (现有 96 维本地向量)
 * IVectorStore.insert()  → VectorStore.upsertMemorySummary() (现有)
 *
 * 未来升级路径：
 * - 本地模式：继续使用现有 VectorStore（96 维 token hash）
 * - 生产模式：替换为 Milvus/pgvector 适配器，实现 IVectorStore 接口
 * - 两者通过 IVectorStore 接口统一，上层 RAG Pipeline 无感切换
 */

// ===========================================================================
// RAG 管道数据模型契约（vector-db-rag-pipeline）
// ===========================================================================

export const RAG_CONTRACT_VERSION = '2025-01-01' as const;

export const SOURCE_TYPES = [
  'task_result',
  'code_snippet',
  'conversation',
  'mission_log',
  'document',
  'architecture_decision',
  'bug_report',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

// ---------------------------------------------------------------------------
// 摄入层类型
// ---------------------------------------------------------------------------

export interface IngestionPayload {
  sourceType: SourceType;
  sourceId: string;
  projectId: string;
  content: string;
  metadata: Record<string, any>;
  timestamp: string;       // ISO 8601
  agentId?: string;
}

// ---------------------------------------------------------------------------
// 分块层类型
// ---------------------------------------------------------------------------

export interface ChunkMetadata {
  // 通用字段
  ingestedAt: string;
  lastAccessedAt: string;
  contentHash: string;
  // 代码专用字段
  codeLanguage?: string;
  functionSignature?: string;
  imports?: string[];
  // 对话专用字段
  turnIndex?: number;
  speaker?: string;
}

export interface ChunkRecord {
  chunkId: string;          // `${sourceType}:${sourceId}:${chunkIndex}`
  sourceType: SourceType;
  sourceId: string;
  projectId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: ChunkMetadata;
}

// ---------------------------------------------------------------------------
// 检索层类型
// ---------------------------------------------------------------------------

export interface RetrievalResult {
  chunkId: string;
  score: number;
  content: string;
  sourceType: SourceType;
  sourceId: string;
  metadata: ChunkMetadata;
  highlight?: string;
  totalCandidates: number;
}

// ---------------------------------------------------------------------------
// 增强层类型
// ---------------------------------------------------------------------------

export interface RAGAugmentationLog {
  logId: string;
  taskId: string;
  agentId: string;
  projectId: string;
  mode: 'auto' | 'on_demand' | 'disabled';
  retrievedChunkIds: string[];
  injectedChunkIds: string[];
  prunedChunkIds: string[];
  tokenUsage: number;
  latencyMs: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// 摄入失败暂存类型
// ---------------------------------------------------------------------------

export interface DeadLetterEntry {
  entryId: string;
  payload: IngestionPayload;
  error: string;
  failedAt: string;
  retryCount: number;
  stage: 'clean' | 'chunk' | 'embed' | 'store' | 'metadata';
}

// ---------------------------------------------------------------------------
// 反馈层类型
// ---------------------------------------------------------------------------

export interface FeedbackRecord {
  feedbackId: string;
  taskId: string;
  agentId: string;
  projectId: string;
  helpfulChunkIds: string[];
  irrelevantChunkIds: string[];
  missingContext?: string;
  utilizationRate: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// 生命周期管理类型
// ---------------------------------------------------------------------------

export interface LifecycleLog {
  logId: string;
  operation: 'archive' | 'delete' | 'orphan_cleanup' | 'promote' | 'purge';
  affectedCount: number;
  collection: string;
  executedAt: string;
  durationMs: number;
  details?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Python Contract Slice: RAG Ingestion Runtime
// ---------------------------------------------------------------------------

export const RAG_INGESTION_PYTHON_RUNTIME_CONTRACT_VERSION =
  "rag-ingestion.runtime.v1" as const;

export type RAGIngestionPythonRuntimeOperation =
  | "ingest"
  | "chunk"
  | "embed"
  | "upsert"
  | "delete";

export type RAGIngestionPythonRuntimeStatus =
  | "completed"
  | "failed"
  | "unavailable";

export interface RAGIngestionPythonRuntimeError {
  code: string;
  message: string;
  retryable: boolean;
  field?: string;
}

export interface RAGIngestionPythonRuntimeProvenance {
  provider: string;
  source: string;
  auditId?: string;
  [key: string]: unknown;
}

export interface RAGIngestionPythonRuntimeLifecycle {
  state: string;
  archiveAfterDays?: number;
  deleteAfterDays?: number;
  [key: string]: unknown;
}

export interface RAGIngestionPythonRuntimeFeedback {
  helpfulChunkIds: string[];
  irrelevantChunkIds: string[];
  missingContext?: string;
  [key: string]: unknown;
}

export interface RAGIngestionPythonRuntimeDeadLetter {
  entryId: string;
  retryCount: number;
  stage: DeadLetterEntry["stage"];
  error: string;
  [key: string]: unknown;
}

export interface RAGIngestionPythonRuntimeIngest {
  accepted: boolean;
  chunkCount: number;
  deduplicated: boolean;
  contentHash: string;
}

export interface RAGIngestionPythonRuntimeEmbedding {
  chunkId: string;
  provider: "fake-contract-embedding";
  model: "fake-rag-ingestion-v1";
  dimension: number;
  vector: number[];
}

export interface RAGIngestionPythonRuntimeUpsert {
  collection: string;
  attempted: boolean;
  stored: false;
  upsertedCount: 0;
  recordIds: string[];
}

export interface RAGIngestionPythonRuntimeDelete {
  collection: string;
  attempted: boolean;
  deleted: false;
  deletedCount: 0;
  targetIds: string[];
}

interface RAGIngestionPythonRuntimeBaseResult {
  contractVersion: typeof RAG_INGESTION_PYTHON_RUNTIME_CONTRACT_VERSION;
  runtime: "python-contract";
  operation: RAGIngestionPythonRuntimeOperation;
  ok: boolean;
  status: RAGIngestionPythonRuntimeStatus;
  ingestionId: string;
  projectId: string;
  sourceType: SourceType;
  sourceId: string;
  storage: "contract-only";
  migratedStorage: false;
  provenance: RAGIngestionPythonRuntimeProvenance;
  lifecycle: RAGIngestionPythonRuntimeLifecycle;
  feedback: RAGIngestionPythonRuntimeFeedback;
  deadLetter?: RAGIngestionPythonRuntimeDeadLetter;
}

export type RAGIngestionPythonRuntimeCompletedResult =
  | (RAGIngestionPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "ingest";
      ingest: RAGIngestionPythonRuntimeIngest;
    })
  | (RAGIngestionPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "chunk";
      chunks: ChunkRecord[];
    })
  | (RAGIngestionPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "embed";
      embeddings: RAGIngestionPythonRuntimeEmbedding[];
    })
  | (RAGIngestionPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "upsert";
      upsert: RAGIngestionPythonRuntimeUpsert;
    })
  | (RAGIngestionPythonRuntimeBaseResult & {
      ok: true;
      status: "completed";
      operation: "delete";
      delete: RAGIngestionPythonRuntimeDelete;
    });

export type RAGIngestionPythonRuntimeFailureResult =
  RAGIngestionPythonRuntimeBaseResult & {
    ok: false;
    status: "failed" | "unavailable";
    error: RAGIngestionPythonRuntimeError;
  };

export type RAGIngestionPythonRuntimeResult =
  | RAGIngestionPythonRuntimeCompletedResult
  | RAGIngestionPythonRuntimeFailureResult;

const RAG_INGESTION_PYTHON_RUNTIME_OPERATIONS: readonly RAGIngestionPythonRuntimeOperation[] = [
  "ingest",
  "chunk",
  "embed",
  "upsert",
  "delete",
];

const RAG_INGESTION_PYTHON_RUNTIME_STATUSES: readonly RAGIngestionPythonRuntimeStatus[] = [
  "completed",
  "failed",
  "unavailable",
];

export function isRAGIngestionPythonRuntimeResult(
  value: unknown,
): value is RAGIngestionPythonRuntimeResult {
  const record = ragIngestionAsRecord(value);
  if (!record) return false;
  if (record.contractVersion !== RAG_INGESTION_PYTHON_RUNTIME_CONTRACT_VERSION) return false;
  if (record.runtime !== "python-contract") return false;
  if (!ragIngestionOneOf(record.operation, RAG_INGESTION_PYTHON_RUNTIME_OPERATIONS)) {
    return false;
  }
  if (!ragIngestionOneOf(record.status, RAG_INGESTION_PYTHON_RUNTIME_STATUSES)) {
    return false;
  }
  if (!ragIngestionNonEmptyString(record.ingestionId)) return false;
  if (!ragIngestionNonEmptyString(record.projectId)) return false;
  if (!ragIngestionOneOf(record.sourceType, SOURCE_TYPES)) return false;
  if (!ragIngestionNonEmptyString(record.sourceId)) return false;
  if (record.storage !== "contract-only" || record.migratedStorage !== false) return false;
  if (!isRAGIngestionRuntimeProvenance(record.provenance)) return false;
  if (!isRAGIngestionRuntimeLifecycle(record.lifecycle)) return false;
  if (!isRAGIngestionRuntimeFeedback(record.feedback)) return false;
  if (record.deadLetter !== undefined && !isRAGIngestionRuntimeDeadLetter(record.deadLetter)) {
    return false;
  }

  if (record.status === "failed" || record.status === "unavailable") {
    return (
      record.ok === false &&
      isRAGIngestionRuntimeError(record.error) &&
      !hasAnyRAGIngestionRuntimePayload(record)
    );
  }

  if (record.ok !== true || record.error !== undefined) return false;
  if (!hasOnlyExpectedRAGIngestionRuntimePayload(record, record.operation)) return false;

  if (record.operation === "ingest") return isRAGIngestionRuntimeIngest(record.ingest);
  if (record.operation === "chunk") {
    return Array.isArray(record.chunks) && record.chunks.every(isRAGIngestionRuntimeChunk);
  }
  if (record.operation === "embed") {
    return (
      Array.isArray(record.embeddings) &&
      record.embeddings.every(isRAGIngestionRuntimeEmbedding)
    );
  }
  if (record.operation === "upsert") return isRAGIngestionRuntimeUpsert(record.upsert);
  return isRAGIngestionRuntimeDelete(record.delete);
}

function isRAGIngestionRuntimeProvenance(
  value: unknown,
): value is RAGIngestionPythonRuntimeProvenance {
  const provenance = ragIngestionAsRecord(value);
  return (
    provenance !== null &&
    ragIngestionNonEmptyString(provenance.provider) &&
    ragIngestionNonEmptyString(provenance.source) &&
    (provenance.auditId === undefined || ragIngestionNonEmptyString(provenance.auditId))
  );
}

function isRAGIngestionRuntimeLifecycle(
  value: unknown,
): value is RAGIngestionPythonRuntimeLifecycle {
  const lifecycle = ragIngestionAsRecord(value);
  if (!lifecycle || !ragIngestionNonEmptyString(lifecycle.state)) return false;
  if (lifecycle.archiveAfterDays !== undefined && !ragIngestionNonNegativeNumber(lifecycle.archiveAfterDays)) {
    return false;
  }
  if (lifecycle.deleteAfterDays !== undefined && !ragIngestionNonNegativeNumber(lifecycle.deleteAfterDays)) {
    return false;
  }
  return true;
}

function isRAGIngestionRuntimeFeedback(
  value: unknown,
): value is RAGIngestionPythonRuntimeFeedback {
  const feedback = ragIngestionAsRecord(value);
  if (!feedback) return false;
  if (!ragIngestionStringArray(feedback.helpfulChunkIds)) return false;
  if (!ragIngestionStringArray(feedback.irrelevantChunkIds)) return false;
  if (feedback.missingContext !== undefined && !ragIngestionNonEmptyString(feedback.missingContext)) {
    return false;
  }
  return true;
}

function isRAGIngestionRuntimeDeadLetter(
  value: unknown,
): value is RAGIngestionPythonRuntimeDeadLetter {
  const deadLetter = ragIngestionAsRecord(value);
  return (
    deadLetter !== null &&
    ragIngestionNonEmptyString(deadLetter.entryId) &&
    ragIngestionNonNegativeNumber(deadLetter.retryCount) &&
    ragIngestionOneOf(deadLetter.stage, ["clean", "chunk", "embed", "store", "metadata"] as const) &&
    ragIngestionNonEmptyString(deadLetter.error)
  );
}

function isRAGIngestionRuntimeError(
  value: unknown,
): value is RAGIngestionPythonRuntimeError {
  const error = ragIngestionAsRecord(value);
  return (
    error !== null &&
    ragIngestionNonEmptyString(error.code) &&
    ragIngestionNonEmptyString(error.message) &&
    typeof error.retryable === "boolean" &&
    (error.field === undefined || ragIngestionNonEmptyString(error.field))
  );
}

function isRAGIngestionRuntimeIngest(
  value: unknown,
): value is RAGIngestionPythonRuntimeIngest {
  const ingest = ragIngestionAsRecord(value);
  return (
    ingest !== null &&
    typeof ingest.accepted === "boolean" &&
    ragIngestionNonNegativeNumber(ingest.chunkCount) &&
    typeof ingest.deduplicated === "boolean" &&
    ragIngestionNonEmptyString(ingest.contentHash)
  );
}

function isRAGIngestionRuntimeChunk(value: unknown): value is ChunkRecord {
  const chunk = ragIngestionAsRecord(value);
  if (!chunk) return false;
  if (!ragIngestionNonEmptyString(chunk.chunkId)) return false;
  if (!ragIngestionOneOf(chunk.sourceType, SOURCE_TYPES)) return false;
  if (!ragIngestionNonEmptyString(chunk.sourceId)) return false;
  if (!ragIngestionNonEmptyString(chunk.projectId)) return false;
  if (!ragIngestionNonNegativeNumber(chunk.chunkIndex)) return false;
  if (!ragIngestionNonEmptyString(chunk.content)) return false;
  if (!ragIngestionNonNegativeNumber(chunk.tokenCount)) return false;
  const metadata = ragIngestionAsRecord(chunk.metadata);
  return (
    metadata !== null &&
    ragIngestionNonEmptyString(metadata.ingestedAt) &&
    ragIngestionNonEmptyString(metadata.lastAccessedAt) &&
    ragIngestionNonEmptyString(metadata.contentHash)
  );
}

function isRAGIngestionRuntimeEmbedding(
  value: unknown,
): value is RAGIngestionPythonRuntimeEmbedding {
  const embedding = ragIngestionAsRecord(value);
  if (!embedding) return false;
  if (!ragIngestionNonEmptyString(embedding.chunkId)) return false;
  if (embedding.provider !== "fake-contract-embedding") return false;
  if (embedding.model !== "fake-rag-ingestion-v1") return false;
  if (!ragIngestionPositiveNumber(embedding.dimension)) return false;
  if (!Array.isArray(embedding.vector)) return false;
  if (embedding.vector.length !== embedding.dimension) return false;
  return embedding.vector.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isRAGIngestionRuntimeUpsert(
  value: unknown,
): value is RAGIngestionPythonRuntimeUpsert {
  const upsert = ragIngestionAsRecord(value);
  return (
    upsert !== null &&
    ragIngestionNonEmptyString(upsert.collection) &&
    typeof upsert.attempted === "boolean" &&
    upsert.stored === false &&
    upsert.upsertedCount === 0 &&
    ragIngestionStringArray(upsert.recordIds)
  );
}

function isRAGIngestionRuntimeDelete(
  value: unknown,
): value is RAGIngestionPythonRuntimeDelete {
  const deleted = ragIngestionAsRecord(value);
  return (
    deleted !== null &&
    ragIngestionNonEmptyString(deleted.collection) &&
    typeof deleted.attempted === "boolean" &&
    deleted.deleted === false &&
    deleted.deletedCount === 0 &&
    ragIngestionStringArray(deleted.targetIds)
  );
}

function hasAnyRAGIngestionRuntimePayload(record: Record<string, unknown>): boolean {
  return ["ingest", "chunks", "embeddings", "upsert", "delete"].some(
    (field) => record[field] !== undefined,
  );
}

function hasOnlyExpectedRAGIngestionRuntimePayload(
  record: Record<string, unknown>,
  operation: RAGIngestionPythonRuntimeOperation,
): boolean {
  const expected = {
    ingest: "ingest",
    chunk: "chunks",
    embed: "embeddings",
    upsert: "upsert",
    delete: "delete",
  }[operation];
  return ["ingest", "chunks", "embeddings", "upsert", "delete"].every(
    (field) => (field === expected ? record[field] !== undefined : record[field] === undefined),
  );
}

function ragIngestionAsRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function ragIngestionNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ragIngestionStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(ragIngestionNonEmptyString);
}

function ragIngestionNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function ragIngestionPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function ragIngestionOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && options.includes(value as T);
}
