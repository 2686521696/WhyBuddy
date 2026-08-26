/**
 * 推演前范围卡（PR-3 UI 壳）。
 *
 * 控制面范围卡：点「开始推演」POST /control-turn-stream（六字段 +
 * forcedTool:"rehearse" + 复述句当 userText）。
 *
 * 时间口径只许「大约数分钟，第一页会先出现」。未标定分钟数不许进 DOM。
 */
import React, { useState } from "react";

import {
  loadCharterReuseNext,
  loadProductCharter,
  saveProductCharter,
  setCharterReuseNext,
  type ProductCharter,
} from "./product-charter";
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
  confirmDisabled = false,
}: {
  pending: ScopeCardPending;
  onConfirm: () => void;
  onRevise: () => void;
  /** 本轮 isRunning 时禁止确认：stop 已松画面闸，isRunningRef 仍真。 */
  confirmDisabled?: boolean;
}) {
  const steps = scopeCardSteps(false);
  const thin = pending.variant === "thin";
  const [reuseNext, setReuseNext] = useState(loadCharterReuseNext);
  const [charter, setCharter] = useState<ProductCharter>(loadProductCharter);

  const patchCharter = (key: keyof ProductCharter, value: string) => {
    const next = { ...charter, [key]: value };
    setCharter(next);
    saveProductCharter(next);
  };

  const toggleReuse = (checked: boolean) => {
    setReuseNext(checked);
    setCharterReuseNext(checked);
  };

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
        </>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="sliderule-scope-confirm"
          disabled={confirmDisabled}
          onClick={() => {
            if (confirmDisabled) return;
            onConfirm();
          }}
          className="rounded-[8px] bg-[#171717] px-3 py-1.5 text-[13px] leading-5 text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
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
      <label
        className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] leading-4 text-[#3f3f46]"
        data-testid="sliderule-scope-charter-reuse"
      >
        <input
          type="checkbox"
          checked={reuseNext}
          onChange={e => toggleReuse(e.target.checked)}
          className="h-3.5 w-3.5 accent-[#171717]"
        />
        下一场沿用
      </label>
      <p className="mt-1 text-[11px] leading-4 text-[#71717a]">
        宪章是约束，不是证据。不勾选不会带进下一场，也不会把上一场模型当先验。
      </p>
      <div className="mt-2 grid gap-1.5" data-testid="sliderule-scope-charter-fields">
        {(
          [
            ["industry", "行业"],
            ["terms", "术语"],
            ["defaultRoles", "默认角色"],
            ["hardCompliance", "硬性合规"],
            ["brandConstraints", "品牌约束"],
          ] as Array<[keyof ProductCharter, string]>
        ).map(([key, label]) => (
          <input
            key={key}
            data-testid={`sliderule-scope-charter-${key}`}
            value={charter[key] || ""}
            onChange={e => patchCharter(key, e.target.value)}
            placeholder={label}
            className="h-7 rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] px-2 text-[12px] text-[#171717] outline-none placeholder:text-[#a1a1aa]"
          />
        ))}
      </div>
    </div>
  );
}

export default ScopeCard;
