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
