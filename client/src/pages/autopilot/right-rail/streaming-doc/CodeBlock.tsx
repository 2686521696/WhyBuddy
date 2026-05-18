/**
 * `autopilot-streaming-doc-renderer` — Wave 1 / Task 2.2
 *
 * 流式文档代码块组件。
 *
 * 在 Markdown 渲染管线中承担 ``` ``lang ``` `` 围栏代码块的展示职责：
 * - 顶部条带展示语言标签 + 复制按钮
 * - 主体逐行渲染源码并应用极简关键字高亮
 * - 流式过程中即使代码块尚未闭合也能逐行展示（不等待结束 fence）
 *
 * 设计约束：
 * - 不引入 `highlight.js` / `prism` 等重型语法高亮依赖，避免扩大 TS 基线
 *   以及 bundle 体积；使用纯正则 + 关键字白名单做最小可用着色。
 * - 右栏底色为白色，使用浅色主题（`bg-slate-100 / text-slate-800` 等），
 *   不允许出现 `bg-black/40 / text-white/80` 等深色毛玻璃语义；详见
 *   design.md 样式方案的浅色翻译。
 * - 复制按钮失败时静默忽略（旧浏览器或非安全上下文场景），不影响渲染。
 *
 * 支持的高亮语言：
 * - `typescript` / `ts`
 * - `javascript` / `js`
 * - `json`
 * - `markdown` / `md`
 * - `bash` / `sh` / `shell`
 *
 * 其他语言走 plain 文本渲染（仍保留行布局与等宽字体）。
 */

import { useCallback, useMemo, useState, type FC, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * `CodeBlock` 的对外 props。
 *
 * 与 design.md「关键接口」一节保持一致：
 * - `code`：代码块原文（不包含 ``` 围栏）。流式过程中可能尚未结束。
 * - `language`：fence 上声明的语言标识；缺省时按 `plain` 渲染。
 * - `isStreaming`：当前代码块是否还在流式追加；用于父组件决定是否在
 *   末尾展示光标，本组件主要用 `data-attr` 暴露状态供测试断言。
 */
export interface CodeBlockProps {
  code: string;
  language?: string;
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// 高亮规则
// ---------------------------------------------------------------------------

/** 受支持高亮的语言集合（design.md 需求 5.1 列出的覆盖范围）。 */
const SUPPORTED_LANGUAGES = new Set([
  "typescript",
  "ts",
  "javascript",
  "js",
  "json",
  "markdown",
  "md",
  "bash",
  "sh",
  "shell",
]);

/**
 * 将上游传入的 language 字符串规范化为内部高亮 key。
 *
 * 主要做两件事：
 * 1. 全部转小写，去除前后空白；
 * 2. 把 `ts/js/md/sh/shell` 等别名映射到主名 `typescript/javascript/markdown/bash`。
 */
function normalizeLanguage(language: string | undefined): string {
  if (!language) return "plain";
  const lower = language.trim().toLowerCase();
  if (lower.length === 0) return "plain";
  if (lower === "ts") return "typescript";
  if (lower === "js") return "javascript";
  if (lower === "md") return "markdown";
  if (lower === "sh" || lower === "shell") return "bash";
  if (!SUPPORTED_LANGUAGES.has(lower)) return "plain";
  return lower;
}

/** TS / JS 共用的关键字白名单（design.md 样式方案显式列出）。 */
const TS_JS_KEYWORDS = new Set([
  "function",
  "const",
  "let",
  "var",
  "return",
  "if",
  "else",
  "import",
  "export",
  "class",
  "interface",
  "type",
  "from",
  "async",
  "await",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "default",
  "new",
  "this",
  "true",
  "false",
  "null",
  "undefined",
]);

/**
 * 把一段文本切分成 `{ text, className }` 的连续 token 序列，便于后续
 * 直接 map 成 `<span>`。这种基于"token 序列 + 关键字白名单"的极简方案
 * 不能替代真正的语法解析，但足以在流式中给到用户即时的视觉分层。
 */
interface HighlightSegment {
  text: string;
  className?: string;
}

function pushPlain(
  segments: HighlightSegment[],
  text: string,
  className?: string
): void {
  if (text.length === 0) return;
  if (className === undefined) {
    segments.push({ text });
    return;
  }
  segments.push({ text, className });
}

/** 把单行 TS / JS 代码切成 token 序列。 */
function highlightTsJsLine(line: string): HighlightSegment[] {
  // 行首注释整行高亮（`//` 与流式中可能出现的未闭合 `/*`）。
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("/*")) {
    return [{ text: line, className: "text-slate-400" }];
  }

  const segments: HighlightSegment[] = [];
  // 按 `单词 / 字符串字面量 / 行内注释 / 其它` 顺序切分。
  // 通过命名捕获组让分支语义更直观，避免在 callback 里再做 startsWith 判断。
  const pattern =
    /(?<comment>\/\/.*$)|(?<dq>"(?:\\.|[^"\\])*")|(?<sq>'(?:\\.|[^'\\])*')|(?<bt>`(?:\\.|[^`\\])*`)|(?<word>[A-Za-z_][A-Za-z0-9_]*)|(?<num>\b\d+(?:\.\d+)?\b)|(?<other>[\s\S]?)/g;

  let lastIndex = 0;
  for (const match of line.matchAll(pattern)) {
    const groups = match.groups ?? {};
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      pushPlain(segments, line.slice(lastIndex, match.index));
    }
    if (groups.comment) {
      pushPlain(segments, groups.comment, "text-slate-400");
    } else if (groups.dq || groups.sq || groups.bt) {
      pushPlain(segments, match[0], "text-emerald-600");
    } else if (groups.word) {
      if (TS_JS_KEYWORDS.has(groups.word)) {
        pushPlain(segments, groups.word, "text-blue-600");
      } else {
        pushPlain(segments, groups.word);
      }
    } else if (groups.num) {
      pushPlain(segments, groups.num, "text-amber-600");
    } else {
      pushPlain(segments, match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    pushPlain(segments, line.slice(lastIndex));
  }
  return segments;
}

