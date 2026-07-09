import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
import {
  buildActionTrace,
  buildProcessLabelContext,
  getLiveAction,
  inferProcessContextFromExec,
  isExternalProvenance,
  type LiveAction,
} from "@shared/blueprint/capability-process-labels";
import type { CapabilityExecutor } from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { buildStepNarration } from "./step-narration";
import type { TurnStep, WhyArtifact } from "./types";

export type UiCapabilityExecutorContext = {
  userText: string;
  goalText: string;
  /** Legacy: emitImSteps only affects IM surface visibility in caller. Process facts (steps/traces) are now ALWAYS recorded for Flow derive/phase children/liveText (see derive + expand-projection). */
  emitImSteps?: boolean;
  onStep?: (step: TurnStep) => void;
  onCapabilityProgress?: () => void;
  onActionTrace?: (trace: ActionTrace) => void;
  setLiveAction: (action: LiveAction | null) => void;
};

/**
 * Wraps the module CapabilityExecutor with product-page UI step emissions (chips + step narration).
 * Session_Driver owns commitArtifact; this adapter only executes capabilities.
 */
export function createUiCapabilityExecutor(
  base: CapabilityExecutor,
  ctx: UiCapabilityExecutorContext
): CapabilityExecutor {
  let stepSeq = 0;
  return {
    async executeCapability(args) {
      const labelCtx = buildProcessLabelContext(args.capabilityId, ctx.userText, ctx.goalText);
      const live = getLiveAction(args.capabilityId, labelCtx);
      ctx.setLiveAction(live);
      const seq = stepSeq++;
      const roleId = args.roleId || "agent";
      const runId = args.capabilityRunId || `${args.turnId}-run-${seq}`;
      const runIndexMatch = runId.match(/-run-(\d+)$/);
      const runIndex = runIndexMatch ? Number(runIndexMatch[1]) : seq;

      // Always record process facts (chips + narration) for Flow phase projection / derive / liveText.
      // emitImSteps only gates visible IM surface chips (product minimal mode hides IM list; facts still feed canvas Flow nodes).
      if (ctx.onStep) {
        ctx.onStep({
          id: `${args.turnId}-chip-${seq}`,
          kind: "chip",
          capabilityId: args.capabilityId,
          roleId,
          label: live.label,
          realLlm: false,
          loopTurnId: args.turnId,
          progressType: "thinking",
        });
      } else {
        ctx.onCapabilityProgress?.();
      }

      let exec: Awaited<ReturnType<CapabilityExecutor["executeCapability"]>> | null = null;
      let execThrew = false;
      try {
        exec = await base.executeCapability(args);
      } catch (err) {
        execThrew = true;
        if (ctx.onStep) {
          ctx.onStep({
            id: `${args.turnId}-fail-${seq}`,
            kind: "capability_fail",
            capabilityId: args.capabilityId,
            roleId,
            loopTurnId: args.turnId,
            capabilityRunId: runId,
            runIndex,
            message:
              err instanceof Error ? err.message.slice(0, 160) : "能力执行失败，可重试",
          });
        }
      }

      const enrichedCtx = inferProcessContextFromExec(args.capabilityId, labelCtx, exec);
      const trace = buildActionTrace(args.capabilityId, !execThrew, enrichedCtx, exec);
      // Always record action traces for Flow fallback (derive phase from traces when no steps); IM visibility decided by mode at render.
      if (trace) {
        ctx.onActionTrace?.({ ...trace, turnId: args.turnId });
      }

      const realLlm =
        isExternalProvenance(exec?.provenance) ||
        exec?.provenance === "llm" ||
        exec?.provenance === "llm_fallback" ||
        String(exec?.summary || "").includes("server-llm");

      if (ctx.onStep) {
        ctx.onStep({
          id: `${args.turnId}-step-${seq}`,
          kind: "step_narration",
          capabilityId: args.capabilityId,
          roleId,
          realLlm,
          loopTurnId: args.turnId,
          capabilityRunId: runId,
          runIndex,
          text: buildStepNarration({
            capabilityId: args.capabilityId,
            realLlm,
            summary: exec?.summary,
          }),
        });
        ctx.onStep({
          id: `${args.turnId}-chip-done-${seq}`,
          kind: "chip",
          capabilityId: args.capabilityId,
          roleId,
          label: realLlm ? "LLM 推演完成" : "规则推演完成",
          realLlm,
          loopTurnId: args.turnId,
          progressType: execThrew ? "failed" : "completed",
        });
      }

      if (exec) return exec;

      const cap = args.capabilityId;
      let content = `${roleId} 通过 ${cap} 贡献了新洞察/证据/方案`;
      if (cap === "risk.analyze") {
        content = `${roleId} 通过 risk.analyze 贡献了：\n风险：数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）。\n风险：审计风险（权限变更需保留操作者、时间、影响对象）。`;
      } else if (cap === "counter.argue") {
        content = `${roleId} 通过 counter.argue 贡献了：\n反驳：过早引入 ABAC 会增加策略调试成本。\n建议：MVP 先采用 RBAC + scoped data filter，保留策略接口。`;
      }
      return {
        title: content.split("\n")[0]?.slice(0, 80) || cap,
        summary: content.slice(0, 200),
        content,
        provenance: "ai_generated" as const,
      };
    },
  };
}

export function mapArtifactsToWhyArtifacts(
  state: V5SessionState,
  artifactIds: string[]
): WhyArtifact[] {
  const stale = new Set(state.staleArtifactIds || []);
  const out: WhyArtifact[] = [];
  for (const id of artifactIds) {
    const art = (state.artifacts || []).find((a) => a.id === id);
    if (!art?.producedBy?.capabilityId) continue;
    const cap = art.producedBy.capabilityId as V5CapabilityId;
    const realLlm =
      isExternalProvenance(art.provenance) ||
      art.provenance === "llm" ||
      art.provenance === "llm_fallback";
    out.push({
      id: art.id,
      kind: art.kind,
      capability: cap,
      role: art.producedBy.roleId || "agent",
      content: art.content || "",
      trustLevel: stale.has(art.id)
        ? "untrusted"
        : (art.trustLevel as WhyArtifact["trustLevel"]),
      realLlm,
    });
  }
  return out;
}