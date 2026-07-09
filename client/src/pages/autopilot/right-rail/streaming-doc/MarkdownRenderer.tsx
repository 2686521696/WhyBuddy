/**
 * `autopilot-streaming-doc-renderer` — Wave 1 / Task 2.1
 *
 * 流式文档 Markdown 渲染器。
 *
 * 该组件把 `StreamingDocRenderer` 累积出的 `rawMarkdown` 字符串解析成
 * `ReactNode[]` 并直接挂到 DOM 上。它是 Wave 0 占位 `<pre>` 的正式替身。
 *
 * 设计约束：
 * - 不引入 `react-markdown` / `marked` 等重型依赖：它们会显著扩大 TS 基线
 *   错误数（共享配置严格度高）并增加包体；这里采用纯函数 + 行级解析。
 * - 流式安全：解析过程不依赖"必须出现的闭合标记"。代码块未闭合时仍会
 *   逐行渲染，表格只在分隔行出现后才升级为 `<table>`，否则降级为段落。
 * - 浅色主题：右栏底色为白色，使用 `text-slate-* / bg-slate-50` 等浅色
 *   语义；不允许出现 `text-white/* / bg-white/5` 这类深色毛玻璃语义。
 * - 不直接渲染光标：闪烁光标由父组件 `StreamingDocRenderer` 在文档末尾
 *   单独叠加 `StreamCursor`，与本组件解耦，避免每次新 chunk 都重排末尾
 *   block。
 *
 * 支持的 Markdown 语法（参见 design.md / requirements.md 需求 2.5、6.x）：
 * - 标题：`#` `##` `###` `####`
 * - 段落：默认
 * - 列表：`- ` / `* ` / `1. `
 * - 代码块：``` ``lang ... ``` ``（委托给 `CodeBlock`）
 * - 表格：`| col | col |` + `| --- | --- |`
 * - 行内：`**bold**` / `*italic*` / `[text](url)`
 *
 * 不在本任务范围内：
 * - 嵌套列表、引用块、图片、HTML 透传等高级语法；后续若需要再扩展。
 */

import { useMemo, type FC, type ReactNode } from "react";

import type { AppLocale } from "@/lib/locale";

import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * `MarkdownRenderer` 的对外 props。
 *
 * 与 design.md「关键接口」一节保持一致：
 * - `markdown`：累积到当前渲染时刻的完整 Markdown 字符串。
 * - `isStreaming`：当前文档是否仍在流式追加；用于把"未闭合代码块"等
 *   尾部状态正确传递给子组件。
 * - `locale`：用于潜在的多语言占位（当前主要落在父组件的空态文案上，
 *   保留入参以保证后续扩展不破坏 API）。
 */
export interface MarkdownRendererProps {
  markdown: string;
  isStreaming: boolean;
  locale: AppLocale;
}

// ---------------------------------------------------------------------------
// Token 模型
// ---------------------------------------------------------------------------

/**
 * 行级 token 联合类型。每个 token 对应一段独立的 block 渲染区域。
 * 行内 inline 解析在 block 渲染时再进行，不在这里展开，避免一次性把
 * 文本结构压成大数组导致流式刷新成本过高。
 */
type MarkdownToken =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | {
      kind: "code";
      language: string | undefined;
      code: string;
      closed: boolean;
    }
  | { kind: "table"; headers: string[]; rows: string[][] };

// ---------------------------------------------------------------------------
// 行级 Tokenizer
// ---------------------------------------------------------------------------

