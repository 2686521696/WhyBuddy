/**
 * `blueprint-v4-full-alignment` Module A — 伴随式审查与接地层共享类型。
 *
 * 纯类型，无 runtime 副作用。定义 Critic / Grounding 双角色的输入、输出、
 * 服务接口（R5）。
 */

import type { BlueprintGenerationStage } from "../contracts.js";

/**
 * 单条伴随发现（R5.2）。Critic 与 Grounding 共用此结构。
 */
export interface CompanionFinding {
  id: string;
  role: "critic" | "grounding";
  stage: BlueprintGenerationStage;
  targetArtifactId: string;
  findings: string[];
  severity: "info" | "warn" | "error";
  suggestedActions: string[];
  citations: string[];
  /** Grounding 专用：读取的仓库文件路径 */
  repoFilesRead?: string[];
  timestamp: string;
}

/**
 * 伴随触发上下文（R5.3）。
 */
export interface CompanionTriggerContext {
  jobId: string;
  stage: BlueprintGenerationStage;
  /** 模糊度评分 0-1，Critic 触发依据 */
  fuzzinessScore?: number;
  /** 是否存在真实仓库，Grounding 触发依据 */
  hasRealRepo: boolean;
  riskLevel?: "low" | "medium" | "high";
}

/**
 * 挑刺者服务接口（R5.4）。
 *
 * 对抗独立性（R2.7）：evaluate 只接收最终 artifact，不接收生成方的
 * 推理 / 自辩 / chain-of-thought。
 */
export interface CriticService {
  evaluate(
    ctx: CompanionTriggerContext,
    artifact: unknown,
  ): Promise<CompanionFinding | null>;
}

/**
 * 接地者服务接口（R5.5）。
 */
export interface GroundingService {
  evaluate(
    ctx: CompanionTriggerContext,
    artifact: unknown,
  ): Promise<CompanionFinding | null>;
}

/**
 * 伴随层总服务接口（R5.6）。
 */
export interface CompanionLayerService {
  critic: CriticService;
  grounding: GroundingService;
  evaluateAll(
    ctx: CompanionTriggerContext,
    artifact: unknown,
  ): Promise<CompanionFinding[]>;
}

/**
 * 伴随层策略配置（R17）。纯数据，无方法。
 */
export interface CompanionLayerPolicy {
  fuzzinessThreshold: number;
  maxFindingsPerInvocation: number;
  enableCritic: boolean;
  enableGrounding: boolean;
}
