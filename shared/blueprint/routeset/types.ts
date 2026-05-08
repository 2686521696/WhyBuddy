/**
 * 子域 5：RouteSet & SPEC Tree 的类型出口。
 *
 * 当前采用 re-export 视图（方案 B）。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.1（子域 5 路由：`/jobs/:id/route-selection`、`/spec-tree`、`/spec-tree/nodes/:nodeId`、`/spec-tree/actions`、`/spec-tree/versions`）
 * - 需求 2.4、4.1、4.3、4.4、6.3
 */

export type {
  // RouteSet
  BlueprintRouteCandidate,
  BlueprintRouteComplexity,
  BlueprintRouteCostLevel,
  BlueprintRouteKind,
  BlueprintRouteRiskLevel,
  BlueprintRouteSelection,
  BlueprintRouteSelectionRequest,
  BlueprintRouteSet,
  BlueprintRouteStep,
  // SPEC Tree 与节点
  BlueprintSpecTree,
  BlueprintSpecTreeActionRequest,
  BlueprintSpecTreeActionResponse,
  BlueprintSpecTreeActionType,
  BlueprintSpecTreeNode,
  BlueprintSpecTreeNodeStatus,
  BlueprintSpecTreeNodeType,
  BlueprintSpecTreeStatus,
  BlueprintSpecTreeVersionSnapshot,
  BlueprintUpdateSpecTreeNodeRequest,
  BlueprintUpdateSpecTreeNodeResponse,
  // 响应
  BlueprintResetRouteSelectionResponse,
  BlueprintSaveSpecTreeVersionResponse,
  BlueprintSelectRouteResponse,
} from "../contracts.js";
