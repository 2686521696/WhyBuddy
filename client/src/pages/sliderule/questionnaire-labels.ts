/**
 * 问卷交卷后左栏那句用户气泡：实时（useSlideRuleSession）和刷新回放（derive-persisted-turn）共用。
 *
 * ⚠ 2026-10-07 真机 r74 sr-20261007095028-3014GBNNDM：点了「别再问了，直接开始」，实时气泡是这句；
 *   刷新后回放读日志行的 text——那是写给模型的回喂（user_questions.format_skip_interview）：
 *   「用户让你别再问了，按现在知道的直接开始。不要再调问答工具。」用户看到自己「说」了一句给模型的指令。
 *   两条路各写一份，回放那份漏了按 outcome 认（CLAUDE.md §四）。
 */
export const SKIP_INTERVIEW_TEXT = "别再问了，直接开始";
export const CANCELLED_TEXT = "这些我不答，你自己定";

/** 没有可列的答案时，按 outcome 给人话；认不出就返回空串，由调用方决定退路。 */
export function questionnaireOutcomeText(outcome: unknown): string {
  if (outcome === "skip_interview" || outcome === "skip") return SKIP_INTERVIEW_TEXT;
  if (outcome === "cancelled") return CANCELLED_TEXT;
  return "";
}
