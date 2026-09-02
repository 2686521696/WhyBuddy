import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import {
  parseFiveSystemModelFromPerSkillEvidence,
  summarizeClosureForChat,
} from "./system-screens/five-system-model";
import { finalNarrationStep } from "./turn-route-steps";
import type { UiTurn } from "./types";

/**
 * 精修轮叙述空着时的那句实话。
 *
 * 2026-08-18 篮球馆半场预约：四轮精修 turnNarrations 全空，对话却套首轮
 * ``chatSummary``「含 2 角色、3 页面」——说明书改了，页没动。判据看页，
 * 不看产物个数；空着就空着，不许套另一轮的总结。
 */
export const REFINE_TURN_NO_PAGE_NOTE =
  "本轮没有画出新的页面，上一版保留。叙述未留下，不套用首轮总结。";

function textFromNarration(turn: UiTurn): string {
  const finalStepText = finalNarrationStep(turn.steps)?.text?.trim();
  return finalStepText || "";
}

export function assistantTextForTurn(
  turn: UiTurn,
  publishClosure?: PublishClosureSummary | null,
  goalText?: string
): string {
  const assistant = turn.assistant?.trim();
  if (assistant) return assistant;
  const narration = textFromNarration(turn);
  if (narration) return narration;

  const user = (turn.user || "").trim();
  const goal = (goalText || "").trim();
  const isFollowUp = Boolean(user && goal && user !== goal);

  if (isFollowUp) {
    const paint = publishClosure?.refinePaintNote?.trim();
    if (paint) return paint;
    return REFINE_TURN_NO_PAGE_NOTE;
  }

  if (publishClosure) {
    if (publishClosure.chatSummary?.trim())
      return publishClosure.chatSummary.trim();
    const model = parseFiveSystemModelFromPerSkillEvidence(
      publishClosure.perSkillEvidence as Parameters<
        typeof parseFiveSystemModelFromPerSkillEvidence
      >[0]
    );
    return summarizeClosureForChat(model, {
      goalText: turn.user || goalText,
      blocked: !!publishClosure.blocked,
      evidencePresentCount: publishClosure.evidencePresentCount ?? 0,
      skillCount: publishClosure.skillCount ?? 0,
      versionPinsChecked: !!publishClosure.versionPinsChecked,
    });
  }
  return turn.status === "streaming"
    ? "正在整理推演结果..."
    : "本轮已完成，但还没有生成可展示的回答。";
}
