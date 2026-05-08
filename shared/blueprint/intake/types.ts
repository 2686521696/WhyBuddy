/**
 * 子域 1：Intake & Project Context 的类型出口。
 *
 * 这个文件当前是对 `../contracts.ts` 的视图 re-export（方案 B），
 * 目的：让下游 SDK / 服务端按子域 import 类型，而不依赖 1995 行的 `contracts.ts` 物理布局。
 *
 * 一旦物理迁移（方案 A）启动，这里的 re-export 会逐步被本地类型定义替换。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.1（子域 1 路由：`/specs`、`/capabilities`、`/intake`、`/intake/:id`、`/projects/:projectId/context`）
 * - 需求 2.4、6.3（按子域重新组织类型，保留向后兼容）
 */

export type {
  // GitHub 源与 domain 资产
  BlueprintGithubSource,
  BlueprintGithubSourceKind,
  BlueprintDomainAsset,
  BlueprintDomainAssetKind,
  BlueprintDomainEvidence,
  BlueprintDomainEvidenceKind,
  BlueprintProjectDomainContext,
  // Intake 请求与实体
  BlueprintIntakeRequest,
  BlueprintIntake,
} from "../contracts.js";
