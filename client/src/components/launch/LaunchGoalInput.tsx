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
}

export const LaunchGoalInput = forwardRef<HTMLTextAreaElement, LaunchGoalInputProps>(
  function LaunchGoalInput(
    { value, onChange, maxLength = 2000, autoFocus = false },
    ref
  ) {
    const { locale } = useI18n();

    return (
      <div className="px-4 py-3" data-testid="launch-goal-input">
        <label
          id="launch-goal-label"
          className="mb-2 block text-sm font-medium"
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
            className="w-full min-h-[80px] max-h-[200px] resize-none rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
            style={{
              borderColor: "var(--input, #e2e8f0)",
              backgroundColor: "var(--background, #ffffff)",
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
