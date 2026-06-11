import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { goalStatusNarrationLine } from "@shared/blueprint/whybuddy-deliverable-sanitize";

export type NarrationRequest = {
  state: V5SessionState;
  turnId: string;
  userText: string;
  intervention?: { intent?: string } | null;
  selected?: Array<{ capabilityId?: string; roleId?: string }>;
  artifacts?: Array<{ kind?: string; title?: string; summary?: string; realLlm?: boolean }>;
  mainArtifact?: { kind?: string; title?: string; content?: string } | null;
};

export type NarrationResponse = {
  text: string;
  source: "llm" | "fallback";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
};

function localNarrationFallback(req: NarrationRequest): NarrationResponse {
  const analysisCount = req.selected?.length || req.artifacts?.length || 0;
  const challengeHint =
    req.intervention?.intent === "challenge" ? "你提出了质疑，我会据此重新推演。" : "";
  const head = [
    challengeHint,
    `本轮完成了 ${analysisCount} 项分析。`,
    goalStatusNarrationLine(req.state.goal?.status as any),
    "本轮的完整推演材料可通过下方「证据链」查看。",
  ]
    .filter(Boolean)
    .join("\n");

  return { text: head, source: "fallback" };
}

/** Fetch user-facing narration from server; local template if unreachable (no client-side sanitizer). */
export async function fetchNarration(req: NarrationRequest): Promise<NarrationResponse> {
  try {
    const res = await fetch("/api/whybuddy/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) return localNarrationFallback(req);
    const body = (await res.json()) as NarrationResponse;
    if (!body?.text) return localNarrationFallback(req);
    return {
      text: body.text,
      source: body.source === "llm" ? "llm" : "fallback",
      usage: body.usage,
    };
  } catch {
    return localNarrationFallback(req);
  }
}