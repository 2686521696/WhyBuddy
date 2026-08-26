/**
 * 推演前范围卡（PR-3 UI 壳）。
 *
 * 控制面到来前的 mock：发送 / 重新推演先出这张卡，点「开始推演」才走今天的
 * runTurn 信封。PR-4 会删掉确认 → runTurn → /drive-full-stream 旁路。
 *
 * 时间口径只许「大约数分钟，第一页会先出现」。未标定分钟数不许进 DOM。
 */
import React from "react";

import {
  SCOPE_CARD_CONFIRM_LABEL,
  SCOPE_CARD_REVISE_LABEL,
  SCOPE_CARD_TIME_COPY,
  scopeCardSteps,
  type ScopeCardDevice,
  type ScopeCardPending,
} from "./scope-card-gate";

const OVERLAY_CLASS =
  "pointer-events-auto absolute bottom-full left-0 right-0 z-10 mb-2 origin-bottom sr-composer-pop rounded-[12px] border border-[#e5e7eb] bg-white px-3.5 py-3 text-[13px] leading-5 text-[#171717] shadow-[0_12px_32px_rgb(15_23_42/0.12)]";

function deviceLabel(device: ScopeCardDevice): string {
  if (device === "phone") return "手机应用";
  if (device === "desktop") return "Web / PC";
  return "未指定（两档都生成）";
}

export function ScopeCard({
  pending,
  onConfirm,
  onRevise,
}: {
  pending: ScopeCardPending;
  onConfirm: (opts: { includeEvidence: boolean }) => void;
  onRevise: () => void;
}) {
  const [includeEvidence, setIncludeEvidence] = React.useState(
    pending.includeEvidence
  );
  const steps = scopeCardSteps(includeEvidence);
  const thin = pending.variant === "thin";

  return (
    <div
      className={`${OVERLAY_CLASS} max-h-[min(360px,50vh)] overflow-y-auto`}
      data-testid="sliderule-scope-card"
      data-variant={pending.variant}
      role="dialog"
      aria-label="确认推演范围"
    >
      <p
        className="text-[13px] leading-5 text-[#171717]"
        data-testid="sliderule-scope-restatement"
      >
        将做成：{pending.restatement}
      </p>
      {thin ? null : (
        <>
          <p
            className="mt-1.5 text-[12px] leading-4 text-[#3f3f46]"
            data-testid="sliderule-scope-device"
          >
            设备档：{deviceLabel(pending.device)}
          </p>
          <p
            className="mt-1.5 text-[12px] leading-4 text-[#3f3f46]"
            data-testid="sliderule-scope-steps"
          >
            将跑：{steps.join(" → ")}
          </p>
          <p
            className="mt-1.5 text-[12px] leading-4 text-[#71717a]"
            data-testid="sliderule-scope-time"
          >
            {SCOPE_CARD_TIME_COPY}
          </p>
          <label
            className="mt-2.5 flex items-center gap-2 text-[12px] leading-4 text-[#3f3f46]"
            data-testid="sliderule-scope-evidence"
          >
            <input
              type="checkbox"
              checked={includeEvidence}
              onChange={event => setIncludeEvidence(event.target.checked)}
            />
            取证（web.search，默认关）
          </label>
        </>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="sliderule-scope-confirm"
          onClick={() => onConfirm({ includeEvidence })}
          className="rounded-[8px] bg-[#171717] px-3 py-1.5 text-[13px] leading-5 text-white transition hover:bg-black"
        >
          {SCOPE_CARD_CONFIRM_LABEL}
        </button>
        <button
          type="button"
          data-testid="sliderule-scope-revise"
          onClick={onRevise}
          className="rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-1.5 text-[13px] leading-5 text-[#171717] transition hover:border-[#d4d4d8] hover:bg-white"
        >
          {SCOPE_CARD_REVISE_LABEL}
        </button>
      </div>
    </div>
  );
}

export default ScopeCard;
