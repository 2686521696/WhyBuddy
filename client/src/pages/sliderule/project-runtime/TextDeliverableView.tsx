import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseCsv, type TextDeliverableKind } from "./deliverable-files";

/**
 * 文本交付物（.md / .txt / .csv）的查看器。右栏整页看、结果卡缩略图都用这一份（compact）。
 *
 * Markdown 用计划面板同一套 react-markdown + remark-gfm：默认不渲染原始 HTML，用户文件里的 <script> 只是字。
 * 样式抄 PlanApprovalPanel 的 sliderule-plan-content，右栏两处排版一致。
 */
const MARKDOWN_CLASS =
  "text-[13.5px] leading-[1.7] text-[#171717] [overflow-wrap:anywhere] [&_h1]:mb-2 [&_h1]:text-[18px] [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-[13.5px] [&_h3]:font-semibold [&_p]:mb-2.5 [&_ul]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-[#f3f4f6] [&_pre]:p-3 [&_code]:rounded [&_code]:bg-[#f3f4f6] [&_code]:px-1 [&_table]:w-full [&_td]:border [&_td]:border-[#e5e7eb] [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-[#e5e7eb] [&_th]:px-2 [&_th]:py-1.5 [&_a]:text-[#2f6bff] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#e5e7eb] [&_blockquote]:pl-3 [&_blockquote]:text-[#525252]";

/** 缩略图只取开头这么多字：卡片上看个样子，不渲染整份。 */
const COMPACT_CHARS = 1200;
const COMPACT_CSV_ROWS = 8;

export function TextDeliverableView({
  kind,
  text,
  compact = false,
}: {
  kind: TextDeliverableKind;
  text: string;
  compact?: boolean;
}) {
  const shown = compact ? text.slice(0, COMPACT_CHARS) : text;
  if (kind === "csv") {
    const { rows, truncated } = parseCsv(shown, compact ? COMPACT_CSV_ROWS : 500);
    const [head = [], ...body] = rows;
    return (
      <div
        data-testid="text-deliverable-view"
        data-text-kind="csv"
        className={compact ? "overflow-hidden p-2" : "min-h-0 flex-1 overflow-auto p-3"}
      >
        <table className="w-full border-collapse text-[12.5px] text-[#171717]">
          <thead>
            <tr>
              {head.map((cell, index) => (
                <th key={index} className="border border-[#e5e7eb] bg-[#f7f7f8] px-2 py-1 text-left font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="border border-[#e5e7eb] px-2 py-1 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {truncated && !compact ? (
          <p className="m-0 mt-2 text-xs text-[#8a8a8a]">只显示前 500 行，完整内容请下载。</p>
        ) : null}
      </div>
    );
  }
  if (kind === "markdown") {
    return (
      <div
        data-testid="text-deliverable-view"
        data-text-kind="markdown"
        className={`${compact ? "overflow-hidden p-3" : "min-h-0 flex-1 overflow-auto px-5 py-4"} ${MARKDOWN_CLASS}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{shown}</ReactMarkdown>
      </div>
    );
  }
  return (
    <pre
      data-testid="text-deliverable-view"
      data-text-kind="text"
      className={`m-0 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-[#171717] ${
        compact ? "overflow-hidden p-3" : "min-h-0 flex-1 overflow-auto px-4 py-3"
      }`}
    >
      {shown}
    </pre>
  );
}
