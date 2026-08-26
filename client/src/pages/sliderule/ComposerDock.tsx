import React from "react";
import { createPortal } from "react-dom";
import {
  AppWindow,
  Blocks,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  ImagePlus,
  Lightbulb,
  Loader2,
  Plus,
  ArrowUp,
  Sparkles,
  Square,
  Monitor,
  Palette,
  Smartphone,
  X,
} from "lucide-react";
// 用 navigate 函数而非 useLocation hook：hook 渲染期就读 window.location，
// 会炸掉 node 环境的静态渲染测试；navigate 只在点击时触达 history。
import { navigate } from "wouter/use-browser-location";
import { EXAMPLE_INTENT_TEXTS } from "./example-intents";
import {
  loadPreferredDevice,
  setPreferredDevice,
  shouldSendOnKey,
} from "./user-prefs";
import {
  COMPOSER_DEVICE_OPTIONS,
  composerHeroPlaceholder,
  type ComposerDevice,
} from "./composer-device";
import {
  FREE_STYLE_HINT,
  FREE_STYLE_LABEL,
  findDesignSystem,
  isCustomDesignSystem,
  loadDesignSystemId,
  saveDesignSystemId,
} from "./design-system";
import { DesignSystemSwatch } from "./DesignSystemSwatch";
import { useDesignSystemPanel } from "./DesignSystemContext";
import { DesignSystemRail } from "./DesignSystemRail";
import { intakeHintYieldsToScopeCard, useIntakeJudge } from "./use-intake-judge";
import { IntakeHintBar, INTAKE_JUDGING_LABEL } from "./IntakeHintBar";
import { ScopeCard } from "./ScopeCard";
import type { ScopeCardPending } from "./scope-card-gate";
import {
  installKeyOf,
  loadInjectDisabledKeys,
  loadInstalledSkills,
  toggleInjectDisabled,
  type InstalledSkill,
} from "./installed-skills";
import {
  applyRehearsalSlashPick,
  applySlashPick,
  filterSlashItems,
  moveHighlight,
  REHEARSAL_SLASH_ITEMS,
  seedSlash,
  slashQueryAt,
  type SlashItem,
} from "./composer-slash";
import {
  BUILTIN_PARTNERS,
  loadPartners,
  partnerCapabilities,
  type Partner,
} from "./partners";
import { CapabilityChip, ComposerSlashMenu } from "./ComposerSlashMenu";
import { listConnectors, type ConnectorSpec } from "./connectors-client";
import {
  loadTurnCapabilities,
  saveTurnCapabilities,
  takePendingOpener,
} from "./turn-capabilities";
import {
  applyChallengePrefillToComposer,
  CHALLENGE_PREFILL_EVENT,
} from "./challenge-composer";

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

/**
 * 是否还有附件在「解析中」。
 *
 * 2026-08-20 真机：缩略图写着「解析中…」，发送键却是亮的。点下去
 * 旧逻辑会立刻清掉附件卡、在后台等提取再发——用户没法改口，看起来
 * 像发出去了。LobeChat（`isUploadingFiles` 同时闸 disabled 和 handleSend）
 * 与 LibreChat（`filesLoading` 闸 SendButton；#2078 专门修了「只禁按钮、
 * Enter 照样发」）都是同一条：任一文件未就绪就不许提交。
 *
 * failed 不算 pending——提取失败本来就 fail-open 只带文件名，不能把发送锁死。
 */
export function isAttachmentExtractPending(
  attachments: Array<{ extractStatus?: "pending" | "ready" | "failed" }>
): boolean {
  return attachments.some(a => a.extractStatus === "pending");
}

/**
 * 发送键该不该灰。推演中发送仍是发送（排队到下一轮），空输入仍灰。
 * 停止是另一颗方块按钮，不把发送变成停止。
 * 空输入且无附件 → 灰；任一附件解析中 → 灰。
 * 入站审查 / 优化提示词在飞 → 灰（2026-08-20：生成审查卡时发送仍亮，
 * 半成品意图会被直接推演；优化同理，改写还没回填就能把原文发出去）。
 */
export function isComposerSendBlocked(opts: {
  isRunning: boolean;
  input: string;
  attachments: Array<{ extractStatus?: "pending" | "ready" | "failed" }>;
  isJudging?: boolean;
  isRefining?: boolean;
  /** 范围卡停泊时发送只能走确认/先改范围，Enter 不得另 park 一发。 */
  scopeCardOpen?: boolean;
  askOpen?: boolean;
}): boolean {
  if (opts.scopeCardOpen || opts.askOpen) return true;
  if (opts.isJudging || opts.isRefining) return true;
  if (isAttachmentExtractPending(opts.attachments)) return true;
  return !opts.input.trim() && opts.attachments.length === 0;
}

/** 视觉 LLM 实测可到 100s+；超时必须 fail-open，否则发送键永远灰着。 */
export const EXTRACT_CLIENT_TIMEOUT_MS = 180_000;

/** E31：上传附件给后端提取内容（图片→视觉 LLM，PDF→E2B 沙盒）。
 *  网络/服务异常/超时一律归一成 ok:false + 人话 detail（诚实降级）。 */
