import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
import type { TurnRouteFacts } from "@shared/blueprint/sliderule-turn-route";
import type { NarrationFallbackReason } from "@/lib/sliderule-narrator";

export type WhyArtifact = {
  id: string;
  kind: string;
  capability: V5CapabilityId;
  role: string;
  content: string;
  trustLevel: "untrusted" | "gated_pass" | "audited";
  realLlm?: boolean;
};

/** S8: pure UI progressive slice — not persisted in V5SessionState. */
export type TurnStep =
  | {
      id: string;
      kind: "narration";
      text: string;
      source: "llm" | "fallback";
      isFinal?: boolean;
    }
  | {
      id: string;
      kind: "chip";
      capabilityId: V5CapabilityId;
      roleId: string;
      label: string;
      realLlm: boolean;
      loopTurnId?: string;
      progressType?:
        | "thinking"
        | "acting"
        | "observing"
        | "completed"
        | "failed";
    }
  | {
      id: string;
      kind: "step_narration";
      text: string;
      capabilityId: V5CapabilityId;
      roleId?: string;
      realLlm: boolean;
      loopTurnId?: string;
      capabilityRunId?: string;
      runIndex?: number;
    }
  | {
      id: string;
      kind: "capability_fail";
      capabilityId: V5CapabilityId;
      roleId: string;
      loopTurnId: string;
      capabilityRunId: string;
      runIndex: number;
      message: string;
    }
  | {
      /** 思考流留档（2026-07-10 用户裁决）：推演结束后 LLM 每步的完整
       *  输出保留成可折叠记录（Claude 式），不再随 llmDraft 清空消失。 */
      id: string;
      kind: "llm_output";
      /** 人话标题（"LLM 正在分析风险"→"分析风险"归档态） */
      title: string;
      text: string;
      /** true = 五系统 JSON（代码块面板）；false = 纯文字思考流 */
      formatJson: boolean;
    };

/** Product page turn — progressive conversation (user bubble + step stream). */
export type UiTurn = {
  id: string;
  user: string;
  /** E16 收口句：本轮真实用时（完成时打点；恢复轮取自 turnNarrations） */
  durationMs?: number;
  status: "streaming" | "complete";
  steps: TurnStep[];
  /** S9: runtime-recorded facts for turn-route projection. */
  routeFacts: TurnRouteFacts;
  routeExpanded: boolean;
  routeLitCount: number;
  assistant: string;
  assistantSource: "llm" | "fallback";
  narrationReason?: NarrationFallbackReason;
  main: { artifactId: string; kind: string; realLlm: boolean } | null;
  actions: ActionTrace[];
};

export type SlideRuleExecutorMode =
  | "pilot"
  | "server-llm"
  | "default"
  | "demo"
  | "browser-llm";

/** Extended persisted session state including publishClosure evidence (for frontend session store adapter).
 *  publishClosure?: PublishClosureSummary | null is carried explicitly by useSlideRuleSession adapter + python schema.
 *  Optional for legacy session compat (old sessions missing key load/restore with undefined, no breakage).
 */

/** @deprecated Engineering cockpit only — product page uses UiTurn. */
export type ChatTurn = {
  id: string;
  user: string;
  selected: Array<{ cap: V5CapabilityId; role: string }>;
  reason: string;
  artifacts: WhyArtifact[];
};
