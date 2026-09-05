/**
 * 「这一轮是上一跳的续跑，不是新话题」。
 *
 * ## 修的是什么（2026-09-05 真机 + 用户裁决）
 *
 * 伴随式澄清的设计是：**停住 → 人选 → 注入 → 接着跑**。后端那半是好的
 * （`spec_first_pipeline._emit_assumptions` 出卡就 `hold_current()`，日志里
 * 「SPEC 已出，停住等人选完再继续」一次不落，也没有过一次「位子没挂上」）。
 *
 * 坏在最后一格：放行只能让**当前这一跳**跑完。因为 2026-09-02 拍板的
 * 「一跳一件」（`7afc6a9`：开始推演只点火 spec），要接着画页面就只能再开
 * 一轮——前端于是在放行的同时排了一句「假设已确认。继续画页面。」。
 *
 * 那句话是一轮新的 runTurn，而**每一轮都从头演一遍开场**：
 *
 *     指令已接收 · 启动推理          ← 入站
 *     编排 pages → structure → bind  ← 又编排一次
 *     第 1 轮 · 正在执行 planning     ← 又规划一次
 *     编排 pages
 *
 * 真机 sr-20260905004750 第 3 轮开头逐字如上。内容是接着的，样子是重来的——
 * 用户原话：「这块的切换很不自然，看着又跟重新推演的感觉似的」。
 *
 * ⚠ **该动的不是「一跳一件」**（那是有意的架构决定），是界面：认出续跑，
 *   就别重画开场。这里只回答「是不是续跑」，怎么少画在 `stage-authority`。
 */

import { factoryHopFromText, looksLikeFactoryHopCommand } from "@/lib/factory-hops";

import { isOpeningStep } from "./stage-authority";
import type { UiTurn } from "./types";

/** 确认伴随式假设之后前端排的那句话。跟 `useSlideRuleSession` 那处同一份字面。 */
export const ASSUMPTIONS_CONFIRMED_PHRASE = "假设已确认。继续画页面。";

/**
 * 这一轮的用户原文是不是「接着上一跳往下走」。
 *
 * 两类都算：
 *   · 伴随式假设确认（「假设已确认。继续画页面。」）
 *   · 工厂公开跳的指令（收尾卡「进入数据模型反推（Structure）」之类）
 *
 * ⚠ 判据盯**语义**不盯整句：确认那句以后可能改文案，`假设已确认` 这半句
 *   才是它的身份（`spec-assumptions` 那边也是认这半句）。
 */
export function isContinuationTurn(userText: unknown): boolean {
  const text = String(userText || "").trim();
  if (!text) return false;
  if (/假设已确认/.test(text)) return true;
  if (factoryHopFromText(text)) return true;
  return looksLikeFactoryHopCommand(text);
}

/**
 * 续跑的一轮**接在上一段后面**，不另起一块。
 *
 * ## 事故（2026-09-05，用户第二次指出来）
 *
 * 「一跳一件」（2026-09-02 `7afc6a9`）决定了确认伴随式假设之后只能再开一轮。
 * 一轮 = 一个新气泡 + 一张新卡片，于是屏幕上是这样：
 *
 *     ┌ 用户气泡：假设已确认。继续画页面。   ← 这句话用户根本没打过
 *     └ 新卡片：规划第一轮能力与路线…
 *                入站 闸
 *                ✓ 接收意图
 *
 * 我第一版只做了「续跑轮少画开场」，**没做「接在上一段后面」**——结果那一轮
 * 只剩一条 `接收意图`，看着还是重新开始；而全滤掉又会变成一片空白（16c5f3d）。
 * 两头都不对，是因为少的那一半才是关键：**它不该是一块新的**。
 *
 * 现在折进上一轮：步骤接在后面（开场那几条丢掉），用户气泡用上一轮的原话
 * （那才是人真正说过的），状态 / 计时 / 路线跟着新的那一跳走。
 *
 * ⚠ 折叠只在**上一轮就在眼前**时成立。刷新后只恢复了最近几轮、续跑轮排在
 *   第一条时没得可折——那种情况仍由 `deriveStageBands({continuation})` 少画
 *   开场兜住（滤空了就照原样画，见那边头注）。
 */
export function foldContinuationTurns(uiTurns: UiTurn[]): UiTurn[] {
  const out: UiTurn[] = [];
  for (const turn of uiTurns) {
    const prev = out[out.length - 1];
    if (prev && isContinuationTurn(turn.user)) {
      const carried = turn.steps.filter(step => !isOpeningStep(step));
      out[out.length - 1] = {
        ...turn,
        // 人真正说过的那句留着；机器排的「假设已确认。继续画页面。」不当用户气泡
        user: prev.user,
        steps: [...prev.steps, ...carried],
        durationMs:
          (prev.durationMs || 0) + (turn.durationMs || 0) || undefined,
      };
      continue;
    }
    out.push(turn);
  }
  return out;
}
