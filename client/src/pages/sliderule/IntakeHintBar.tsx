/**
 * 入站判定的提示条（2026-07-27）。
 *
 * 拆成纯展示组件而不是内联在 ComposerDock 里，是因为仓库没有 jsdom/
 * testing-library，测试统一走 renderToStaticMarkup——SSR 不跑 effect，
 * 内联的话这段 UI 就一行都测不到。判定从 props 进来，这里只管怎么显示。
 *
 * 产品契约：卡片出来之后**只提示不阻断**（点选填入，仍可自己改完再发）。
 * 生成过程中的发送锁在 ComposerDock / isComposerSendBlocked，不在这张卡上。
 *
 * ⚠ 2026-08-20：第一版是警告黄底，跟作曲家 Cursor 白卡片撞车。改成同一套
 * 发丝线 + 白底 + 整行选项，不再用 #fffbf0 / 金色字装成「出错了」。
 */
import React from "react";

import type { IntakeJudgement } from "./use-intake-judge";

/** 该不该展示：只有 action=hint 且真有引导话术时才占用户的视线。 */
export function shouldShowIntakeHint(
  judgement: IntakeJudgement | null | undefined
): boolean {
  return !!judgement && judgement.action === "hint" && !!judgement.guidance.trim();
}

export function IntakeHintBar({
  judgement,
  onRewrite,
  isJudging = false,
}: {
  judgement: IntakeJudgement | null | undefined;
  /** 点改写建议 → 回填输入框。 */
  onRewrite: (text: string) => void;
  /** 判定请求在途：先占位，不把上一句的黄条留在新输入上。 */
  isJudging?: boolean;
}) {
  if (isJudging) {
    return (
      <div
        className="pointer-events-auto w-full rounded-[12px] border border-[#e5e7eb] bg-white px-3.5 py-3 text-[13px] leading-5 text-[#71717a]"
        data-testid="sliderule-intake-hint"
        data-pending="true"
        role="status"
      >
        正在澄清需求…
      </div>
    );
  }

  if (!shouldShowIntakeHint(judgement) || !judgement) return null;

  return (
    <div
      className="pointer-events-auto w-full rounded-[12px] border border-[#e5e7eb] bg-white px-3.5 py-3 text-[13px] leading-5 text-[#171717]"
      data-testid="sliderule-intake-hint"
      data-verdict={judgement.verdict}
      role="status"
    >
      <p data-testid="sliderule-intake-guidance" className="text-[#3f3f46]">
        {judgement.guidance}
      </p>
      {judgement.rewrite.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {judgement.rewrite.map(text => (
            <button
              key={text}
              type="button"
              onClick={() => onRewrite(text)}
              data-testid="sliderule-intake-rewrite"
              className="rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-2 text-left text-[13px] leading-5 text-[#171717] transition hover:border-[#d4d4d8] hover:bg-white"
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 text-[11px] leading-4 text-[#a1a1aa]">
        点选卡片填入，也可以继续编辑后发送。
      </div>
    </div>
  );
}

export default IntakeHintBar;
