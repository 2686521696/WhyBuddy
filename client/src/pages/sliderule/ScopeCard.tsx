/**
 * 推演前范围卡（PR-3 UI 壳）。
 *
 * 控制面范围卡：点「开始推演」POST /control-turn-stream（六字段 +
 * forcedTool:"rehearse" + 复述句当 userText）。
 *
 * 时间口径只许「大约数分钟，第一页会先出现」。未标定分钟数不许进 DOM。
 *
 * ⚠ 2026-08-27：宪章五栏曾经是空 input。用户对着「行业 / 术语 / 角色」
 * 不知道填什么，澄清变成写作文。改成闭集点选；写入的仍是 ProductCharter
 * 字符串，后端 normalize 不用动。禁止再摆 placeholder 输入框。
 */
import React, { useState } from "react";

import {
  CHARTER_FIELD_CHOICES,
  loadCharterReuseNext,
  loadProductCharter,
  parseCharterSelections,
  saveProductCharter,
  setCharterReuseNext,
  toggleCharterChoice,
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

function initialReuseNext(pending: ScopeCardPending): boolean {
  const stored = loadCharterReuseNext();
  if (stored !== null) return stored;
  if (typeof pending.charterReuseNext === "boolean") return pending.charterReuseNext;
  return false;
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
  const [reuseNext, setReuseNext] = useState(() => initialReuseNext(pending));
  const [charter, setCharter] = useState<ProductCharter>(loadProductCharter);

  const patchCharter = (key: keyof ProductCharter, value: string) => {
    const next = { ...charter, [key]: value };
    if (!value.trim()) delete next[key];
    setCharter(next);
    saveProductCharter(next);
  };

  const pickCharter = (
    key: keyof ProductCharter,
    option: string,
    multiple: boolean,
    options: readonly string[]
  ) => {
    patchCharter(key, toggleCharterChoice(charter[key], option, multiple, options));
  };

  const toggleReuse = (checked: boolean) => {
    setReuseNext(checked);
    setCharterReuseNext(checked);
  };

  return (
    <div
      className={`${OVERLAY_CLASS} max-h-[min(520px,70vh)] overflow-y-auto`}
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
      {thin ? null : (
        <div className="mt-2 grid gap-2" data-testid="sliderule-scope-charter-fields">
          {CHARTER_FIELD_CHOICES.map(row => {
            const selected = parseCharterSelections(
              charter[row.key],
              row.options,
              row.multiple
            );
            const catalog = new Set<string>(row.options);
            const extras = selected.filter(item => !catalog.has(item));
            const chips = [...row.options, ...extras];
            return (
              <div
                key={row.key}
                data-testid={`sliderule-scope-charter-${row.key}`}
              >
                <p className="text-[11px] leading-4 text-[#71717a]">{row.label}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {chips.map(option => {
                    const on = selected.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        data-testid={`sliderule-scope-charter-${row.key}-${option}`}
                        aria-pressed={on}
                        onClick={() =>
                          pickCharter(row.key, option, row.multiple, row.options)
                        }
                        className={`rounded-[8px] border px-2 py-1 text-[12px] leading-4 transition ${
                          on
                            ? "border-[#171717] bg-[#171717] text-white"
                            : "border-[#e5e7eb] bg-[#fafafa] text-[#171717] hover:border-[#d4d4d8] hover:bg-white"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ScopeCard;
