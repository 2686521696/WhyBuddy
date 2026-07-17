import React from "react";
import {
  Blocks,
  Paperclip,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  ImagePlus,
  Lightbulb,
  Loader2,
  Mic,
  Plus,
  SendHorizontal,
  Sparkles,
  Square,
  X,
} from "lucide-react";
// 用 navigate 函数而非 useLocation hook：hook 渲染期就读 window.location，
// 会炸掉 node 环境的静态渲染测试；navigate 只在点击时触达 history。
import { navigate } from "wouter/use-browser-location";
import { EXAMPLE_INTENT_TEXTS } from "./example-intents";
import { shouldSendOnKey } from "./user-prefs";
import {
  installKeyOf,
  loadInjectDisabledKeys,
  loadInstalledSkills,
  toggleInjectDisabled,
  type InstalledSkill,
} from "./installed-skills";

/** E31 图片/PDF 提取结果（后端 /attachments/extract 的诚实回执）。 */
interface AttachmentExtractOutcome {
  ok: boolean;
  context?: string;
  detail?: string;
  chars?: number;
}

/** 附件预览卡的数据形态（图片带 objectURL 缩略图）。 */
interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  previewUrl: string | null;
  /** E28：保留原始 File——发送时文本类附件读内容注入指令上下文 */
  file?: File;
  /** E31：图片/PDF 服务端提取状态（上传即解析，发送时注入缓存结果） */
  extractStatus?: "pending" | "ready" | "failed";
  extractDetail?: string;
  extractChars?: number;
}

// E28 附件上下文注入（第一刀，纯浏览器）：文本类附件直接读内容并入指令。
// E31（本期）：图片走视觉 LLM、PDF 走 E2B 沙盒提取——上传即发服务端解析，
// 发送时注入缓存结果；解析失败如实只带文件名。
const TEXT_ATTACHMENT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|yaml|yml|xml|html?|css|js|jsx|ts|tsx|py|java|go|rs|rb|php|sql|sh|toml|ini|conf|log)$/i;
const EXTRACTABLE_ATTACHMENT_EXT = /\.(png|jpe?g|webp|gif|pdf)$/i;
const MAX_TEXT_ATTACHMENT_BYTES = 200 * 1024;
const MAX_CHARS_PER_ATTACHMENT = 6000;
const MAX_TOTAL_ATTACHMENT_CHARS = 12000;

function isTextAttachment(att: ComposerAttachment): boolean {
  if (!att.file) return false;
  if (EXTRACTABLE_ATTACHMENT_EXT.test(att.name)) return false;
  if (att.file.type.startsWith("text/")) return true;
  return TEXT_ATTACHMENT_EXT.test(att.name);
}

/** E31：该附件是否走服务端提取（图片/PDF）。 */
export function isExtractableAttachment(name: string): boolean {
  return EXTRACTABLE_ATTACHMENT_EXT.test(name);
}

/** E31：上传附件给后端提取内容（图片→视觉 LLM，PDF→E2B 沙盒）。
 *  网络/服务异常一律归一成 ok:false + 人话 detail（诚实降级）。 */
