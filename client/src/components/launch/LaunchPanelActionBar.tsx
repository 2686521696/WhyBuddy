import {
  MoreHorizontal,
  Paperclip,
  PlusCircle,
  Rocket,
  SlidersHorizontal,
} from "lucide-react";

import { useI18n } from "@/i18n";
import type { LaunchMode } from "./LaunchModeTabBar";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export interface LaunchPanelActionBarProps {
  mode: LaunchMode;
  onSubmit: () => void;
  onAddAttachment: () => void;
  onCreateTask?: () => void;
  submitting: boolean;
  disabled: boolean;
  attachmentCount: number;
  compact?: boolean;
}

export function LaunchPanelActionBar({
  mode,
  onSubmit,
  onAddAttachment,
  onCreateTask,
  submitting,
  disabled,
  attachmentCount,
  compact = false,
}: LaunchPanelActionBarProps) {
  const { locale } = useI18n();
  void mode;
  const secondaryActionClassName = compact
    ? "flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/72 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
    : "flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors hover:bg-black/5";
  const secondaryActionStyle = {
    color: compact ? undefined : "var(--muted-foreground, #64748b)",
  };

  return (
    <div
      className={
        compact
          ? "flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5"
          : "flex items-center justify-between border-t px-4 py-3"
      }
      style={{
        borderColor: compact
          ? "rgba(226,232,240,0.78)"
          : "var(--border, #e2e8f0)",
      }}
      data-testid="launch-panel-action-bar"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onAddAttachment}
          className={secondaryActionClassName}
          style={secondaryActionStyle}
          data-testid="launch-action-attachment"
        >
          <Paperclip size={14} />
          {t(locale, "添加附件", "Add Attachment")}
          {attachmentCount > 0 && (
            <span className="text-xs">({attachmentCount})</span>
          )}
        </button>
        <button
          type="button"
          onClick={onCreateTask}
          className={secondaryActionClassName}
          style={secondaryActionStyle}
          data-testid="launch-action-create-task"
        >
          <PlusCircle size={14} />
          {t(locale, "新建任务", "New task")}
        </button>
        <button
          type="button"
          className={secondaryActionClassName}
          style={secondaryActionStyle}
          data-testid="launch-action-advanced"
        >
          <SlidersHorizontal size={14} />
          {t(locale, "高级", "Advanced")}
        </button>
        <button
          type="button"
          className={secondaryActionClassName}
          style={secondaryActionStyle}
          data-testid="launch-action-more"
        >
          <MoreHorizontal size={14} />
          {t(locale, "更多", "More")}
        </button>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || submitting}
        className={
          compact
            ? "ml-auto flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold shadow-[0_12px_28px_rgba(14,165,233,0.18)] transition-colors disabled:cursor-not-allowed disabled:shadow-none"
            : "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
        }
        style={
          compact
            ? {
                backgroundColor:
                  disabled || submitting
                    ? "rgba(241,245,249,0.92)"
                    : "#0ea5e9",
                color: disabled || submitting ? "#64748b" : "#ffffff",
              }
            : {
                backgroundColor:
                  disabled || submitting
                    ? "var(--muted, #f1f5f9)"
                    : "var(--primary, #0f172a)",
                color:
                  disabled || submitting
                    ? "var(--muted-foreground, #64748b)"
                    : "var(--primary-foreground, #ffffff)",
              }
        }
        data-testid="launch-action-submit"
      >
        <Rocket size={14} />
        {submitting
          ? t(locale, "提交中...", "Submitting...")
          : t(locale, "发起", "Launch")}
      </button>
    </div>
  );
}
