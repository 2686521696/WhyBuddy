/**
 * 入站判定的提示条（2026-07-27）。
 *
 * 拆成纯展示组件而不是内联在 ComposerDock 里，是因为仓库没有 jsdom/
 * testing-library，测试统一走 renderToStaticMarkup——SSR 不跑 effect，
 * 内联的话这段 UI 就一行都测不到。判定从 props 进来，这里只管怎么显示。
 *
 * 产品契约：**只提示不阻断**。发送键始终可用，提示条自己也把这句话写在
 * 明面上，避免用户以为被卡住。
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
}: {
  judgement: IntakeJudgement | null | undefined;
  /** 点改写建议 → 回填输入框。 */
  onRewrite: (text: string) => void;
}) {
  if (!shouldShowIntakeHint(judgement) || !judgement) return null;

  return (
    <div
      className="pointer-events-auto w-full rounded-[10px] border border-[#ffe3a3] bg-[#fffbf0] px-3 py-2 text-[12px] leading-5 text-[#8a6116]"
      data-testid="sliderule-intake-hint"
      data-verdict={judgement.verdict}
      role="status"
    >
      <span data-testid="sliderule-intake-guidance">{judgement.guidance}</span>
      {judgement.rewrite.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {judgement.rewrite.map(text => (
            <button
              key={text}
              type="button"
              onClick={() => onRewrite(text)}
              data-testid="sliderule-intake-rewrite"
              className="rounded-[7px] border border-[#f0dcae] bg-white px-2 py-1 text-left text-[11px] leading-4 text-[#8a6116] transition hover:border-[#e0c47e] hover:bg-[#fff7e6]"
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 text-[10px] text-[#b08a3e]">
        这只是建议 — 直接发送仍会照常推演。
      </div>
    </div>
  );
}

export default IntakeHintBar;
