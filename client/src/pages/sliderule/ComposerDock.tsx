import React from "react";
import { Brain, Check, ChevronDown, FileText, Link, Mic, Plus, RefreshCw, SendHorizontal, Square, Zap } from "lucide-react";

function formatBudgetTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
}

/** Returns true if the text looks like a URL. */
function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/[^\s]{4,}/.test(text.trim());
}

/** Returns true if the DataTransfer contains files. */
function hasFiles(dt: DataTransfer): boolean {
  return dt.items
    ? Array.from(dt.items).some((item) => item.kind === "file")
    : dt.files.length > 0;
}

export function ComposerDock({
  input,
  setInput,
  sendMessage,
  isRunning,
  goal,
  latestUserText,
  driveMode: outerDriveMode,
  setDriveMode: outerSetDriveMode,
  marathonBudget: outerMarathonBudget,
  onBudgetChange,
  stop,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => void;
  isRunning: boolean;
  goal: string;
  latestUserText?: string;
  hintChips?: string[];
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  marathonBudget?: { maxTokens: number; declaredAt: string };
  onBudgetChange?: (b: { maxTokens: number; declaredAt: string }) => void;
  stop?: () => void;
}) {
  const [localMode, setLocalMode] = React.useState<"single" | "marathon">("single");
  const [isModeOpen, setIsModeOpen] = React.useState(false);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [attachmentHint, setAttachmentHint] = React.useState<string | null>(null);
  const modeRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const driveMode = outerDriveMode || localMode;
  const setDriveMode = outerSetDriveMode || setLocalMode;
  let marathonBudget = outerMarathonBudget || (() => {
    try {
      return JSON.parse(localStorage.getItem("sliderule:marathonBudget") || "null");
    } catch {
      return null;
    }
  })();
  if (outerMarathonBudget) marathonBudget = outerMarathonBudget;

  const selectMode = (mode: "single" | "marathon") => {
    if (mode === "marathon") {
      let budget = { maxTokens: 12000, declaredAt: new Date().toISOString() };
      try {
        const raw = localStorage.getItem("sliderule:marathonBudget");
        if (raw) budget = JSON.parse(raw);
      } catch {}
      const ans = window.prompt(
        "持续推演预算\n输入本 session 最大 token 上限（默认 12000）",
        String(budget.maxTokens)
      );
      if (ans) {
        const n = Math.max(2000, Math.min(80000, parseInt(ans, 10) || 12000));
        budget = { maxTokens: n, declaredAt: new Date().toISOString() };
        try {
          localStorage.setItem("sliderule:marathonBudget", JSON.stringify(budget));
        } catch {}
        onBudgetChange?.(budget);
      }
      try {
        (window as any).__slideruleMarathonBudget = budget;
      } catch {}
    }
    setDriveMode(mode);
    setIsModeOpen(false);
  };

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const refEl = modeRef.current;
      if (refEl && !refEl.contains(event.target as Node)) {
        setIsModeOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const adjustTextareaHeight = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (!ta.value.trim()) {
      ta.style.height = "44px";
      return;
    }
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 112)}px`;
  }, []);

  React.useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // Listen for example prompt clicks from ClaudeChatSurface empty state.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (text) {
        setInput(text);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    };
    window.addEventListener("sliderule:fill-prompt", handler);
    return () => window.removeEventListener("sliderule:fill-prompt", handler);
  }, [setInput]);

  /** Handle text paste — detect URLs and surface a hint. */
  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = e.clipboardData.getData("text");
      if (looksLikeUrl(pasted)) {
        // Let the default paste fill the textarea, then surface a hint.
        setTimeout(() => {
          setAttachmentHint(`已检测到 URL — 可直接发送，SlideRule 会尝试抓取摘要`);
          setTimeout(() => setAttachmentHint(null), 5000);
        }, 0);
      }
    },
    []
  );

  /** Drag-and-drop: accept files, show overlay hint. */
  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = React.useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;
      const names = files.map((f) => f.name).join(", ");
      const suffix = `[附件: ${names}]`;
      // setInput only accepts string; read the current textarea value instead of functional updater.
      const current = textareaRef.current?.value ?? "";
      setInput(current ? `${current}\n${suffix}` : suffix);
      setAttachmentHint(`已添加附件提示：${names}（文件解析服务开发中）`);
      setTimeout(() => setAttachmentHint(null), 5000);
    },
    [setInput]
  );

  const placeholderText = "畅所欲问";

  return (
    <div className="pointer-events-none flex w-[min(820px,calc(100vw-32px))] flex-col items-center gap-2">
      {latestUserText && (
        <div className="max-w-[min(760px,90vw)] truncate rounded-full border border-[#E7E2D9] bg-white/85 px-3 py-1.5 text-xs text-stone-500 shadow-sm">
          本轮 · {latestUserText.slice(0, 72)}
          {latestUserText.length > 72 ? "..." : ""}
        </div>
      )}

      <div
        className={`pointer-events-auto relative w-full rounded-[24px] border bg-white px-3 py-2 shadow-[0_6px_28px_rgb(68_60_44/0.08)] transition-colors ${
          isDragOver ? "border-[#D97757] bg-[#F8E8E0]/40" : "border-[#E7E2D9]"
        }`}
        data-testid="sliderule-composer-dock"
        data-mode={driveMode}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[24px] bg-[#F8E8E0]/60">
            <div className="flex items-center gap-2 text-sm font-medium text-[#C4633F]">
              <FileText className="h-4 w-4" />
              拖拽文件到这里
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="relative shrink-0" ref={modeRef}>
            <button
              type="button"
              onClick={() => setIsModeOpen((open) => !open)}
              disabled={isRunning}
              className="flex h-11 w-11 items-center justify-center rounded-full text-stone-700 transition hover:bg-[#F0EDE5] disabled:opacity-45"
              title="选择推演模式"
            >
              <Plus className="h-5 w-5" />
            </button>

            <div
              data-testid="sliderule-mode-menu"
              className={`absolute bottom-full left-0 z-[80] mb-2 w-[230px] origin-bottom-left rounded-[18px] border border-[#E7E2D9] bg-white p-1.5 shadow-[0_18px_48px_rgb(68_60_44/0.16)] transition-all duration-150 ${
                isModeOpen ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-2 scale-95 opacity-0"
              }`}
            >
              <button
                type="button"
                onClick={() => selectMode("single")}
                className={`flex w-full items-center gap-2 rounded-[14px] px-2.5 py-2 text-left transition hover:bg-[#F5F1EA] ${
                  driveMode === "single" ? "bg-[#F0EDE5]" : ""
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F0EDE5] text-stone-700">
                  <Brain className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-stone-800">深思一轮</span>
                  <span className="block truncate text-[10px] text-stone-500">想清楚一个问题后停下</span>
                </span>
                {driveMode === "single" && <Check className="h-3.5 w-3.5 text-emerald-500" />}
              </button>

              <button
                type="button"
                onClick={() => selectMode("marathon")}
                className={`mt-1 flex w-full items-center gap-2 rounded-[14px] px-2.5 py-2 text-left transition hover:bg-[#F5F1EA] ${
                  driveMode === "marathon" ? "bg-[#F8E8E0]" : ""
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F8E8E0] text-[#C4633F]">
                  <RefreshCw className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-stone-800">持续推演</span>
                  <span className="block truncate text-[10px] text-stone-500">
                    自动推进到需要确认 · {formatBudgetTokens(marathonBudget?.maxTokens || 12000)}
                  </span>
                </span>
                {driveMode === "marathon" && <Check className="h-3.5 w-3.5 text-[#C4633F]" />}
              </button>
            </div>
          </div>

          <div className="min-w-0 flex-1 pb-0.5">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                requestAnimationFrame(adjustTextareaHeight);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!isRunning && input.trim()) sendMessage();
                }
              }}
              onPaste={handlePaste}
              placeholder={placeholderText}
              aria-label={placeholderText}
              rows={1}
              disabled={isRunning}
              className="block max-h-28 min-h-11 w-full resize-none bg-transparent px-1 py-2.5 text-[15px] leading-6 text-[#1F1E1B] outline-none placeholder:text-stone-400 disabled:opacity-60"
              data-testid="sliderule-composer-input"
            />
          </div>

          <button
            type="button"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-700 transition hover:bg-[#F0EDE5] sm:flex"
            title={driveMode === "marathon" ? "持续推演" : "深思一轮"}
            onClick={() => selectMode(driveMode === "marathon" ? "single" : "marathon")}
            disabled={isRunning}
          >
            {driveMode === "marathon" ? <RefreshCw className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-700 transition hover:bg-[#F0EDE5] sm:flex"
            title="语音输入"
            disabled
          >
            <Mic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={isRunning ? (stop || (() => {})) : sendMessage}
            disabled={!isRunning && !input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#D97757] text-white shadow-sm transition hover:bg-[#C4633F] disabled:cursor-not-allowed disabled:opacity-35"
            title={isRunning ? "停止" : "发送"}
          >
            {isRunning ? <Square className="h-4 w-4 fill-current" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsModeOpen((open) => !open)}
          disabled={isRunning}
          className="absolute bottom-[-26px] left-4 hidden items-center gap-1 text-[10px] text-stone-400 hover:text-stone-700 sm:flex"
        >
          {driveMode === "marathon" ? "持续推演" : "深思一轮"}
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
