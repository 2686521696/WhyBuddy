import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { latestTrustedReport } from "@shared/blueprint/sliderule-delivery-chain";
import { deriveNextStepChips } from "./next-step-chips";

const BASE_HINTS = [
  "路线对比一下",
  "澄清权限边界",
  "分析安全风险",
  "生成可行性报告",
];

/** Contextual composer chips for S20 RV / ITER when session is converged. */
export function deriveComposerHintChips(state: V5SessionState): string[] {
  // ⚠ 模型自己写的下一步**优先于**下面那四条写死的通用词。
  //   2026-09-14 对照 Manus：它给的是「为工单队列添加多维度筛选」这种
  //   针对刚做出来的东西的建议，而我们每次都显示同样的「路线对比一下」。
  //   有真的就显示真的，一条都没有才退回通用（见 next-step-chips.ts 头注）。
  const nextSteps = deriveNextStepChips(state);
  if (nextSteps.length) return nextSteps;

  const hints = [...BASE_HINTS];
  const stale = new Set(state.staleArtifactIds || []);

  if (state.runtimePhase === "done" || state.deliveryPhase === "shipped") {
    return ["继续补充想法", "换个推演角度"];
  }

  if (state.goal?.status === "clear" && latestTrustedReport(state)) {
    hints.unshift("评审通过，可以交付", "评审打回，退回修改");
  }

  const hasFreshPreview = (state.artifacts || []).some(
    (a) => a.kind === "preview" && !stale.has(a.id)
  );
  if (hasFreshPreview) {
    hints.unshift("效果不满意，重新预演");
  }

  return [...new Set(hints)].slice(0, 6);
}