const HEADING_PATTERN = /^(#{1,4})\s+(.+?)\s*$/;
const UL_PATTERN = /^[-*]\s+(.*)$/;
const OL_PATTERN = /^\d+\.\s+(.*)$/;
const CODE_FENCE_PATTERN = /^```\s*([A-Za-z0-9_+-]*)\s*$/;
const TABLE_DIVIDER_PATTERN = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;

/**
 * 把一段表格行（以 `|` 分隔的字符串）切分成 cell 数组。
 *
 * 规则：
 * - 去掉首尾的可选 `|`；
 * - 按 `|` 切分；
 * - 对每个 cell 做 trim，去掉视觉空白。
 */
function splitTableRow(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|")) inner = inner.slice(0, -1);
  return inner.split("|").map((cell) => cell.trim());
}

/**
 * 判断给定的两行是否可以构成一个 Markdown 表格头：
 * - 第一行至少包含一个 `|`；
 * - 第二行匹配 `| --- | --- |` 这种分隔模式。
 */
function looksLikeTableHeader(headerLine: string, dividerLine: string): boolean {
  if (!headerLine.includes("|")) return false;
  return TABLE_DIVIDER_PATTERN.test(dividerLine);
}

/**
 * 把 raw Markdown 字符串切分为 block token 序列。该函数是纯函数，便于
 * Task 7.x 编写 SSR / 增量渲染测试时直接驱动验证。
 */
export function tokenizeMarkdown(markdown: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    // 1. 代码块：``` 开始 ... ``` 结束（流式中允许未闭合）
    const fenceMatch = line.match(CODE_FENCE_PATTERN);
    if (fenceMatch) {
      const language = fenceMatch[1] && fenceMatch[1].length > 0
        ? fenceMatch[1]
        : undefined;
      const codeLines: string[] = [];
      let closed = false;
      i += 1;
      while (i < lines.length) {
        const inner = lines[i] ?? "";
        if (CODE_FENCE_PATTERN.test(inner)) {
          closed = true;
          i += 1;
          break;
        }
        codeLines.push(inner);
        i += 1;
      }
      tokens.push({
        kind: "code",
        language,
        code: codeLines.join("\n"),
        closed,
      });
      continue;
    }

    // 2. 表格：当前行有 `|` 且下一行是分隔行
    const nextLine = lines[i + 1];
    if (nextLine !== undefined && looksLikeTableHeader(line, nextLine)) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i] ?? "";
        if (rowLine.trim().length === 0 || !rowLine.includes("|")) break;
        rows.push(splitTableRow(rowLine));
        i += 1;
      }
      tokens.push({ kind: "table", headers, rows });
      continue;
    }

    // 3. 标题：# ## ### ####
    const headingMatch = line.match(HEADING_PATTERN);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? "";
      const text = headingMatch[2] ?? "";
      const level = Math.min(4, Math.max(1, hashes.length)) as 1 | 2 | 3 | 4;
      tokens.push({ kind: "heading", level, text });
      i += 1;
      continue;
    }

    // 4. 无序列表：连续的 `- ` 或 `* `
    if (UL_PATTERN.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i] ?? "";
        const m = item.match(UL_PATTERN);
        if (!m) break;
        items.push(m[1] ?? "");
        i += 1;
      }
      tokens.push({ kind: "ul", items });
      continue;
    }

    // 5. 有序列表：连续的 `1. `、`2. ` 等
    if (OL_PATTERN.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i] ?? "";
        const m = item.match(OL_PATTERN);
        if (!m) break;
        items.push(m[1] ?? "");
        i += 1;
      }
      tokens.push({ kind: "ol", items });
      continue;
    }

    // 6. 段落：把连续的非空行合并为一个段落，遇空行结束
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const paragraphLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim().length === 0) break;
      // 当下一行命中其他 block 起点时，提前终止段落。
      if (
        HEADING_PATTERN.test(next) ||
        UL_PATTERN.test(next) ||
        OL_PATTERN.test(next) ||
        CODE_FENCE_PATTERN.test(next)
      ) {
        break;
      }
      const lookahead = lines[i + 1];
      if (
        lookahead !== undefined &&
        looksLikeTableHeader(next, lookahead)
      ) {
        break;
      }
      paragraphLines.push(next);
      i += 1;
    }
    tokens.push({ kind: "paragraph", text: paragraphLines.join(" ") });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Inline 解析（bold / italic / link）
// ---------------------------------------------------------------------------

/**
 * 把一段单行文本解析为 `ReactNode[]`，识别 `**bold**`、`*italic*` 与
 * `[text](url)` 三种行内语法。
 *
 * 设计原则：
 * - 一次扫描；
 * - 优先匹配较长的标记（先 `**` 再 `*`），避免 `**foo**` 被先吃成两个
 *   斜体；
 * - 链接语法不嵌套行内格式，避免在流式中出现状态机抖动。
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let i = 0;
  let nodeKey = 0;

  const pushBuffer = () => {
    if (buffer.length === 0) return;
    nodes.push(buffer);
    buffer = "";
  };

  while (i < text.length) {
    const ch = text[i];
    // 链接：[text](url)
    if (ch === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (
        closeBracket !== -1 &&
        text[closeBracket + 1] === "("
      ) {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          pushBuffer();
          nodes.push(
            <a
              key={`${keyPrefix}-link-${nodeKey++}`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline underline-offset-2"
            >
              {linkText}
            </a>
          );
          i = closeParen + 1;
          continue;
        }
      }
    }
    // 粗体：**text**
    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        pushBuffer();
        nodes.push(
          <strong
            key={`${keyPrefix}-b-${nodeKey++}`}
            className="font-bold text-slate-900"
          >
            {text.slice(i + 2, end)}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }
    // 斜体：*text*
    if (ch === "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        pushBuffer();
        nodes.push(
          <em key={`${keyPrefix}-i-${nodeKey++}`} className="italic">
            {text.slice(i + 1, end)}
          </em>
        );
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  pushBuffer();
  return nodes;
}

// ---------------------------------------------------------------------------
// 渲染层
// ---------------------------------------------------------------------------

const HEADING_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: "text-sm font-bold text-slate-900",
  2: "text-[13px] font-semibold text-slate-800",
  3: "text-xs font-semibold text-slate-700",
  4: "text-xs font-medium text-slate-600",
};

/**
 * 生成 h1-h3 标题的稳定锚点 id。
 *
 * 使用 token 在 `tokenizeMarkdown` 输出序列中的 index 作为后缀，能保证：
 * - 同一份 Markdown 在 SSR 与 CSR 渲染出的 id 相同；
 * - 流式追加时已存在的标题 id 不会变化（旧 token 索引不变）；
 * - `extractHeadings` 与 `renderToken` 共用同一规则，避免目录与正文 id
 *   出现漂移。
 *
 * 选用 `streaming-doc-heading-` 前缀以避免与页面其它锚点冲突。
 */
function buildHeadingId(tokenIndex: number): string {
  return `streaming-doc-heading-${tokenIndex}`;
}

function normalizeFlattenedMermaidCode(input: string): string {
  let mermaidCode = input.trimStart().replace(/^mermaid[\s\b]+/i, "");
  if (!mermaidCode.includes("\n") && /-->|---|==>/.test(mermaidCode)) {
    mermaidCode = mermaidCode
      .replace(/^(graph|flowchart)\s+([A-Za-z]{2})\s+/i, "$1 $2\n  ")
      .replace(/(\])\s+([A-Z][A-Za-z0-9_]*\s+(?:-->|---|==>))/g, "$1\n  $2")
      .replace(/(\])\s+([A-Z][A-Za-z0-9_]*\[)/g, "$1\n  $2");
  }
  return mermaidCode;
}

function looksLikeFlattenedMermaidParagraph(text: string): boolean {
  const trimmed = text.trimStart();
  if (!/^mermaid[\s\b]+/i.test(trimmed)) return false;
  return /^(mermaid\s+)?(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/i.test(trimmed);
}

/**
 * 把单个 token 渲染成对应的 React 元素。抽出独立函数便于后续接入
 * Task 4.1（DocOutline）时复用 heading 信息。
 */
function renderToken(
  token: MarkdownToken,
  index: number,
  isStreaming: boolean,
  isLast: boolean
): ReactNode {
  const key = `tok-${index}`;
  switch (token.kind) {
    case "heading": {
      const cls = HEADING_CLASSES[token.level];
      const inner = renderInline(token.text, `${key}-h`);
      // h1-h3 写入稳定 id，供 DocOutline 平滑滚动定位；h4 不进入大纲，
      // 保持原状以避免无谓的 DOM 属性扩展。
      switch (token.level) {
        case 1:
          return (
            <h1 key={key} id={buildHeadingId(index)} className={cls}>
              {inner}
            </h1>
          );
        case 2:
          return (
            <h2 key={key} id={buildHeadingId(index)} className={cls}>
              {inner}
            </h2>
          );
        case 3:
          return (
            <h3 key={key} id={buildHeadingId(index)} className={cls}>
              {inner}
            </h3>
          );
        case 4:
          return (
            <h4 key={key} className={cls}>
              {inner}
            </h4>
          );
      }
      return null;
    }
    case "paragraph":
      if (looksLikeFlattenedMermaidParagraph(token.text)) {
        return (
          <MermaidBlock
            key={key}
            code={normalizeFlattenedMermaidCode(token.text)}
            isStreaming={false}
            closed={true}
          />
        );
      }
      return (
        <p
          key={key}
          className="text-xs leading-relaxed text-slate-700"
          data-testid="streaming-doc-paragraph"
        >
          {renderInline(token.text, `${key}-p`)}
        </p>
      );
    case "ul":
      return (
        <ul
          key={key}
          className="list-disc space-y-1 pl-5 text-xs text-slate-700"
          data-testid="streaming-doc-ul"
        >
          {token.items.map((item, itemIndex) => (
            <li key={`${key}-li-${itemIndex}`}>
              {renderInline(item, `${key}-li-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol
          key={key}
          className="list-decimal space-y-1 pl-5 text-xs text-slate-700"
          data-testid="streaming-doc-ol"
        >
          {token.items.map((item, itemIndex) => (
            <li key={`${key}-li-${itemIndex}`}>
              {renderInline(item, `${key}-li-${itemIndex}`)}
            </li>
          ))}
        </ol>
      );
    case "code": {
      // Mermaid detection: route mermaid-annotated code blocks to MermaidBlock.
      // Primary: language annotation is "mermaid" (case-insensitive).
      // Fallback: code content starts with "mermaid" (handles LLM-generated
      // blocks where "mermaid" is inside the fence rather than on the fence
      // line, including the case where the entire diagram is collapsed onto
      // one line: "mermaid graph TD A[...] --> B[...]").
      const langLower = token.language?.toLowerCase().trim();
      const trimmedCode = token.code.trimStart();
      const startsWithMermaidKeyword = /^mermaid[\s\b]/i.test(trimmedCode) ||
        trimmedCode.toLowerCase() === "mermaid";
      const isMermaid = langLower === "mermaid" ||
        (!langLower && startsWithMermaidKeyword);

      if (isMermaid) {
        // Strip leading "mermaid" keyword when detected via content fallback.
        // - "```\nmermaid\ngraph TD\n..." → "graph TD\n..."
        // - "```\nmermaid graph TD A --> B" → "graph TD A --> B"
        let mermaidCode = langLower === "mermaid"
          ? token.code
          : normalizeFlattenedMermaidCode(trimmedCode);

        // Heuristic: if mermaid code is collapsed onto one line (LLMs sometimes
        // emit malformed blocks like "graph TD A --> B B --> C"), insert
        // newlines before edges and node declarations to give mermaid parser
        // a fighting chance. Only apply when the entire code is one line and
        // contains mermaid edge syntax.
        if (!mermaidCode.includes("\n") && /-->|---|==>/.test(mermaidCode)) {
          // Split before edge arrows and capitalized node identifiers that
          // follow whitespace — common pattern in flattened LLM output.
          mermaidCode = mermaidCode
            .replace(/\s+(-->|---|==>)/g, "\n  $1")
            .replace(/(\])\s+([A-Z][A-Za-z0-9_]*\[)/g, "$1\n  $2");
        }

        return (
          <MermaidBlock
            key={key}
            code={mermaidCode}
            isStreaming={isStreaming && !token.closed && isLast}
            closed={token.closed}
          />
        );
      }
      // 仅在文档整体仍处于流式状态、并且该代码块尚未闭合且位于末尾时，
      // 才把 isStreaming 透传给子组件。这样可以让 CodeBlock 的 data-attr
      // 准确反映"当前正在写入"，而不是"文档随便哪里在流式"。
      return (
        <CodeBlock
          key={key}
          code={token.code}
          language={token.language}
          isStreaming={isStreaming && !token.closed && isLast}
        />
      );
    }
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table
            className="w-full border-collapse border border-slate-200 text-[10px]"
            data-testid="streaming-doc-table"
          >
            <thead>
              <tr>
                {token.headers.map((header, headerIndex) => (
                  <th
                    key={`${key}-th-${headerIndex}`}
                    className="border border-slate-200 bg-slate-50 px-2 py-1 font-bold text-slate-800"
                  >
                    {renderInline(header, `${key}-th-${headerIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {token.rows.map((row, rowIndex) => (
                <tr key={`${key}-tr-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${key}-td-${rowIndex}-${cellIndex}`}
                      className="border border-slate-200 px-2 py-1 text-slate-600"
                    >
                      {renderInline(cell, `${key}-td-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 从 Markdown 字符串提取 h1-h3 标题列表，附带稳定 id。
 *
 * 仅暴露 h1/h2/h3 三级（h4 不进入目录），id 与 `renderToken` 中的
 * `buildHeadingId(tokenIndex)` 完全一致，保证 DocOutline 点击后能在
 * 当前 DOM 中精准定位到 heading 元素。
 *
 * 该函数作为纯函数对外暴露，供 `StreamingDocRenderer` 在不再次
 * 渲染整棵树的前提下提取目录结构；与 `tokenizeMarkdown` 共享同一
 * 输入字符串时，输出顺序、id、文本三者均保持稳定。
 */
export function extractHeadings(
  markdown: string
): Array<{ id: string; text: string; level: 1 | 2 | 3 }> {
  const tokens = tokenizeMarkdown(markdown);
  const headings: Array<{ id: string; text: string; level: 1 | 2 | 3 }> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.kind !== "heading") continue;
    if (token.level === 4) continue;
    headings.push({
      id: buildHeadingId(i),
      text: token.text,
      level: token.level,
    });
  }
  return headings;
}

/**
 * 流式文档 Markdown 渲染器。
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-doc-renderer/`
 * - 需求 2.5：支持 h1-h4 / 段落 / 列表 / 代码块 / 粗体斜体 / 链接 / 表格
 * - 需求 6.1-6.4：text-xs 正文、text-sm 标题、leading-relaxed、font-sans / font-mono
 */
export const MarkdownRenderer: FC<MarkdownRendererProps> = ({
  markdown,
  isStreaming,
  locale: _locale,
}) => {
  // tokenize 是纯函数，依赖仅为 markdown 字符串；当父组件以高频追加
  // chunk 时，useMemo 可避免相同字符串重复解析。
  const tokens = useMemo(() => tokenizeMarkdown(markdown), [markdown]);

  return (
    <div
      className="space-y-2 font-sans text-xs leading-relaxed text-slate-700 break-words"
      data-testid="streaming-doc-markdown"
      data-token-count={tokens.length}
      style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
    >
      {tokens.map((token, index) =>
        renderToken(token, index, isStreaming, index === tokens.length - 1)
      )}
    </div>
  );
};

export default MarkdownRenderer;

/**
 * 仅供测试导入的内部纯函数。Task 7.x 的 SSR / 增量渲染测试需要直接驱动
 * tokenizer，这里以 `__testing__` 命名空间暴露最小集合，避免污染公共 API。
 */
export const __testing__ = {
  tokenizeMarkdown,
  renderInline,
  extractHeadings,
  buildHeadingId,
  normalizeFlattenedMermaidCode,
};
