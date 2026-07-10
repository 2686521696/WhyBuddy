import React from "react";
import {
  Blocks,
  ChevronLeft,
  FileText,
  ImagePlus,
  Lightbulb,
  Loader2,
  Mic,
  Plus,
  SendHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
// 用 navigate 函数而非 useLocation hook：hook 渲染期就读 window.location，
// 会炸掉 node 环境的静态渲染测试；navigate 只在点击时触达 history。
import { navigate } from "wouter/use-browser-location";
import { EXAMPLE_INTENT_TEXTS } from "./example-intents";

/** Returns true if the text looks like a URL. */
function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/[^\s]{4,}/.test(text.trim());
}

/** Returns true if the DataTransfer contains files. */
function hasFiles(dt: DataTransfer): boolean {
  return dt.items
    ? Array.from(dt.items).some(item => item.kind === "file")
    : dt.files.length > 0;
}

export function ComposerDock({
  input,
  setInput,
  sendMessage,
  isRunning,
  goal,
  stop,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => void;
  isRunning: boolean;
  goal: string;

  hintChips?: string[];
  stop?: () => void;
}) {
  // 模式选择器已删（用户裁决 2026-07-10）：深思一轮就是唯一产品路径
  // （Python drive-full-stream 一条消息推到闭环），持续推演是浏览器端
  // 马拉松遗留、还会丢实时流——引擎能力保留在 Dev 面，不再出现在产品面。
  // + 菜单改为 Claude 式实用动作：文件 / 示例意图 / 技能库。
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [menuView, setMenuView] = React.useState<"actions" | "examples">(
    "actions"
  );
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [attachmentHint, setAttachmentHint] = React.useState<string | null>(
    null
  );
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const refEl = menuRef.current;
      if (refEl && !refEl.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setMenuView("actions");
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
          setAttachmentHint(
            `已检测到 URL — 可直接发送，SlideRule 会尝试抓取摘要`
          );
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

  /** 拖拽与 + 菜单「添加文件或图片」共用：附件名进输入框 + 如实提示解析未接。 */
  const appendAttachmentNames = React.useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const names = files.map(f => f.name).join(", ");
      const suffix = `[附件: ${names}]`;
      // setInput only accepts string; read the current textarea value instead of functional updater.
      const current = textareaRef.current?.value ?? "";
      setInput(current ? `${current}\n${suffix}` : suffix);
      setAttachmentHint(`已添加附件提示：${names}（文件解析服务开发中）`);
      setTimeout(() => setAttachmentHint(null), 5000);
    },
    [setInput]
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      appendAttachmentNames(Array.from(e.dataTransfer.files));
    },
    [appendAttachmentNames]
  );

  const fillExample = React.useCallback(
    (text: string) => {
      setInput(text);
      setIsMenuOpen(false);
      setMenuView("actions");
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
    [setInput]
  );

  // 优化提示词：把输入框里的一句话意图送去真 LLM 通道改写成信息更全的
  // 推演提示词，回填输入框让用户过目再发（不代发）。失败人话提示、不改原文。
  const [isRefining, setIsRefining] = React.useState(false);
  const refinePrompt = React.useCallback(async () => {
    const text = textareaRef.current?.value?.trim() ?? "";
    if (!text || isRefining) return;
    setIsRefining(true);
    try {
      const res = await fetch("/api/sliderule/prompt-refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        text?: string;
        detail?: string;
      };
      if (data.ok && data.text) {
        setInput(data.text);
        setAttachmentHint("提示词已优化——确认或再编辑后发送");
        textareaRef.current?.focus();
      } else {
        setAttachmentHint(
          `优化失败：${data.detail || "服务未响应"}（原文未改动）`
        );
      }
    } catch {
      setAttachmentHint("优化失败：网络异常（原文未改动）");
    } finally {
      setIsRefining(false);
      setTimeout(() => setAttachmentHint(null), 6000);
    }
  }, [isRefining, setInput]);

  const placeholderText = "畅所欲问";

  return (
    <div className="pointer-events-none flex w-[min(820px,calc(100vw-32px))] flex-col items-center gap-2">
      {/* 「本轮 · ...」浮标已移除：话题在顶栏 STATUS 常驻，这里只是重复噪声
          （用户反馈：分散注意力，且与交付物按钮在完成态重叠）。 */}
      {attachmentHint && (
        <div
          className="pointer-events-auto rounded-full border border-[#e5e7eb] bg-white px-3 py-1 text-[11px] text-stone-500 shadow-sm"
          data-testid="sliderule-composer-hint"
        >
          {attachmentHint}
        </div>
      )}
      <div
        className={`pointer-events-auto relative w-full rounded-[14px] border bg-white px-3 py-2.5 shadow-[0_10px_36px_rgb(15_23_42/0.12)] transition-colors ${
          isDragOver ? "border-[#1677ff] bg-[#e6f4ff]/40" : "border-[#e5e7eb]"
        }`}
        data-testid="sliderule-composer-dock"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[12px] bg-[#e6f4ff]/60">
            <div className="flex items-center gap-2 text-sm font-medium text-[#0958d9]">
              <FileText className="h-4 w-4" />
              拖拽文件到这里
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(open => !open);
                setMenuView("actions");
              }}
              disabled={isRunning}
              className="flex h-11 w-11 items-center justify-center rounded-full text-stone-700 transition hover:bg-[#e9edf2] disabled:opacity-45"
              title="更多动作"
              data-testid="sliderule-composer-plus"
            >
              <Plus className="h-5 w-5" />
            </button>
            {/* 隐藏文件选择器：与拖拽同一行为（appendAttachmentNames） */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              data-testid="sliderule-composer-file-input"
              onChange={e => {
                appendAttachmentNames(Array.from(e.target.files ?? []));
                e.target.value = "";
                setIsMenuOpen(false);
              }}
            />

            <div
              data-testid="sliderule-actions-menu"
              className={`absolute bottom-full left-0 z-[80] mb-2 w-[300px] origin-bottom-left rounded-[9px] border border-[#e5e7eb] bg-white p-1.5 shadow-[0_18px_48px_rgb(15_23_42/0.16)] transition-all duration-150 ${
                isMenuOpen
                  ? "translate-y-0 scale-100 opacity-100"
                  : "pointer-events-none translate-y-2 scale-95 opacity-0"
              }`}
            >
              {menuView === "actions" ? (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="sliderule-action-file"
                    className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e9edf2] text-stone-700">
                      <ImagePlus className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-stone-800">
                        添加文件或图片
                      </span>
                      <span className="block truncate text-[10px] text-stone-500">
                        附件名进输入框（解析服务开发中）
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuView("examples")}
                    data-testid="sliderule-action-example"
                    className="mt-1 flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FDF6F1] text-[#C05621]">
                      <Lightbulb className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-stone-800">
                        填入示例意图
                      </span>
                      <span className="block truncate text-[10px] text-stone-500">
                        三条示例应用，填进输入框可再编辑
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      navigate("/agent-loop/skills");
                    }}
                    data-testid="sliderule-action-skills"
                    className="mt-1 flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e6f4ff] text-[#0958d9]">
                      <Blocks className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-stone-800">
                        从技能库选技能
                      </span>
                      <span className="block truncate text-[10px] text-stone-500">
                        已安装技能会自动注入推演
                      </span>
                    </span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setMenuView("actions")}
                    className="flex w-full items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-left text-[11px] text-stone-500 transition hover:bg-[#eef0f4]"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    返回
                  </button>
                  {EXAMPLE_INTENT_TEXTS.map(text => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => fillExample(text)}
                      data-testid="sliderule-example-intent"
                      className="mt-1 block w-full rounded-[7px] px-2.5 py-2 text-left text-xs leading-5 text-stone-700 transition hover:bg-[#eef0f4]"
                    >
                      {text}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 pb-0.5">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={event => {
                setInput(event.target.value);
                requestAnimationFrame(adjustTextareaHeight);
              }}
              onKeyDown={event => {
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
              className="block max-h-28 min-h-11 w-full resize-none bg-transparent px-1 py-2.5 text-[15px] leading-6 text-[#1f2329] outline-none placeholder:text-stone-400 disabled:opacity-60"
              data-testid="sliderule-composer-input"
            />
          </div>

          {/* 优化提示词（用户裁决：原模式切换与左侧 + 菜单重复，改为提示词优化器） */}
          <button
            type="button"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-700 transition hover:bg-[#e9edf2] disabled:opacity-45 sm:flex"
            title="优化提示词：把意图改写得更完整（实体/流程/角色/页面/AI）"
            data-testid="sliderule-prompt-refine"
            onClick={refinePrompt}
            disabled={isRunning || isRefining || !input.trim()}
          >
            {isRefining ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-700 transition hover:bg-[#e9edf2] sm:flex"
            title="语音输入"
            disabled
          >
            <Mic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={isRunning ? stop || (() => {}) : sendMessage}
            disabled={!isRunning && !input.trim()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E08663] to-[#1677ff] text-white shadow-[0_4px_14px_rgb(217_119_87/0.45)] transition hover:from-[#1677ff] hover:to-[#0958d9] disabled:cursor-not-allowed disabled:opacity-35"
            title={isRunning ? "停止" : "发送"}
          >
            {isRunning ? (
              <Square className="h-4 w-4 fill-current" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