export async function extractAttachmentRemote(
  file: File
): Promise<AttachmentExtractOutcome> {
  try {
    const res = await fetch(
      `/api/sliderule/attachments/extract?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      }
    );
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as AttachmentExtractOutcome;
    if (body.ok && (body.context || "").trim()) return body;
    return { ok: false, detail: body.detail || "服务返回空内容" };
  } catch (e) {
    return { ok: false, detail: `网络异常：${String(e)}` };
  }
}

/** 读文本类附件 + 服务端提取结果拼成注入块；失败/超限附件如实标注"仅文件名"。 */
async function buildAttachmentContext(
  attachments: ComposerAttachment[],
  extractionOf: (att: ComposerAttachment) => Promise<AttachmentExtractOutcome> | null
): Promise<string> {
  const parts: string[] = [];
  let budget = MAX_TOTAL_ATTACHMENT_CHARS;
  for (const att of attachments) {
    if (budget <= 0) break;
    // E31：图片/PDF 用服务端提取缓存（发送时若还在解析则等它落定）
    const pending = extractionOf(att);
    if (pending) {
      const outcome = await pending;
      if (outcome.ok && outcome.context) {
        const limit = Math.min(MAX_CHARS_PER_ATTACHMENT, budget);
        const body = outcome.context.slice(0, limit).trim();
        budget -= body.length;
        parts.push(`【附件内容 · ${att.name}】\n${body}`);
      } else {
        parts.push(
          `【附件 ${att.name}】内容提取失败（${outcome.detail || "未知原因"}），仅携带文件名。`
        );
      }
      continue;
    }
    if (!isTextAttachment(att) || !att.file) continue;
    if (att.size > MAX_TEXT_ATTACHMENT_BYTES) {
      parts.push(`【附件 ${att.name}】文件过大（>200KB），未读取内容。`);
      continue;
    }
    try {
      const raw = await att.file.text();
      const limit = Math.min(MAX_CHARS_PER_ATTACHMENT, budget);
      const clipped = raw.length > limit;
      const body = raw.slice(0, limit).trim();
      budget -= body.length;
      parts.push(
        `【附件内容 · ${att.name}】\n${body}${clipped ? "\n…（内容过长已截断）" : ""}`
      );
    } catch {
      parts.push(`【附件 ${att.name}】读取失败，仅携带文件名。`);
    }
  }
  return parts.join("\n\n");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
  placeholder,
  hero = false,
}: {
  input: string;
  setInput: (v: string) => void;
  /** 无参 = 发 input；带 textOverride = 发合成文本（附件名并入时用） */
  sendMessage: (textOverride?: string) => void;
  isRunning: boolean;
  goal: string;

  hintChips?: string[];
  stop?: () => void;
  /** E34.1 空态首页嵌入时的占位文案（墨刀式 hero 输入区） */
  placeholder?: string;
  /** E34.2 hero 变体（墨刀式多行大框）：文字区在上、操作排在底行 */
  hero?: boolean;
}) {
  // 模式选择器已删（用户裁决 2026-07-10）：深思一轮就是唯一产品路径
  // （Python drive-full-stream 一条消息推到闭环），持续推演是浏览器端
  // 马拉松遗留、还会丢实时流——引擎能力保留在 Dev 面，不再出现在产品面。
  // + 菜单改为 Claude 式实用动作：文件 / 示例意图 / 技能库（就地勾选）。
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [menuView, setMenuView] = React.useState<
    "actions" | "examples" | "skills"
  >("actions");
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
    const minH = hero ? 96 : 44;
    const maxH = hero ? 200 : 112;
    if (!ta.value.trim()) {
      ta.style.height = `${minH}px`;
      return;
    }
    ta.style.height = "auto";
    ta.style.height = `${Math.max(minH, Math.min(ta.scrollHeight, maxH))}px`;
  }, [hero]);

  React.useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // Listen for example prompt clicks from ClaudeChatSurface empty state.
  // E34：模板可为空串（「应用推演」模式卡）——空串也生效（清空回纯输入），
  // 都聚焦输入框让用户接着打字。
  React.useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (typeof text === "string") {
        setInput(text);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    };
    window.addEventListener("sliderule:fill-prompt", handler);
    return () => window.removeEventListener("sliderule:fill-prompt", handler);
  }, [setInput]);

  // E34 快速开始「从需求文档开始」：空态卡片直接拉起附件选择器
  React.useEffect(() => {
    const handler = () => fileInputRef.current?.click();
    window.addEventListener("sliderule:open-file-picker", handler);
    return () =>
      window.removeEventListener("sliderule:open-file-picker", handler);
  }, []);

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

  // 附件预览卡（Claude 式）：图片出缩略图、其他文件出文件卡，可逐个移除。
  // E28：文本类附件发送时读内容注入指令；二进制仍如实只带文件名。
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>(
    []
  );
  const attachmentSeq = React.useRef(0);
  // E31：附件 id → 服务端提取 promise（上传即解析；发送时 doSend 等它落定。
  // 移除附件不取消请求——结果落定后 setAttachments 找不到卡片就自然丢弃）
  const extractPromises = React.useRef(
    new Map<string, Promise<AttachmentExtractOutcome>>()
  );

  const addAttachments = React.useCallback((files: File[]) => {
    if (!files.length) return;
    const items = files.map(f => ({
      id: `att-${++attachmentSeq.current}`,
      name: f.name,
      size: f.size,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      file: f,
      extractStatus: isExtractableAttachment(f.name)
        ? ("pending" as const)
        : undefined,
    }));
    setAttachments(prev => [...prev, ...items]);
    // E31：图片/PDF 上传即解析（视觉 LLM 实测可到 100s+，藏进等待期）
    for (const item of items) {
      if (item.extractStatus !== "pending" || !item.file) continue;
      const promise = extractAttachmentRemote(item.file);
      extractPromises.current.set(item.id, promise);
      void promise.then(outcome => {
        setAttachments(prev =>
          prev.map(a =>
            a.id === item.id
              ? {
                  ...a,
                  extractStatus: outcome.ok ? "ready" : "failed",
                  extractDetail: outcome.detail,
                  extractChars: outcome.ok
                    ? (outcome.context || "").length
                    : undefined,
                }
              : a
          )
        );
      });
    }
  }, []);

  const removeAttachment = React.useCallback((id: string) => {
    extractPromises.current.delete(id);
    setAttachments(prev => {
      const hit = prev.find(a => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  // 卸载时回收全部 objectURL（防泄漏）
  const attachmentsRef = React.useRef(attachments);
  attachmentsRef.current = attachments;
  React.useEffect(
    () => () => {
      for (const a of attachmentsRef.current) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    },
    []
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      addAttachments(Array.from(e.dataTransfer.files));
    },
    [addAttachments]
  );

  /** 发送：有附件时把附件名 + 文本类附件内容并进消息，发完清预览卡。 */
  const doSend = React.useCallback(() => {
    if (isRunning) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (attachments.length > 0) {
      const snapshot = attachments;
      setAttachments(prev => {
        for (const a of prev) {
          if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
        }
        return [];
      });
      const promiseMap = extractPromises.current;
      extractPromises.current = new Map();
      void (async () => {
        const names = snapshot.map(a => a.name).join(", ");
        const context = await buildAttachmentContext(snapshot, att =>
          promiseMap.get(att.id) ?? null
        );
        const head = text ? `${text}\n[附件: ${names}]` : `[附件: ${names}]`;
        sendMessage(context ? `${head}\n\n${context}` : head);
      })();
    } else {
      sendMessage();
    }
  }, [isRunning, input, attachments, sendMessage]);

  // 已安装技能（+ 菜单就地勾选哪些注入推演）；打开 skills 视图时重读
  const [installedSkills, setInstalledSkills] = React.useState<
    InstalledSkill[]
  >([]);
  const [injectDisabled, setInjectDisabled] = React.useState<string[]>([]);
  const openSkillsView = React.useCallback(() => {
    setInstalledSkills(loadInstalledSkills());
    setInjectDisabled(loadInjectDisabledKeys());
    setMenuView("skills");
  }, []);

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

  const placeholderText = placeholder || "畅所欲问";

  return (
    <div className={`pointer-events-none flex flex-col items-center gap-2 ${hero ? "w-full" : "w-[min(820px,calc(100vw-32px))]"}`}>
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
        className={`pointer-events-auto relative w-full border bg-white shadow-[0_10px_36px_rgb(15_23_42/0.12)] transition-colors ${hero ? "rounded-[16px] px-4 py-3.5" : "rounded-[14px] px-3 py-2.5"} ${
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
        {/* 附件预览卡（Claude 式）：图片缩略图 / 文件卡 + 移除钮 */}
        {attachments.length > 0 && (
          <div
            className="mb-2 flex flex-wrap gap-2"
            data-testid="sliderule-attachments"
          >
            {attachments.map(att => (
              <div
                key={att.id}
                className="group relative flex items-center gap-2 rounded-[9px] border border-[#e5e7eb] bg-[#f8f9fb] p-1.5 pr-2.5"
                data-testid="sliderule-attachment-card"
              >
                {att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className="h-10 w-10 rounded-[6px] object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[#e9edf2] text-stone-500">
                    <FileText className="h-4 w-4" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block max-w-[160px] truncate text-[11px] font-medium text-stone-700">
                    {att.name}
                  </span>
                  {/* E31 提取状态如实展示：解析中/已解析/失败（失败悬停看原因） */}
                  <span
                    className="block text-[10px] text-stone-400"
                    title={att.extractStatus === "failed" ? att.extractDetail : undefined}
                    data-testid={`sliderule-attachment-status-${att.extractStatus ?? "none"}`}
                  >
                    {formatFileSize(att.size)}
                    {att.extractStatus === "pending" && " · 解析中…"}
                    {att.extractStatus === "ready" &&
                      ` · 已解析 ${att.extractChars ?? 0} 字`}
                    {att.extractStatus === "failed" && " · 解析失败，仅带文件名"}
                    {!att.extractStatus &&
                      (isTextAttachment(att)
                        ? " · 发送时注入内容"
                        : " · 仅随消息带文件名")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  data-testid="sliderule-attachment-remove"
                  title="移除附件"
                  className="absolute -right-1.5 -top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-stone-400 opacity-0 shadow-sm transition hover:text-stone-700 focus:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={hero ? "flex flex-wrap items-center gap-2" : "flex items-end gap-2"}>
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
            {/* 隐藏文件选择器：与拖拽同一行为（addAttachments 出预览卡） */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              data-testid="sliderule-composer-file-input"
              onChange={e => {
                addAttachments(Array.from(e.target.files ?? []));
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
                        预览卡进输入条，文本类附件内容随消息注入
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

                  {/* 就地勾选（用户反馈：跳走了看不到选择）——二级视图列已安装技能 */}
                  <button
                    type="button"
                    onClick={openSkillsView}
                    data-testid="sliderule-action-skills"
                    className="mt-1 flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e6f4ff] text-[#0958d9]">
                      <Blocks className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-stone-800">
                        选择注入的技能
                      </span>
                      <span className="block truncate text-[10px] text-stone-500">
                        勾选的已安装技能随推演注入
                      </span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-stone-300" />
                  </button>
                </>
              ) : menuView === "skills" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMenuView("actions")}
                    className="flex w-full items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-left text-[11px] text-stone-500 transition hover:bg-[#eef0f4]"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    返回
                  </button>
                  {installedSkills.length === 0 ? (
                    <div className="px-2.5 py-3 text-center text-[11px] text-stone-400">
                      还没有安装技能
                    </div>
                  ) : (
                    <div className="max-h-[260px] overflow-y-auto">
                      {installedSkills.map(skill => {
                        const key = installKeyOf(skill);
                        const enabled = !injectDisabled.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() =>
                              setInjectDisabled(toggleInjectDisabled(key))
                            }
                            data-testid="sliderule-skill-toggle"
                            title={enabled ? "点击取消注入" : "点击恢复注入"}
                            className="mt-1 flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4]"
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                                enabled
                                  ? "border-[#1677ff] bg-[#1677ff] text-white"
                                  : "border-[#d3d8e0] bg-white"
                              }`}
                            >
                              {enabled && <Check className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-xs font-medium ${
                                  enabled ? "text-stone-800" : "text-stone-400"
                                }`}
                              >
                                {skill.name}
                              </span>
                              <span className="block truncate text-[10px] text-stone-400">
                                {skill.description || skill.repo}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setMenuView("actions");
                      navigate("/agent-loop/skills");
                    }}
                    data-testid="sliderule-skills-manage"
                    className="mt-1 flex w-full items-center justify-center gap-1 rounded-[7px] border-t border-[#f0f0f0] px-2.5 py-2 text-[11px] text-[#1677ff] transition hover:bg-[#eef0f4]"
                  >
                    管理技能库（安装 / 卸载）
                    <ChevronRight className="h-3 w-3" />
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

          {/* E34.2 hero 底行：显式「上传资料」按钮（与 + 菜单里的文件入口
              同一 fileInputRef，效果图的主入口位） */}
          {hero && (
            <button
              type="button"
              disabled={isRunning}
              onClick={() => fileInputRef.current?.click()}
              data-testid="sliderule-hero-upload"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border border-[#e5e7eb] bg-white px-3 text-[13px] text-stone-600 transition hover:border-[#d3d8e0] hover:bg-[#eef0f4] disabled:opacity-45"
            >
              <Paperclip className="h-3.5 w-3.5" />
              上传资料
            </button>
          )}

          <div className={hero ? "order-first basis-full" : "min-w-0 flex-1 pb-0.5"}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={event => {
                setInput(event.target.value);
                requestAnimationFrame(adjustTextareaHeight);
              }}
              onKeyDown={event => {
                // Enter 行为偏好（设置页可切 Enter/Ctrl+Enter 发送）
                if (shouldSendOnKey(event)) {
                  event.preventDefault();
                  doSend();
                }
              }}
              onPaste={handlePaste}
              placeholder={placeholderText}
              aria-label={placeholderText}
              rows={1}
              disabled={isRunning}
              className={`block w-full resize-none bg-transparent text-[15px] leading-6 text-[#1f2329] outline-none placeholder:text-stone-400 disabled:opacity-60 ${hero ? "max-h-[200px] min-h-24 px-1 py-1" : "max-h-28 min-h-11 px-1 py-2.5"}`}
              data-testid="sliderule-composer-input"
            />
          </div>

          {/* 优化提示词（用户裁决：原模式切换与左侧 + 菜单重复，改为提示词优化器） */}
          <button
            type="button"
            className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-700 transition hover:bg-[#e9edf2] disabled:opacity-45 sm:flex ${hero ? "ml-auto" : ""}`}
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
            onClick={isRunning ? stop || (() => {}) : doSend}
            disabled={!isRunning && !input.trim() && attachments.length === 0}
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
