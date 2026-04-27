import { Paperclip, Settings, Save, Rocket } from "lucide-react";

import { useI18n } from "@/i18n";
import type { LaunchMode } from "./LaunchModeTabBar";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export interface LaunchPanelActionBarProps {
  mode: LaunchMode;
  onSubmit: () => void;
  onAddAttachment: () => void;
  submitting: boolean;
  disabled: boolean;
  attachmentCount: number;
}

export function LaunchPanelActionBar({
  mode,
  onSubmit,
  onAddAttachment,
  submitting,
  disabled,
  attachmentCount,
}: LaunchPanelActionBarProps) {
  const { locale } = useI18n();

  return (
    <div
      className="flex items-center justify-between border-t px-4 py-3"
      style={{ borderColor: "var(--border, #e2e8f0)" }}
      data-testid="launch-panel-action-bar"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAddAttachment}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors hover:bg-black/5"
          style={{ color: "var(--muted-foreground, #64748b)" }}
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
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors hover:bg-black/5"
          style={{ color: "var(--muted-foreground, #64748b)" }}
          data-testid="launch-action-settings"
        >
          <Settings size={14} />
          {t(locale, "高级设置", "Advanced Settings")}
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors hover:bg-black/5"
          style={{ color: "var(--muted-foreground, #64748b)" }}
          data-testid="launch-action-template"
        >
          <Save size={14} />
          {t(locale, "保存为模板", "Save as Template")}
        </button>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || submitting}
        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
        style={{
          backgroundColor:
            disabled || submitting
              ? "var(--muted, #f1f5f9)"
              : "var(--primary, #0f172a)",
          color:
            disabled || submitting
              ? "var(--muted-foreground, #64748b)"
              : "var(--primary-foreground, #ffffff)",
        }}
        data-testid="launch-action-submit"
      >
        <Rocket size={14} />
        {submitting
          ? t(locale, "提交中...", "Submitting...")
          : t(locale, "启动任务", "Launch Task")}
      </button>
    </div>
  );
}
