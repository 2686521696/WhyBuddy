/**
 * model-speech — 模型动手之前说的那段话，按段落呈现。
 *
 * ## 修的是什么（2026-09-13，对照 Manus 截图 + 真机代码）
 *
 * 用户指出「页面没跟上，逻辑是有了」。逐跳核对下来，差的不是能力是呈现：
 *
 *     Manus  「我会采用浅蓝工作台 + 白色卡片 + 橙色优先级作为视觉方向，
 *              接着初始化项目并把核心页面做成可交互的单页客服工作台。」
 *              ——每组动作前面一段第一人称的「要做什么、为什么」
 *
 *     我们    「第 1 轮 · 正在执行 planning」
 *              ——机器味的阶段标签，看不出它在想什么
 *
 * 而模型**本来就在产**那段话。`rehearsal_control` 每一轮拿到的 `content`
 * 会进喂给 LLM 的 `assistant_msg`，但原来只有「还没定产品主题 **且** 这批
 * 工具里有 ask_user_question」才 `yield control_text`——工程模式两个条件
 * 都不成立，于是那段话一个字都没到界面上。生成侧已放宽，这里是消费侧。
 *
 * ## 为什么单独一个 kind，而不是塞进 narration
 *
 * `narration` 会被 `stage-authority.linesFromTurnSteps` 收进左栏活动列表。
 * 模型散文进去就跟「指令已接收 · 启动推理」同等分量地排成一行，正是要修
 * 的那个观感。`model_speech` 不被 `textFromStep` / `linesFromTurnSteps`
 * 认领，所以只在正文里以段落出现——**不会双渲染**。
 *
 * ⚠ 也不影响收尾文字：`assistantTextForTurn` 走的是
 * `finalNarrationStep`，那个只认 `isFinal: true` 的 narration。
 */

import { OPERATOR_SPEAK } from "./assistant-text-for-turn";
import type { TurnStep, UiTurn } from "./types";

export type ModelSpeech = Extract<TurnStep, { kind: "model_speech" }>;

/**
 * 这段话值不值得作为「开口」摆给用户。
 *
 * ⚠ 判据盯**语义**不盯字面长度：空白、纯标点、以及模型复述控制面命令的那
 * 几句都不是对用户说的话。其余一律放行——替模型裁剪它想说什么，是另一种
 * 「端出成功但内容为空」。
 */
export function isUserFacingSpeech(text: unknown): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (OPERATOR_SPEAK.test(value)) return false;
  // 纯标点/符号（模型偶发吐出的 "..."、"—"）不是开口。
  return /[\p{L}\p{N}]/u.test(value);
}

/** 本轮模型说过的话，按发生顺序。 */
export function modelSpeechFor(turn: UiTurn | null | undefined): ModelSpeech[] {
  const steps = turn?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.filter(
    (step): step is ModelSpeech =>
      !!step && step.kind === "model_speech" && isUserFacingSpeech(step.text)
  );
}

/**
 * 相邻重复的开口合成一条。
 *
 * ⚠ 只合**逐字相同且相邻**的。通用去重会抹掉真实信息：模型在两组动作之间
 * 说同一句「继续修正类型错误」可能真的是两次修正。这条纪律跟
 * `turn-continuation` 里「同一条路线不许说两遍、但逐页画三次要留」同源。
 */
export function dedupeAdjacentSpeech(items: ModelSpeech[]): ModelSpeech[] {
  const out: ModelSpeech[] = [];
  for (const item of items) {
    const previous = out[out.length - 1];
    if (previous && previous.text.trim() === item.text.trim()) continue;
    out.push(item);
  }
  return out;
}

/** 正文要渲染的那批（过滤 + 相邻去重），一步到位。 */
export function renderableModelSpeech(
  turn: UiTurn | null | undefined
): ModelSpeech[] {
  return dedupeAdjacentSpeech(modelSpeechFor(turn));
}
