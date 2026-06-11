import type { V5CapabilityId } from "@shared/blueprint/contracts";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";
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

/** Product page turn — pure conversation (user bubble + assistant prose). */
export type UiTurn = {
  id: string;
  user: string;
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