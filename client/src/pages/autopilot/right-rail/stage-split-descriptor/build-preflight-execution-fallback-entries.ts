/**
 * `buildPreflightExecutionFallbackEntries` — physical relocation from
 * `AutopilotRoutePage.tsx`.
 *
 * 这是 `.kiro/specs/spec-first-stage-process-artifact-split-uniform/` 任务 1.2a
 * 的一部分（来自原 Batch 3.2，提前到 Batch 1）。后续 `useStageSplitDescriptor`
 * 与 `<StageSplitMount>` 都需要从 `right-rail/` 子树消费这个函数；若继续内联
 * 在 `AutopilotRoutePage.tsx` 内，会形成
 * `right-rail/` → `AutopilotRoutePage.tsx` → `right-rail/StageSplitMount` 的循环。
 *
 * 严格契约：
 * - 行为 bit-for-bit 与原 `AutopilotRoutePage.tsx` 中的版本一致：函数体、入
 *   参形状、返回形状均**未做任何修改**；本任务只完成物理迁移。
 * - 本模块**不**从 `AutopilotRoutePage.tsx` import 任何符号：所需的 `t()`
 *   helper 内联（与原文件完全相同的 `(locale, zh, en)` 二选一签名）；
 *   `copyDynamic` 从 sibling `@/pages/autopilot/copy-dynamic` 消费——同一份字典
 *   被 page 与本模块共享。
 *
 * 对应需求：1.3
 */

import type { AppLocale } from "@/lib/locale";
import type {
  BlueprintClarificationReadiness,
  BlueprintClarificationSession,
  BlueprintIntake,
  BlueprintRouteSelection,
  BlueprintRouteSet,
} from "@shared/blueprint/contracts";

import { copyDynamic } from "@/pages/autopilot/copy-dynamic";

import type { ProcessArtifactFallbackExecutionEntry } from "../ProcessArtifactSplitPanel";

/**
 * preflight 四段 sub-stage 的字面集合。该类型同样作为
 * `buildPreflightArtifactEntries` 的 `sub` 入参字面联合使用。
 */
export type PreflightExecutionFallbackSub =
  | "target_input"
  | "intake_created"
  | "clarification"
  | "route";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

export function buildPreflightExecutionFallbackEntries({
  sub,
  locale,
  intake,
  clarificationSession,
  readiness,
  routeSet,
  selection,
}: {
  sub: PreflightExecutionFallbackSub;
  locale: AppLocale;
  intake: BlueprintIntake | null;
  clarificationSession: BlueprintClarificationSession | null;
  readiness: BlueprintClarificationReadiness | undefined;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
}): ProcessArtifactFallbackExecutionEntry[] {
  if (sub === "intake_created" && intake) {
    return [
      {
        id: `preflight-intake-${intake.id}`,
        stageId: "intake_created",
        timestamp: intake.updatedAt ?? intake.createdAt,
        text: t(
          locale,
          `输入记录已创建，来源 ${intake.sources.length} 个，证据 ${intake.evidence.length} 条，资产 ${intake.assets.length} 个。`,
          `Intake record created with ${intake.sources.length} source(s), ${intake.evidence.length} evidence item(s), and ${intake.assets.length} asset(s).`
        ),
      },
    ];
  }

  if (sub === "clarification" && clarificationSession) {
    const requiredTotal =
      readiness?.requiredTotal ??
      clarificationSession.questions.filter((question) => question.required).length;
    const answeredRequired =
      readiness?.answeredRequired ??
      clarificationSession.answers.filter((answer) =>
        clarificationSession.questions.some(
          (question) => question.required && question.id === answer.questionId
        )
      ).length;
    return [
      {
        id: `preflight-clarification-${clarificationSession.id}`,
        stageId: "clarification",
        timestamp: clarificationSession.updatedAt ?? clarificationSession.createdAt,
        text: t(
          locale,
          `澄清已提交，已回答 ${clarificationSession.answers.length}/${clarificationSession.questions.length}，必答 ${answeredRequired}/${requiredTotal}。`,
          `Clarification submitted with ${clarificationSession.answers.length}/${clarificationSession.questions.length} answered and ${answeredRequired}/${requiredTotal} required.`
        ),
      },
    ];
  }

  if (sub === "route" && routeSet) {
    const selectedTitle = selection?.routeTitle ?? selection?.routeId;
    return [
      {
        id: `preflight-route-${routeSet.id}-${selection?.routeId ?? "generated"}`,
        stageId: "route_generation",
        timestamp: routeSet.createdAt,
        text: selectedTitle
          ? t(
              locale,
              `路线已选择：${copyDynamic(locale, selectedTitle)}，RouteSet 包含 ${routeSet.routes.length} 条候选路线。`,
              `Route selected: ${copyDynamic(locale, selectedTitle)}. RouteSet includes ${routeSet.routes.length} candidate route(s).`
            )
          : t(
              locale,
              `RouteSet 已生成，包含 ${routeSet.routes.length} 条候选路线，等待选择主路线。`,
              `RouteSet generated with ${routeSet.routes.length} candidate route(s), waiting for route selection.`
            ),
      },
    ];
  }

  return [];
}
