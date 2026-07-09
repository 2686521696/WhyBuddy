import { forwardRef } from "react";

import { useI18n } from "@/i18n";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export interface LaunchGoalInputProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  autoFocus?: boolean;
  compact?: boolean;
}

export const LaunchGoalInput = forwardRef<HTMLTextAreaElement, LaunchGoalInputProps>(
  function LaunchGoalInput(
    { value, onChange, maxLength = 2000, autoFocus = false, compact = false },
    ref
  ) {
    const { locale } = useI18n();

    return (
      <div
        className={compact ? "px-4 py-2.5" : "px-4 py-3"}
        data-testid="launch-goal-input"
      >
        <label
          id="launch-goal-label"
          className={
            compact
              ? "mb-1.5 block text-xs font-semibold text-slate-700"
              : "mb-2 block text-sm font-medium"
          }
          style={{ color: "var(--card-foreground, #0f172a)" }}
        >
          {t(locale, "输入你的目标", "Enter your goal")}
        </label>
        <div className="relative">
          <textarea
            ref={ref}
            value={value}
            onChange={e => {
              const newValue = e.target.value;
              if (newValue.length <= maxLength) {
                onChange(newValue);
              } else {
                onChange(newValue.slice(0, maxLength));
              }
            }}
            placeholder={t(
              locale,
              "描述你想要完成的任务目标...",
              "Describe the task goal you want to accomplish..."
            )}
            className={
              compact
                ? "w-full min-h-[68px] max-h-[140px] resize-none rounded-xl border border-slate-200/90 bg-white/88 px-3 py-2.5 pr-20 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                : "w-full min-h-[80px] max-h-[200px] resize-none rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
            }
            style={{
              borderColor: compact ? undefined : "var(--input, #e2e8f0)",
              backgroundColor: compact
                ? undefined
                : "var(--background, #ffffff)",
            }}
            aria-labelledby="launch-goal-label"
            autoFocus={autoFocus}
            data-testid="launch-goal-textarea"
          />
          <span
            className="absolute bottom-2 right-3 text-xs"
            style={{ color: "var(--muted-foreground, #64748b)" }}
            data-testid="launch-goal-char-count"
          >
            {value.length} / {maxLength}
          </span>
        </div>
      </div>
    );
  }
);