/** 把单行 JSON 代码切成 token 序列。 */
function highlightJsonLine(line: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const pattern =
    /(?<key>"(?:\\.|[^"\\])*")(?=\s*:)|(?<str>"(?:\\.|[^"\\])*")|(?<num>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<bool>\b(?:true|false|null)\b)|(?<other>[\s\S]?)/g;

  let lastIndex = 0;
  for (const match of line.matchAll(pattern)) {
    const groups = match.groups ?? {};
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      pushPlain(segments, line.slice(lastIndex, match.index));
    }
    if (groups.key) {
      pushPlain(segments, groups.key, "text-blue-600");
    } else if (groups.str) {
      pushPlain(segments, groups.str, "text-emerald-600");
    } else if (groups.num) {
      pushPlain(segments, groups.num, "text-amber-600");
    } else if (groups.bool) {
      pushPlain(segments, groups.bool, "text-amber-600");
    } else {
      pushPlain(segments, match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    pushPlain(segments, line.slice(lastIndex));
  }
  return segments;
}

/** 把单行 Bash 代码切成 token 序列。仅给行首命令上色。 */
function highlightBashLine(line: string): HighlightSegment[] {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    return [{ text: line, className: "text-slate-400" }];
  }
  const leadingMatch = line.match(/^(\s*)([^\s|;&]+)/);
  if (!leadingMatch) {
    return [{ text: line }];
  }
  const [, leading, command] = leadingMatch;
  const rest = line.slice((leading?.length ?? 0) + (command?.length ?? 0));
  const segments: HighlightSegment[] = [];
  if (leading && leading.length > 0) pushPlain(segments, leading);
  if (command) pushPlain(segments, command, "text-blue-600");
  if (rest.length > 0) pushPlain(segments, rest);
  return segments;
}

/** 把单行 Markdown 代码切成 token 序列。仅做最小化结构着色。 */
function highlightMarkdownLine(line: string): HighlightSegment[] {
  if (/^\s{0,3}#{1,6}\s/.test(line)) {
    return [{ text: line, className: "text-blue-600" }];
  }
  if (/^\s{0,3}(?:[-*+]|\d+\.)\s/.test(line)) {
    return [{ text: line, className: "text-emerald-600" }];
  }
  return [{ text: line }];
}

/** 选择对应语言的行级 tokenizer。 */
function highlightLine(language: string, line: string): HighlightSegment[] {
  switch (language) {
    case "typescript":
    case "javascript":
      return highlightTsJsLine(line);
    case "json":
      return highlightJsonLine(line);
    case "bash":
      return highlightBashLine(line);
    case "markdown":
      return highlightMarkdownLine(line);
    default:
      return [{ text: line }];
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 流式文档代码块。
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-doc-renderer/`
 * - 需求 5.1：支持 TS / JS / JSON / Markdown / Bash 高亮
 * - 需求 5.2：浅色主题代码配色（白底右栏的浅色翻译）
 * - 需求 5.3：右上角语言标签 + 复制按钮
 * - 需求 5.4：流式中逐行渲染，不等待闭合 fence
 */
export const CodeBlock: FC<CodeBlockProps> = ({
  code,
  language,
  isStreaming = false,
}) => {
  const normalized = useMemo(() => normalizeLanguage(language), [language]);
  // 行级切分。保留空行（split 会自然产生空字符串）以保证布局稳定。
  const lines = useMemo(() => code.split("\n"), [code]);

  const [copied, setCopied] = useState<boolean>(false);
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined") return;
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return;
    clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        // 复制成功后短暂展示 Copied 提示，2s 后回到默认 Copy 文案。
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // 静默忽略，避免在非安全上下文（http / iframe）抛错打断流式渲染。
      });
  }, [code]);

  const displayLanguage = normalized === "plain" ? "TEXT" : normalized;

  return (
    <div
      className="relative my-3 overflow-hidden rounded-md border border-slate-200 bg-slate-100"
      data-testid="streaming-doc-code-block"
      data-language={normalized}
      data-is-streaming={isStreaming ? "true" : "false"}
    >
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span
          className="font-mono text-[9px] uppercase text-slate-500"
          data-testid="streaming-doc-code-language"
        >
          {displayLanguage}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="cursor-pointer font-mono text-[9px] text-slate-500 transition hover:text-slate-700"
          data-testid="streaming-doc-code-copy"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[11px] leading-5 text-slate-800">
        <code>
          {lines.map((line, index) => {
            const segments = highlightLine(normalized, line);
            const isLast = index === lines.length - 1;
            const renderedSegments: ReactNode[] = segments.map(
              (segment, segmentIndex) => {
                if (segment.className === undefined) {
                  return (
                    <span key={`s-${segmentIndex}`}>{segment.text}</span>
                  );
                }
                return (
                  <span key={`s-${segmentIndex}`} className={segment.className}>
                    {segment.text}
                  </span>
                );
              }
            );
            return (
              <span key={`line-${index}`} data-testid="streaming-doc-code-line">
                {renderedSegments}
                {isLast ? null : "\n"}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
};

export default CodeBlock;