export async function extractAttachmentRemote(
  file: File
): Promise<AttachmentExtractOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EXTRACT_CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(
      `/api/sliderule/attachments/extract?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
        signal: ctrl.signal,
      }
    );
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as AttachmentExtractOutcome;
    if (body.ok && (body.context || "").trim()) return body;
    return { ok: false, detail: body.detail || "服务返回空内容" };
  } catch (e) {
    const aborted =
      (typeof DOMException !== "undefined" &&
        e instanceof DOMException &&
        e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) return { ok: false, detail: "解析超时，仅携带文件名" };
    return { ok: false, detail: `网络异常：${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 读文本类附件 + 服务端提取结果拼成注入块；失败/超限附件如实标注"仅文件名"。 */
async function buildAttachmentContext(
  attachments: ComposerAttachment[],
  extractionOf: (
    att: ComposerAttachment
  ) => Promise<AttachmentExtractOutcome> | null
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

/**
 * 附件缩略图点击放大（2026-08-20）。
 *
 * 缩略图只有 40×40，真机上传截图后根本看不清内容。抽成展示组件而不是
 * 内联在 ComposerDock 的 state 里，是因为仓库没有 jsdom，SSR 测不到
 * 「点开之后」那一帧；这里 props 进来就能 renderToStaticMarkup。
 *
 * ⚠ 必须 createPortal 到 document.body：首页 composer 嵌在 Studio 的
 * overflow-hidden 列里，fixed 遮罩写在输入条内部会被裁掉，点了像没反应。
 */
export function AttachmentImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      data-testid="sliderule-attachment-lightbox"
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        data-testid="sliderule-attachment-lightbox-close"
        title="关闭预览"
        aria-label="关闭预览"
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow hover:bg-white"
      >
        <X className="h-4 w-4" />
      </button>
      <img
        src={src}
        alt={name}
        data-testid="sliderule-attachment-lightbox-image"
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
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
  hasApp = false,
  appSummary = "",
  hintChips = [],
  statusPill = null,
  pendingScope = null,
  pendingAsk = null,
  onConfirmScope,
  onReviseScope,
  onAnswerAsk,
  onDismissAsk,
}: {
  input: string;
  setInput: (v: string) => void;
  /** 无参 = 发 input；带 textOverride = 发合成文本（附件名并入时用） */
  sendMessage: (textOverride?: string) => void;
  isRunning: boolean;
  goal: string;
  /** 控制面范围卡。确认走 confirmControlScope → forcedTool rehearse。 */
  pendingScope?: ScopeCardPending | null;
  pendingAsk?: { question: string; options?: string[] } | null;
  onConfirmScope?: () => void;
  onReviseScope?: () => void;
  onAnswerAsk?: (text: string) => void;
  onDismissAsk?: () => void;

  /** 会话里是否已经有一个成形的应用（由五系统模型判定，见 SlideRule.tsx）。
   *  入站判定按这个切规则域：没应用时首轮描述算 real，有应用时算 iteration。 */
  hasApp?: boolean;

  /** 当前应用摘要，喂给入站判定让引导话术具体到这个应用（缺省则话术泛化，
   *  不影响判定结果本身）。 */
  appSummary?: string;

  hintChips?: string[];
  /** 闭环/缺口胶囊。主文案是已收口/未收口，分数在 title。 */
  statusPill?: { label: string; blocked?: boolean; title?: string } | null;
  stop?: () => void;
  /** 空态首页嵌入时的占位文案 */
  placeholder?: string;
  /** 空态变体：Cursor / Continue 卡片——字在上、工具行在下；开聊后仍是胶囊。 */
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
  const [device, setDevice] =
    React.useState<ComposerDevice>(loadPreferredDevice);
  // 设计系统（2026-08-24）。Stitch / TRAE 都把它做成画布右侧面板，但我们不是
  // 画布模式——按用户裁决合并进指令框，和「应用 / Web」并排。
  const [localDesignSystemId, setLocalDesignSystemId] = React.useState<
    string | null
  >(loadDesignSystemId);
  const designPanel = useDesignSystemPanel();
  const designAnchorRef = React.useRef<HTMLDivElement | null>(null);
  // 有 Provider 就以它为准（面板保存后作曲家立刻跟着变）；没有则用本地态，
  // 这样单测/应用中心那边不挂 Provider 也能正常渲染。
  const designSystemId = designPanel
    ? designPanel.appliedId
    : localDesignSystemId;
  const setDesignSystemId = (id: string) => {
    if (designPanel) designPanel.apply(id);
    else setLocalDesignSystemId(id);
  };
  // null = 用户还没选：按钮显示图标而不是色块（2026-08-25 用户裁决）。
  const designSystem = designSystemId ? findDesignSystem(designSystemId) : null;
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
    // 开聊后胶囊单行约 28px；空态 Cursor 卡片要有一块可点的字区
    // （Continue InputToolbar 在编辑器下面，上面得留行）。
    const minH = hero ? 72 : 28;
    const maxH = 160;
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

  // M5/PR-1：质疑按钮预填作曲家并聚焦，不弹 window.prompt、不立刻点火。
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ text?: string; targetLabel?: string | null }>
      ).detail;
      applyChallengePrefillToComposer(setInput, detail);
      setTimeout(() => textareaRef.current?.focus(), 50);
    };
    window.addEventListener(CHALLENGE_PREFILL_EVENT, handler);
    return () => window.removeEventListener(CHALLENGE_PREFILL_EVENT, handler);
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
            `已检测到 URL — 可直接发送，面团 AI 会尝试抓取摘要`
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
  const [lightbox, setLightbox] = React.useState<{
    src: string;
    name: string;
  } | null>(null);
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

  // 优化提示词进行中：锁发送，避免改写还没回填就把原文推出去。
  const [isRefining, setIsRefining] = React.useState(false);
  // 入站判定：推演中不判（用户这会儿打的字多半是下一轮的草稿，判了也没用）。
  // 语境用 hasApp（真有成形应用）而不是 Boolean(goal)（只是有目标文案），
  // 摘要让引导话术具体到这个应用而不是泛泛的"指出当前应用要怎么改"。
  const { judgement, isJudging } = useIntakeJudge(
    input,
    hasApp,
    !isRunning,
    appSummary
  );

  /** 发送：有附件时把附件名 + 文本类附件内容并进消息，发完清预览卡。
   *  解析中直接拒绝——不清附件、不排队等提取。LobeChat handleSend 在
   *  isUploadingFiles 时 return；只靠按钮 disabled 挡不住 Enter。
   *  审查/优化在飞同样拒绝——生成卡的时候发送必须灰。 */
  const doSend = React.useCallback(() => {
    // 开关在 React 态里，发送却读 localStorage。点了「应用」如果没写进
    // 存储（隐私模式 / 只改了画面），推演仍按 desktop 出 PC 端。
    setPreferredDevice(device);
    // 运行中也走 sendMessage：那边排队，这里不许改成 stop。
    if (
      isComposerSendBlocked({
        isRunning,
        input,
        attachments,
        isJudging,
        isRefining,
        scopeCardOpen: Boolean(pendingScope),
        askOpen: Boolean(pendingAsk),
      })
    )
      return;
    const text = input.trim();
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
        const context = await buildAttachmentContext(
          snapshot,
          att => promiseMap.get(att.id) ?? null
        );
        const head = text ? `${text}\n[附件: ${names}]` : `[附件: ${names}]`;
        sendMessage(context ? `${head}\n\n${context}` : head);
      })();
    } else {
      sendMessage();
    }
  }, [
    isRunning,
    input,
    attachments,
    sendMessage,
    isJudging,
    isRefining,
    device,
    pendingScope,
    pendingAsk,
  ]);

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

  /* ─────────────────────────── `/` 能力选择器（扩展中心）
   *
   * 判定层在 composer-slash.ts（纯函数、逐条做过变异）；这里只接线。
   *
   * ⚠ 光标位置不能只在 onChange 里读：用方向键把光标挪进/挪出斜杠段时
   *   value 没变，onChange 不触发，面板会挂在那儿吃掉回车。所以 onSelect
   *   也重算一遍（它在光标移动时触发）。
   */
  const [connectors, setConnectors] = React.useState<ConnectorSpec[]>([]);
  /*
   * 清单取到了没有。
   *
   * ⚠ 2026-08-26 用户报"选了之后框里啥也没有"，根因就在这里：
   *   listConnectors() 失败时按设计返回空数组（它挂在输入框上，不能让一次
   *   后端抖动把打字也拦住）。可我**只在挂载时取一次**——那一次赶上后端在
   *   重启，这个页面就一辈子认为"这台机器上没有连接器"。
   *   然后伙伴全被标成「还缺: 天气」，点下去 partnerCapabilities 过滤完是空
   *   数组，什么也挂不上，**静默无反应**。
   *
   *   「没问到」和「真的没有」是两回事，把前者显示成后者就是在撒谎。
   */
  const [connectorLoad, setConnectorLoad] = React.useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [picked, setPicked] = React.useState<SlashItem[]>(() =>
    loadTurnCapabilities()
  );
  const [slash, setSlash] = React.useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [slashIndex, setSlashIndex] = React.useState(0);

  const refreshConnectors = React.useCallback(async () => {
    setConnectorLoad(prev => (prev === "ready" ? prev : "loading"));
    const list = await listConnectors();
    setConnectors(list);
    // 空清单**不算取到**：后端好好的时候至少有内置那两个，空只可能是没问到。
    setConnectorLoad(list.length > 0 ? "ready" : "failed");
    return list;
  }, []);

  React.useEffect(() => {
    void refreshConnectors();
  }, [refreshConnectors]);

  /* 从「扩展中心」页点「用这个伙伴」过来的起手意图。
     ⚠ take 语义：取一次就清掉（见 turn-capabilities.takePendingOpener）。
       不清的话用户以后不管从哪进推演，输入框都会自己填上上次那句话。 */
  React.useEffect(() => {
    const opener = takePendingOpener();
    if (!opener) return;
    setInput(opener);
    requestAnimationFrame(() => {
      adjustTextareaHeight();
      textareaRef.current?.focus();
    });
  }, [setInput, adjustTextareaHeight]);

  /** 可选能力池：已安装技能 + 后端报上来的连接器。伙伴见「技能·连接器·伙伴」页。 */
  const slashPool = React.useMemo<SlashItem[]>(() => {
    const skills: SlashItem[] = loadInstalledSkills().map(sk => ({
      key: installKeyOf(sk),
      kind: "skill" as const,
      name: sk.name,
      description: sk.description || "",
    }));
    const conns: SlashItem[] = connectors.map(c => ({
      key: c.id,
      kind: "connector" as const,
      name: c.name,
      description: c.description,
      // 不可用的照样列出来并说明缺什么（后端 /connectors 也是这个判断）
      unavailable: c.available ? undefined : `${c.name}还没配置凭据`,
    }));
    /* 伙伴也进 `/`：它就是"一次挂好几个 + 一句起手意图"，在输入框里一步到位
       比先跳去库页再跳回来顺手得多。⚠ 依赖不齐的照样列出来并说明缺什么。 */
    const available = {
      connectorIds: connectors.filter(c => c.available).map(c => c.id),
      skillKeys: loadInstalledSkills().map(installKeyOf),
    };
    const partners: SlashItem[] = [...BUILTIN_PARTNERS, ...loadPartners()].map(
      pt => {
        const missing = pt.needs.filter(n =>
          n.kind === "connector"
            ? !available.connectorIds.includes(n.key)
            : !available.skillKeys.includes(n.key)
        );
        /* ⚠ 清单还没问到时**不许**说"还缺 X"——那是把"我不知道"说成
           "你没有"。用户看到的会是一排莫名其妙的缺件提示，而其实什么都不缺。 */
        const unavailable =
          connectorLoad !== "ready" && pt.needs.some(n => n.kind === "connector")
            ? "连接器清单没取到 — 后端可能没起来，点一下重试"
            : missing.length
              ? `还缺：${missing.map(m => m.name).join("、")}`
              : undefined;
        return {
          key: pt.id,
          kind: "partner" as const,
          name: pt.name,
          description: pt.description,
          unavailable,
        };
      }
    );
    return [...REHEARSAL_SLASH_ITEMS, ...conns, ...skills, ...partners];
  }, [connectors, connectorLoad]);

  const partnerById = React.useMemo(() => {
    const map = new Map<string, Partner>();
    for (const pt of [...BUILTIN_PARTNERS, ...loadPartners()]) map.set(pt.id, pt);
    return map;
  }, [connectors]);

  const slashItems = React.useMemo(
    () => (slash ? filterSlashItems(slashPool, slash.query) : []),
    [slash, slashPool]
  );

  const syncSlash = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const next = slashQueryAt(ta.value, ta.selectionStart ?? 0);
    setSlash(prev => {
      /* 面板刚被唤起、而清单上次没取到 → 顺手补一次。
         ⚠ 这是唯一一个"用户明确要看这份清单"的时刻，重试放这儿最省事也最
           准；挂载时那一次赶上后端重启就永远错过了。 */
      if (next && !prev && connectorLoad === "failed") void refreshConnectors();
      return next;
    });
    setSlashIndex(0);
  }, [connectorLoad, refreshConnectors]);

  /*
   * 「/ 技能·连接器」那颗提示钮**替用户打这个斜杠**。
   *
   * 2026-08-26 用户反馈：输入框里没有任何东西告诉人可以打 `/`。斜杠唤起是
   * 学来的手势，不写出来就等于没有——这条链路（技能/连接器挂到这一轮）
   * 最主要的入口一直藏着。
   *
   * ⚠ 点它是**真的往正文插一个 `/`**，不是另开一个假面板。理由是别让同一件
   *   事有两套状态：面板的开关、筛选、回车选中全都吊在 `slashQueryAt(正文)`
   *   上（见 composer-slash.ts）。绕过正文另设一个 open 标志，等于把判定
   *   摊成两处，改一处不报错、只有一半生效——仓里第四条。
   *
   * ⚠ 插之前要看前一个字符：`slashQueryAt` 只认行首或空白后面的斜杠
   *   （`https://`、`2026/08/25` 不该弹）。紧挨着字打进去面板不会弹，
   *   用户看到的就是"点了没反应"。所以必要时先补一个空格。
   */
  const slashSeedRef = React.useRef(false);

  const openSlashPicker = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const seeded = seedSlash(ta.value, ta.selectionStart ?? ta.value.length);
    const caret = seeded.caret;
    slashSeedRef.current = true;
    setInput(seeded.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      adjustTextareaHeight();
      syncSlash();
    });
  }, [setInput, adjustTextareaHeight, syncSlash]);

  /** 挂不上时给出的人话原因（画在面板底部）。挂上了就清空。 */
  const [slashNote, setSlashNote] = React.useState("");
  /*
   * 鼠标正按在面板里。
   *
   * ⚠ 面板的按钮用的是 onMouseDown + preventDefault（本意是"别让 textarea
   *   失焦，否则面板先关、点击落空"）。真机上**兜不住**：点一个挂不上的条目
   *   时，textarea 照样 blur，onBlur 把面板和刚设好的提示一起清掉——用户看到
   *   的还是"点了没反应"，跟没修一样。
   *   所以另加一道显式守卫：面板里按下鼠标时置位，onBlur 见到它就不关。
   *   （preventDefault 那行留着——它在正常路径上确实省掉一次焦点抖动。）
   */
  const slashPointerRef = React.useRef(false);

  /**
   * 关掉面板。
   *
   * ⚠ **提示钮插进去的那个 `/` 要一起收走。** 不收的话：点了提示钮、又按 Esc
   *   或点到别处，输入框里就白白多出一个斜杠（还可能带着刚打的半个词），
   *   下一步直接发出去，那个 `/天` 会跟着进提示词被模型当成用户的措辞。
   *   用户自己手打的斜杠**不动**——那是他正在写的字。
   */
  const dismissSlash = React.useCallback(() => {
    if (slashSeedRef.current && slash) {
      const applied = applySlashPick(input, slash);
      setInput(applied.text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.setSelectionRange(applied.caret, applied.caret);
        adjustTextareaHeight();
      });
    }
    slashSeedRef.current = false;
    setSlash(null);
    setSlashNote("");
  }, [slash, input, setInput, adjustTextareaHeight]);

  const pickCapability = React.useCallback(
    (item: SlashItem) => {
      /*
       * ⚠ **挂不上任何东西时不许静默关掉面板。**
       *
       *   2026-08-26 用户报的原话是"为啥选择了之后，框里面啥也没有"。
       *   当时三个伙伴的依赖全都没就位（连接器清单没取到），
       *   partnerCapabilities 过滤完返回空数组，于是：面板关了、正文空着、
       *   标签一个没有——用户完全看不出发生了什么，只知道点了没反应。
       *
       *   一个看着能选、选了没反应的条目，比这个条目干脆不存在更糟。
       */
      if (item.unavailable) {
        const preview =
          item.kind === "partner" ? partnerById.get(item.key) : null;
        const usable = preview
          ? partnerCapabilities(preview, {
              connectorIds: connectors.filter(c => c.available).map(c => c.id),
              skillKeys: loadInstalledSkills().map(installKeyOf),
            })
          : [];
        if (usable.length === 0) {
          setSlashNote(`「${item.name}」现在挂不上：${item.unavailable}`);
          if (connectorLoad === "failed") void refreshConnectors();
          return; // 面板留着，让用户看见原因
        }
      }
      setSlashNote("");
      const ta = textareaRef.current;
      if (item.kind === "rehearsal") {
        const applied =
          ta && slash
            ? applyRehearsalSlashPick(ta.value, slash, item)
            : { text: `/${item.name}`, caret: item.name.length + 1 };
        setInput(applied.text);
        slashSeedRef.current = false;
        setSlash(null);
        setSlashIndex(0);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(applied.caret, applied.caret);
          adjustTextareaHeight();
        });
        return;
      }
      if (ta && slash) {
        const applied = applySlashPick(ta.value, slash);
        setInput(applied.text);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(applied.caret, applied.caret);
          adjustTextareaHeight();
        });
      }
      /*
       * 选中伙伴 = **把它要的能力挂上**，而不是挂一枚"伙伴"芯片。
       * 芯片要能一个个摘掉，用户才控制得住这一轮到底带了什么；挂个伙伴
       * 芯片的话，他看不见里面是哪几样，摘也只能整包摘。
       */
      const partner = item.kind === "partner" ? partnerById.get(item.key) : null;
      const incoming: SlashItem[] = partner
        ? partnerCapabilities(partner, {
            connectorIds: connectors.filter(c => c.available).map(c => c.id),
            skillKeys: loadInstalledSkills().map(installKeyOf),
          })
        : [item];
      setPicked(prev => {
        // 重复选同一个不叠加（用户连着敲两次 / 手滑）
        const next = [...prev];
        for (const one of incoming) {
          if (next.some(p => p.kind === one.kind && p.key === one.key)) continue;
          next.push(one);
        }
        if (next.length === prev.length) return prev;
        saveTurnCapabilities(next);
        return next;
      });
      /*
       * ⚠ **不往输入框灌起手意图。** 2026-08-26 用户指着 TRAE 的截图纠正：
       *   `/` 选完之后，输入框里应该只多出一枚能力标签，"然后后面再跟提示词
       *   指令"——那句指令是用户自己写的。我们原来是把伙伴那段几十字的起手
       *   意图整段灌进去，用户一进来就要先删掉别人替他写的话。
       *
       *   库页上那颗「用这个伙伴」按钮**保留**灌起手意图：那是"照这个模板
       *   开一局"的显式动作，跟"我正在打字，顺手挂个能力"是两回事。
       */
      /* ⚠ 选中成功时**不能**走 dismissSlash：applySlashPick 上面已经把
         `/查询串` 摘掉了，再摘一次会啃掉正文里紧挨着的字。这里只清标记。 */
      slashSeedRef.current = false;
      setSlash(null);
      setSlashIndex(0);
    },
    [
      slash,
      setInput,
      adjustTextareaHeight,
      partnerById,
      connectors,
      connectorLoad,
      refreshConnectors,
    ]
  );

  const removeCapability = React.useCallback((item: SlashItem) => {
    setPicked(prev => {
      const next = prev.filter(p => !(p.kind === item.kind && p.key === item.key));
      saveTurnCapabilities(next);
      return next;
    });
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

  const placeholderText =
    placeholder || (hero ? composerHeroPlaceholder(device) : "畅所欲问");

  const extractPending = isAttachmentExtractPending(attachments);
  const sendBusy = extractPending || isJudging || isRefining;
  const sendBlocked = isComposerSendBlocked({
    isRunning,
    input,
    attachments,
    isJudging,
    isRefining,
    scopeCardOpen: Boolean(pendingScope),
    askOpen: Boolean(pendingAsk),
  });

  const actionHints = hintChips.slice(0, statusPill ? 1 : 2);
  /* ⚠ 能力标签**不在这一行**了（2026-08-26 挪进了输入框，见下面的
     sliderule-composer-tags）。所以这里不能再拿 picked 当显示条件——
     那会在没有附件/提示芯片时留下一条空行。 */
  const showActionRow =
    attachments.length > 0 ||
    (!hero && (actionHints.length > 0 || !!statusPill));
  const topicLabel = goal.trim() || "新话题";
  const surfaceLabel = hasApp ? "成品" : "推演";

  const refineButton = (
    <button
      type="button"
      className="hidden h-7 shrink-0 items-center gap-1 rounded-full px-1.5 text-[12px] text-[#5e5e5e] transition hover:bg-[#f4f4f5] disabled:opacity-45 sm:flex"
      title="优化提示词：把意图改写得更完整（实体/流程/角色/页面/AI）"
      data-testid="sliderule-prompt-refine"
      onClick={refinePrompt}
      disabled={isRunning || isRefining || isJudging || !input.trim()}
    >
      {isRefining ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      <span>优化</span>
    </button>
  );

  const stopButton = isRunning ? (
    <button
      type="button"
      onClick={() => stop?.()}
      data-testid="sliderule-composer-stop"
      aria-label="停止"
      title="停止"
      className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#e5e7eb] bg-white text-[#171717] transition hover:bg-[#f4f4f5]"
    >
      <Square className="h-3.5 w-3.5 fill-current" />
    </button>
  ) : null;

  const sendButton = (
    <button
      type="button"
      onClick={doSend}
      disabled={sendBlocked}
      data-testid="sliderule-composer-send"
      aria-label={isRunning ? "排队" : "发送"}
      aria-busy={sendBusy}
      className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-[#ececef] disabled:text-[#b0b0b5]"
      title={
        isRunning
          ? "排队"
          : pendingScope
            ? "先确认范围或改范围"
            : extractPending
              ? "附件解析中，请稍候"
              : isRefining
                ? "正在优化提示词"
                : isJudging
                  ? INTAKE_JUDGING_LABEL
                  : "发送"
      }
    >
      {sendBusy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ArrowUp className="h-4 w-4" />
      )}
    </button>
  );

  return (
    <div className="pointer-events-none flex w-full flex-col items-stretch gap-1.5">
      {/*
        Cursor Composer 三行（横排，不是页面三栏）：
          1. Changes / Commit 芯片
          2. 胶囊输入 + 右侧实心圆发送
          3. branch / This PC 状态行
        Void SidebarChat 同一结构：SelectedFiles → textarea → 底栏。
        ⚠ hintChips 从 SlideRule 传来却从未渲染（2026-08-20）——顶行就是把它接上。
        不许编 git / Commit；闭环胶囊和提示词芯片都是仓里已有的。
      */}
      {showActionRow ? (
        <div
          className="pointer-events-auto flex flex-wrap items-center gap-1.5"
          data-testid="sliderule-composer-actions"
        >
          {statusPill ? (
            <span
              data-testid="sliderule-composer-status-pill"
              title={statusPill.title}
              className={`inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-[12px] ${
                statusPill.blocked
                  ? "border-[#fecaca] text-[#b91c1c]"
                  : "border-[#e5e7eb] text-[#3f3f46]"
              }`}
            >
              <span aria-hidden>{statusPill.blocked ? "✗" : "✓"}</span>
              {statusPill.label}
            </span>
          ) : null}
          {actionHints.map(text => (
            <button
              key={text}
              type="button"
              data-testid="sliderule-composer-hint-chip"
              title="填入输入框，可再编辑"
              onClick={() => {
                setInput(text);
                requestAnimationFrame(adjustTextareaHeight);
                textareaRef.current?.focus();
              }}
              className="rounded-full border border-[#e5e7eb] bg-white px-3 py-1 text-[12px] text-[#3f3f46] transition hover:bg-[#f4f4f5]"
            >
              {text}
            </button>
          ))}
          {attachments.length > 0 ? (
            <div
              className="flex flex-wrap gap-2"
              data-testid="sliderule-attachments"
            >
              {attachments.map(att => (
                <div
                  key={att.id}
                  className="group relative flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-white p-1 pr-2.5"
                  data-testid="sliderule-attachment-card"
                >
                  {att.previewUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox({ src: att.previewUrl!, name: att.name })
                      }
                      data-testid="sliderule-attachment-preview-open"
                      title="点击放大"
                      className="shrink-0 cursor-zoom-in rounded-full"
                    >
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    </button>
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9edf2] text-stone-500">
                      <FileText className="h-4 w-4" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block max-w-[160px] truncate text-[11px] font-medium text-stone-700">
                      {att.name}
                    </span>
                    <span
                      className="block text-[10px] text-stone-400"
                      title={
                        att.extractStatus === "failed"
                          ? att.extractDetail
                          : undefined
                      }
                      data-testid={`sliderule-attachment-status-${att.extractStatus ?? "none"}`}
                    >
                      {formatFileSize(att.size)}
                      {att.extractStatus === "pending" && " · 解析中…"}
                      {att.extractStatus === "ready" &&
                        ` · 已解析 ${att.extractChars ?? 0} 字`}
                      {att.extractStatus === "failed" &&
                        " · 解析失败，仅带文件名"}
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
                    className="flex h-4.5 w-4.5 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-stone-400 shadow-sm transition hover:text-stone-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* 开聊后：发送圆跟胶囊同一中线。空态：Continue InputToolbar 把发送放进卡片底栏。 */}
      <div className={hero ? "w-full" : "flex w-full items-center gap-2"}>
        {/*
          ⚠ **z-30 不能少。** 2026-08-26 用户报"选了之后框里啥也没有"，一半根因
            在这儿：`/` 面板是这一层的 absolute 子元素，而消息区那一层挂着
            `relative z-10`。z-index 只在同一个层叠上下文里比大小——面板自己写
            z-30 没用，它整条链被压在消息区下面。肉眼看得见（面板是不透明的、
            画在上面），**鼠标点不到**：elementFromPoint 在面板正中拿到的是
            sliderule-user-bubble。键盘选得中、鼠标选不中，正是这种形状。
        */}
        <div
          data-testid="sliderule-composer-shell"
          className="relative z-30 min-w-0 flex-1"
        >
          <div
            className={`pointer-events-auto relative z-20 w-full border bg-white transition-colors ${
              hero
                ? "rounded-[12px] px-3 pb-2 pt-3 shadow-[0_2px_8px_rgba(31,35,40,0.06)]"
                : "rounded-[24px] px-2 py-1.5"
            } ${
              isDragOver
                ? "border-[#1677ff] bg-[#e6f4ff]/40"
                : "border-[#e5e7eb]"
            }`}
            data-testid="sliderule-composer-dock"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragOver && (
              <div
                className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-[#e6f4ff]/60 ${hero ? "rounded-[12px]" : "rounded-[24px]"}`}
              >
                <div className="flex items-center gap-2 text-sm font-medium text-[#0958d9]">
                  <FileText className="h-4 w-4" />
                  拖拽文件到这里
                </div>
              </div>
            )}
            {/* 空态：Cursor / Continue 卡片（字在上；底栏 + / 应用Web 在左，优化贴发送左边）。
            开聊后：单行胶囊，发送在胶囊外。 */}
            <div
              className={
                hero
                  ? "grid grid-cols-[auto_auto_1fr_auto] items-center gap-x-1.5 gap-y-2"
                  : "flex items-center gap-1.5"
              }
            >
              <div
                className={`relative shrink-0 ${hero ? "col-start-1 row-start-2" : ""}`}
                ref={menuRef}
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(open => !open);
                    setMenuView("actions");
                  }}
                  disabled={isRunning}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f4f4f5] text-[#5e5e5e] transition hover:bg-[#ececef] disabled:opacity-45"
                  title="更多动作"
                  data-testid="sliderule-composer-plus"
                >
                  <Plus className="h-4 w-4" />
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
                                title={
                                  enabled ? "点击取消注入" : "点击恢复注入"
                                }
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
                                      enabled
                                        ? "text-stone-800"
                                        : "text-stone-400"
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
                        去扩展中心（安装 / 卸载技能）
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

              {hero ? (
                <div
                  role="group"
                  aria-label="目标形态"
                  data-testid="sliderule-composer-device"
                  className="col-start-2 row-start-2 flex h-7 shrink-0 items-center rounded-full bg-[#f4f4f5] p-0.5"
                >
                  {COMPOSER_DEVICE_OPTIONS.map(opt => {
                    const on = device === opt.id;
                    const Icon = opt.id === "phone" ? Smartphone : Monitor;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={on}
                        data-testid={`sliderule-composer-device-${opt.id}`}
                        disabled={isRunning}
                        title={
                          opt.id === "phone"
                            ? "按手机应用推演（竖屏、底栏）"
                            : "按网页应用推演（横屏、侧栏）"
                        }
                        onClick={() => {
                          setDevice(opt.id);
                          setPreferredDevice(opt.id);
                        }}
                        className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] transition ${
                          on
                            ? "bg-white font-medium text-[#171717] shadow-sm"
                            : "text-[#5e5e5e] hover:text-[#171717]"
                        } disabled:opacity-45`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {/* 设计系统选择器（2026-08-24 用户裁决）。
              Stitch 和 TRAE 都把它做成画布右侧的常驻面板——那是因为它们**是画布
              模式**，右侧本来就有一整条空间。我们不是：舞台右边是正在跑的应用，
              再插一条面板就得跟它抢地方。所以合并进指令框，跟「应用 / Web」并排。

              ⚠ 与设备切换不同，这个在**首页和会话内都要有**（用户两张截图都圈了）：
              首页决定新推演用哪套皮，会话内改完下一轮生效。所以不能写 hero &&。 */}
              {/*
                「/ 技能·连接器」提示钮 + 设计系统按钮同占第三格。
                ⚠ hero 是四列栅格（grid-cols-[auto_auto_1fr_auto]），两个元素
                  分到同一格会**叠在一起**，所以这里包一层 flex 再放进去。
              */}
              <div
                className={
                  hero
                    ? "col-start-3 row-start-2 flex min-w-0 items-center gap-1.5 justify-self-start"
                    : "flex min-w-0 items-center gap-1.5"
                }
              >
                <button
                  type="button"
                  data-testid="sliderule-slash-hint"
                disabled={isRunning}
                onClick={openSlashPicker}
                title="挂一个技能或连接器到这一轮（等同于在输入框里打 /）"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#f4f4f5] px-2 text-[12px] text-[#5e5e5e] transition hover:bg-[#ececef] hover:text-[#171717] disabled:opacity-45"
              >
                <span className="font-mono text-[13px] leading-none">/</span>
                技能 · 连接器
              </button>
              <div
                ref={designAnchorRef}
                className="relative shrink-0"
              >
                <button
                  type="button"
                  data-testid="sliderule-composer-design-system"
                  aria-haspopup="menu"
                  aria-expanded={!!designPanel?.menuOpen}
                  disabled={isRunning}
                  title={
                    designSystem
                      ? `设计系统：${designSystem.label} · ${designSystem.description}`
                      : `${FREE_STYLE_LABEL}：${FREE_STYLE_HINT}`
                  }
                  onClick={() => designPanel?.toggleMenu()}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#f4f4f5] px-2 text-[12px] text-[#5e5e5e] transition hover:text-[#171717] disabled:opacity-45"
                >
                  {/* ⚠ 2026-08-25 用户裁决：没选是**图标**，选了是**多色色块**。
                      单色圆点两态长得太像，分不出"我选过没有"。 */}
                  {designSystem ? (
                    <DesignSystemSwatch seed={designSystem.seed} size={14} />
                  ) : (
                    <Palette className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {/* ⚠ 自由风格（默认档）只显示图标、不带字（2026-08-25 用户裁决
                      「底部直接显示这个图标」）。挂个「设计系统」的字在那儿，会让人
                      以为已经选了某套；光一个图标才读作"还没钉死，交给 AI"。 */}
                  {hero && designSystem ? designSystem.label : null}
                  <ChevronRight
                    className={`h-3 w-3 transition ${
                      designPanel?.menuOpen ? "-rotate-90" : "rotate-90"
                    }`}
                  />
                </button>
                {/* 清单 + 色板面板锚在这颗按钮正上方（见 DesignSystemRail 头注）。
                    必须在这个 relative 容器**内部**——挂页面根的话 absolute 会
                    一路找到 body，跑去左上角。 */}
                <DesignSystemRail anchorRef={designAnchorRef} />
              </div>
              </div>

              <div
                className={`min-w-0 ${hero ? "col-span-4 row-start-1" : "flex-1"}`}
              >
                {/*
                  挂上的能力是**输入框里的前缀标签**，不是上面另起一行的芯片。
                  用户 2026-08-26 指着 TRAE 的截图说的：选完之后能力就待在
                  输入框里，"然后后面再跟提示词指令"。
                  ⚠ 标签跟正文在同一个盒子里换行（flex-wrap），所以挂三个也不会
                    把输入框挤没；标签自己 shrink-0，被挤扁的只能是正文。
                */}
                {picked.length > 0 ? (
                  <div
                    className="mb-1 flex flex-wrap items-center gap-1"
                    data-testid="sliderule-composer-tags"
                  >
                    {picked.map(item => (
                      <CapabilityChip
                        key={`${item.kind}:${item.key}`}
                        item={item}
                        onRemove={() => removeCapability(item)}
                      />
                    ))}
                  </div>
                ) : null}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={event => {
                    setInput(event.target.value);
                    requestAnimationFrame(adjustTextareaHeight);
                    requestAnimationFrame(syncSlash);
                  }}
                  onSelect={syncSlash}
                  onBlur={() => {
                    if (slashPointerRef.current) return; // 点的是面板自己
                    dismissSlash();
                  }}
                  onKeyDown={event => {
                    /* ⚠ 能力面板开着时，方向键/回车/Tab 归它，**必须在发送
                       判定之前拦**。放到后面的话 Enter 会把消息发出去，
                       而用户以为自己只是在选一个技能。 */
                    if (slash) {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        dismissSlash();
                        return;
                      }
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setSlashIndex(cur =>
                          moveHighlight(
                            slashItems.length,
                            cur,
                            event.key === "ArrowDown" ? 1 : -1
                          )
                        );
                        return;
                      }
                      if (
                        (event.key === "Enter" || event.key === "Tab") &&
                        slashItems.length > 0 &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        pickCapability(slashItems[slashIndex] ?? slashItems[0]!);
                        return;
                      }
                    }
                    /* 正文空着时按退格摘掉最后一枚标签——标签输入框的通行
                       手势（GitHub/Linear/邮件收件人框都是这样）。
                       ⚠ 必须判 selectionStart===0 且正文为空：光标在字中间时
                         退格当然是删字，抢过来会让人删不动东西。 */
                    if (
                      event.key === "Backspace" &&
                      picked.length > 0 &&
                      event.currentTarget.value === "" &&
                      (event.currentTarget.selectionStart ?? 0) === 0
                    ) {
                      event.preventDefault();
                      removeCapability(picked[picked.length - 1]!);
                      return;
                    }
                    // Enter 行为偏好（设置页可切 Enter/Ctrl+Enter 发送）
                    if (shouldSendOnKey(event)) {
                      event.preventDefault();
                      // LibreChat #2078：只禁发送键挡不住 Enter，这里同样闸住
                      if (!sendBlocked) doSend();
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder={
                    picked.length > 0 ? "输入你的任务…" : placeholderText
                  }
                  aria-label={
                    picked.length > 0 ? "输入你的任务" : placeholderText
                  }
                  rows={1}
                  disabled={Boolean(pendingScope) || Boolean(pendingAsk)}
                  className={`block max-h-40 w-full resize-none bg-transparent py-0 text-[#171717] outline-none placeholder:text-[#9aa0a6] disabled:opacity-60 ${
                    hero
                      ? "min-h-[72px] px-0.5 text-[15px] leading-6"
                      : "min-h-7 px-1 text-[14px] leading-7"
                  }`}
                  data-testid="sliderule-composer-input"
                />
              </div>

              {/* 优化贴发送左边。空态跟发送同一簇靠右；开聊后仍在字右边、发送圆左边。 */}
              {hero ? (
                <div className="col-start-4 row-start-2 flex items-center gap-1 justify-self-end">
                  {refineButton}
                  {stopButton}
                  {sendButton}
                </div>
              ) : (
                refineButton
              )}
            </div>
          </div>
          {/* ⚠ 能力面板必须画在这个 relative 容器**内部**——挂 body 的话
              absolute 会一路找到 body，跑去屏幕左上角（色板那条踩过）。 */}
          {slash ? (
            <ComposerSlashMenu
              items={slashItems}
              highlight={slashIndex}
              query={slash.query}
              note={slashNote}
              onPointerDownInside={() => {
                slashPointerRef.current = true;
                // 这一拍之后焦点已经稳定，放开守卫
                window.setTimeout(() => {
                  slashPointerRef.current = false;
                }, 0);
              }}
              onPick={pickCapability}
              onHover={setSlashIndex}
              onManage={() => {
                dismissSlash();
                navigate("/agent-loop/skills");
              }}
            />
          ) : null}
          {/* 审查卡叠在输入框上方，不进外层 flex——进流会把输入顶走。
              范围卡开着时 hint 必须让路：同一 send 禁止两张卡。 */}
          {pendingScope && onConfirmScope && onReviseScope ? (
            <ScopeCard
              key={pendingScope.userText}
              pending={pendingScope}
              onConfirm={onConfirmScope}
              onRevise={onReviseScope}
            />
          ) : pendingAsk ? (
            <div
              className="pointer-events-auto absolute bottom-full left-0 right-0 z-10 mb-2 origin-bottom sr-composer-pop rounded-[12px] border border-[#e5e7eb] bg-white px-3.5 py-3 text-[13px] leading-5 text-[#171717] shadow-[0_12px_32px_rgb(15_23_42/0.12)]"
              data-testid="sliderule-control-ask"
              role="dialog"
              aria-label="控制面提问"
            >
              <p data-testid="sliderule-control-ask-question">
                {pendingAsk.question}
              </p>
              {(pendingAsk.options || []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingAsk.options!.map(option => (
                    <button
                      key={option}
                      type="button"
                      className="rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-1.5 text-[13px] leading-5 text-[#171717] transition hover:bg-white"
                      onClick={() => onAnswerAsk?.(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
              {onDismissAsk ? (
                <button
                  type="button"
                  className="mt-2 text-[12px] leading-4 text-[#71717a]"
                  onClick={onDismissAsk}
                >
                  稍后再说
                </button>
              ) : null}
            </div>
          ) : intakeHintYieldsToScopeCard(Boolean(pendingScope)) ? (
            <IntakeHintBar
              judgement={judgement}
              isJudging={isJudging}
              scopeCardOpen={Boolean(pendingScope)}
              onRewrite={text => {
                setInput(text);
                requestAnimationFrame(adjustTextareaHeight);
                textareaRef.current?.focus();
              }}
            />
          ) : null}
        </div>
        {hero ? null : stopButton}
        {hero ? null : sendButton}
      </div>
      {!hero ? (
        <div
          className="pointer-events-auto flex w-full items-center gap-3 px-0.5 text-[11px] leading-4 text-[#71717a]"
          data-testid="sliderule-composer-context"
        >
          <span className="min-w-0 truncate" title={topicLabel}>
            {topicLabel}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <AppWindow className="h-3 w-3" />
            {surfaceLabel}
          </span>
          {attachmentHint && !isRunning && !extractPending ? (
            <span
              className="min-w-0 truncate"
              data-testid="sliderule-composer-hint"
            >
              {attachmentHint}
            </span>
          ) : null}
          {(isRunning || sendBusy) && (
            <Loader2
              className="ml-auto h-3 w-3 shrink-0 animate-spin"
              data-testid="sliderule-composer-context-spin"
            />
          )}
        </div>
      ) : null}
      {lightbox &&
        typeof document !== "undefined" &&
        createPortal(
          <AttachmentImageLightbox
            src={lightbox.src}
            name={lightbox.name}
            onClose={() => setLightbox(null)}
          />,
          document.body
        )}
    </div>
  );
}
