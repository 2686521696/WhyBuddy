import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { type SpecAssumption } from "./spec-assumptions";

/**
 * SPEC 里浮出来的结构性分叉。做成跟 ClarificationCard 同一套权力：
 * 一题一题选，点「确认继续」才往下——不再边跑边点。
 *
 * ⚠ 2026-09-02 真机：伴随式只摊开不拦，用户对着一排「改成 X」不知道
 *   怎么继续。产品裁决改成选完再继续。
 */
export function AssumptionStrip({
  items,
  isRunning = true,
  paused = false,
  onHold,
  onConfirm,
}: {
  items: SpecAssumption[];
  isRunning?: boolean;
  paused?: boolean;
  onHold?: () => void;
  onConfirm: (picks: Record<string, string>) => void;
}) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    setStep(s => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!items || items.length === 0) return null;
  const total = items.length;
  const q = items[Math.min(step, total - 1)];
  if (!q) return null;
  const options = [q.decision, ...q.alternatives.filter(a => a !== q.decision)];
  const current = picked[q.id] ?? q.decision;

  const submit = () => {
    const picks: Record<string, string> = {};
    for (const row of items) {
      picks[row.id] = picked[row.id] ?? row.decision;
    }
    onConfirm(picks);
  };

  return (
    <div
      className="rounded-lg border border-[#EBCEC0]/70 bg-white/95"
      data-testid="sliderule-assumptions"
    >
      <div className="flex items-center justify-between border-b border-[#e8eaee] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full bg-[#e6f4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1677ff]">
            待确认
          </span>
          <span
            className="truncate text-[11px] text-stone-400"
            data-testid="sliderule-assumption-pager"
          >
            {step + 1} / {total}
            {paused ? " · 已停住，选完再继续" : " · 选完再继续"}
          </span>
        </div>
        {onHold && isRunning && !paused ? (
          <button
            type="button"
            data-testid="sliderule-assumption-hold"
            title="先别往下跑：在下一步开始前停住"
            onClick={onHold}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[#71717a] transition hover:bg-[#f4f4f5] hover:text-[#171717]"
          >
            先别往下跑
          </button>
        ) : null}
      </div>

      <div className="px-3 py-3" data-testid="sliderule-assumption">
        <p className="text-sm font-semibold text-stone-800">{q.topic}？</p>
        {q.why ? (
          <p className="mt-1 text-[11px] leading-relaxed text-stone-400">{q.why}</p>
        ) : null}
        <div className="mt-3 space-y-1.5">
          {options.map(opt => {
            const selected = current === opt;
            const recommended = opt === q.decision;
            return (
              <button
                key={opt}
                type="button"
                data-testid="sliderule-assumption-option"
                data-recommended={recommended ? "true" : "false"}
                onClick={() => setPicked(p => ({ ...p, [q.id]: opt }))}
                className={`flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-[13px] transition ${
                  selected
                    ? "border-[#1677ff] bg-[#e6f4ff]/70 text-stone-800"
                    : "border-[#e5e7eb] bg-white text-stone-600 hover:border-[#d3d8e0]"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-[#1677ff] bg-[#1677ff] text-white" : "border-[#d3d8e0]"
                  }`}
                >
                  {selected ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">{opt}</span>
                {recommended ? (
                  <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    推荐
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[#e8eaee] px-3 py-2">
        <span className="text-[11px] text-stone-400">
          已选 {step + 1} / {total}
        </span>
        <div className="flex items-center gap-2">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(s => Math.max(0, s - 1))}
              className="flex items-center gap-1 rounded border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-stone-600 transition hover:bg-[#eef0f4]"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 上一步
            </button>
          ) : null}
          {step < total - 1 ? (
            <button
              type="button"
              data-testid="sliderule-assumption-next"
              onClick={() => setStep(s => Math.min(total - 1, s + 1))}
              className="flex items-center gap-1 rounded bg-[#1677ff] px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#0958d9]"
            >
              下一步 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="sliderule-assumption-submit"
              onClick={submit}
              className="rounded bg-[#1677ff] px-4 py-1.5 text-[12px] font-bold text-white transition hover:bg-[#0958d9]"
            >
              确认继续
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
