import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
import type { TurnRouteFacts } from "@shared/blueprint/whybuddy-turn-route";
import type { NarrationFallbackReason } from "@/lib/whybuddy-narrator";

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
      progressType?: "thinking" | "acting" | "observing" | "completed" | "failed";
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
    };

/** Product page turn — progressive conversation (user bubble + step stream). */
export type UiTurn = {
  id: string;
  user: string;
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

export type WhyBuddyExecutorMode = "pilot" | "server-llm" | "default";

/** @deprecated Engineering cockpit only — product page uses UiTurn. */
export type ChatTurn = {
  id: string;
  user: string;
  selected: Array<{ cap: V5CapabilityId; role: string }>;
  reason: string;
  artifacts: WhyArtifact[];
};