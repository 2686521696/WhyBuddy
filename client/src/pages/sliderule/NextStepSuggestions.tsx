/**
 * NextStepSuggestions —— 结果卡下面那几行「接着可以做什么」。
 *
 * ## 为什么是**整行**而不是小 chip（2026-09-14，对照 Manus 截图）
 *
 * 上一版把模型的下一步塞进了输入条上方的 hint chip 行。对照 Manus 才看明白
 * 位置和形态都不对：
 *
 *   · **位置**：建议是关于「刚做出来的这个东西」的，应该贴着结果；混进输入条
 *     的通用提示里，它跟「路线对比一下」这种万能词长得一样，读起来像装饰。
 *   · **形态**：Manus 是整行可点——左边一个对话气泡图标、中间整句话、右边一个
 *     `→`。一眼就知道「点它就接着干」。小 pill 只能塞半句话，长一点就截断成
 *     「联调 check/build/test，确…」，等于没说。
 *
 * 所以这里是整行，输入条那边**退回通用提示**（两者各管各的，不再互相顶替）。
 *
 * ## 边界
 *
 *   · 判断仍在 `next-step-chips.ts`（纯函数），这里只画。
 *   · 一条都没有就整块不画——不摆一个空壳，也不拿通用词凑数。
 *   · 点一下是**填进输入框可再编辑**，跟现有 hint chip 的契约一致；
 *     不直接发出去（模型写的待办常带工具名，用户多半想改一句再发）。
 */

import React from "react";
import { ArrowRight, MessageSquare } from "lucide-react";
import { deriveNextStepChips } from "./next-step-chips";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

export function NextStepSuggestions({
  state,
  onPick,
}: {
  state: Pick<V5SessionState, "controlTodo"> | null | undefined;
  onPick?: (text: string) => void;
}) {
  const items = deriveNextStepChips(state);
  if (!items.length || !onPick) return null;

  return (
    <div
      className="my-2 overflow-hidden rounded-xl border border-stone-200 bg-white"
      data-testid="next-step-suggestions"
    >
      {items.map((text, index) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          data-testid="next-step-suggestion"
          title="填入输入框，可再编辑"
          className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-stone-50 ${
            index ? "border-t border-stone-100" : ""
          }`}
        >
          <MessageSquare className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
          {/* ⚠ 不截断：整行的意义就是把话说完。挤不下就换行，不给省略号。 */}
          <span className="min-w-0 flex-1 text-[13px] leading-5 text-stone-700">
            {text}
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-stone-300" aria-hidden />
        </button>
      ))}
    </div>
  );
}
