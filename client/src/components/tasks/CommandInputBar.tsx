import { cn } from "@/lib/utils";
import { Send } from "lucide-react";
import { useState, useCallback } from "react";

/* ─── i18n helper ─── */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ─── Props ─── */

export interface CommandInputBarProps {
  taskId: string;
  locale: string;
}

/* ─── Component ─── */

/**
 * Simple command input bar fixed at the bottom of TaskDetailCardsView.
 *
 * For now this is a standalone placeholder input + send button.
 * Future iterations may reuse UnifiedLaunchComposer in compact mode.
 */
export function CommandInputBar({
  locale,
}: CommandInputBarProps): React.ReactElement {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(() => {
    if (!value.trim()) return;
    // Placeholder: future integration will send the command to the task
    setValue("");
  }, [value]);

  return (
    <div
      className={cn(
        "border-t bg-card px-4 py-2",
        "flex items-center gap-2",
      )}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            handleSubmit();
          }
        }}
        placeholder={t(locale, "输入任务指令...", "Enter task command...")}
        className={cn(
          "flex-1 rounded-md border bg-background px-3 py-2 text-sm",
          "placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        )}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!value.trim()}
        className={cn(
          "inline-flex items-center justify-center",
          "h-9 w-9 rounded-md",
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90 transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        aria-label={t(locale, "发送", "Send")}
      >
        <Send size={16} />
      </button>
    </div>
  );
}
