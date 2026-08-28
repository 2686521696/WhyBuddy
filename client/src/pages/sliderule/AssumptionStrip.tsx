import { Check } from "lucide-react";
import { assumptionsHeading, type SpecAssumption } from "./spec-assumptions";

/**
 * 伴随式澄清：推演中「我替你定了什么」。
 *
 * ⚠ 这**不是一张问答卡**，别按 ClarificationCard 的样子做。两者的区别不是
 *   长相，是权力：澄清卡拦在用户和工厂中间（不答完不点火），这个一格都不拦——
 *   推演正在跑，这些决定已经生效了，摊开只是让用户**有机会**改。
 *   所以：没有"提交"、没有必填、没有进度、关掉不算跳过。
 *
 * ⚠ 也别把它做成 toast。真机上第 2 步到第 6 步之间有 8 分钟，用户会离开
 *   再回来；几秒就飘走的东西等于没说。它就该一直待在输入框上方，
 *   直到用户处理掉。
 *
 * 摆位跟排队条挨着，是因为两者是同一件事的两个方向：
 * 排队条是「我补一句」，这里是「我替你定了这个」——点了「改成 X」之后，
 * 它变成的正是排队条里的一行。
 */
export function AssumptionStrip({
  items,
  isRunning = true,
  paused = false,
  onHold,
  onSettle,
  onRevise,
}: {
  items: SpecAssumption[];
  /** 这一轮还在跑吗。见 assumptionsHeading：跑完之后同一张卡意思变了。 */
  isRunning?: boolean;
  /** 这一轮已经停住了（用户按过「先别往下跑」）。 */
  paused?: boolean;
  /**
   * 「先别往下跑」。不传就没有这颗按钮——这条链路是 2026-08-28 才接的，
   * 老调用点不传时行为跟从前一模一样。
   *
   * ⚠ 这颗按钮**不是停止**：停止是取消，这一轮判死、白烧；这个是停住等人，
   *   答完/超时/没人在场都会接着跑到最后一步。措辞上必须分得开，两颗按钮
   *   长得像就会有人按错，而按错的代价是烧掉的三分钟。
   */
  onHold?: () => void;
  onSettle: (id: string) => void;
  onRevise: (id: string, alternative: string) => void;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div
      className="mb-1.5 rounded-lg border border-[#e4e4e7] bg-white px-2 py-1.5"
      data-testid="sliderule-assumptions"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] leading-4 text-[#71717a]">
        <span className="min-w-0 flex-1 truncate">
          {paused
            ? `已停住，等你拿主意（${items.length}）· 处理完自动接着跑`
            : assumptionsHeading(items.length, isRunning)}
        </span>
        {/* ⚠ 只在**跑着而且还没停**的时候给这颗按钮：跑完了没什么可停的，
            已经停住了再按一次也没有第二道闸（后端 request_hold 幂等）。 */}
        {onHold && isRunning && !paused ? (
          <button
            type="button"
            data-testid="sliderule-assumption-hold"
            title="先别往下跑：在下一步开始前停住，等你处理完再继续"
            onClick={onHold}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[#71717a] transition hover:bg-[#f4f4f5] hover:text-[#171717]"
          >
            先别往下跑
          </button>
        ) : null}
      </div>
      {items.map(row => (
        <div
          key={row.id}
          data-testid="sliderule-assumption"
          className="border-t border-[#f4f4f5] py-1 first:border-t-0"
        >
          <div className="flex items-start gap-1.5">
            <span className="min-w-0 flex-1 text-[12px] leading-5 text-[#171717]">
              <span className="text-[#71717a]">{row.topic}：</span>
              <span className="font-medium">{row.decision}</span>
            </span>
            <button
              type="button"
              data-testid="sliderule-assumption-settle"
              title="就这样"
              aria-label={`就这样：${row.topic}`}
              onClick={() => onSettle(row.id)}
              className="shrink-0 rounded p-0.5 text-[#a1a1aa] transition hover:bg-[#f4f4f5] hover:text-[#171717]"
            >
              <Check className="h-3 w-3" />
            </button>
          </div>
          {row.why ? (
            <div className="mt-0.5 text-[11px] leading-4 text-[#a1a1aa]">
              {row.why}
            </div>
          ) : null}
          {/*
            ⚠ 没有其他做法时**不渲染这一行**，而不是渲染一行空的。
              模型有时只是知会一声（"我按最通用的做法定的"），那时候
              摆一排空按钮比不摆更糟——看着像坏了。
          */}
          {row.alternatives.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {row.alternatives.map(alt => (
                <button
                  key={alt}
                  type="button"
                  data-testid="sliderule-assumption-revise"
                  onClick={() => onRevise(row.id, alt)}
                  className="rounded-full border border-[#e4e4e7] px-2 py-0.5 text-[11px] leading-4 text-[#3f3f46] transition hover:border-[#171717] hover:text-[#171717]"
                >
                  改成{alt}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
