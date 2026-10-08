/**
 * 预览里应用自己抛出来的错 → 预览面板上一条提示 + 「让 Agent 修复」。
 *
 * 照 stackblitz-labs/bolt.diy（MIT）：预览报错 → ChatAlert「Preview Error」→「Ask Bolt」把报错原文发进对话
 * （"*Fix this preview error*\n```js\n…\n```"）。用户在预览里点出来的错，Agent 自己的无头浏览器未必复现得了。
 *
 * ⚠ 调用栈里的地址带着预览主机（还可能带 ?t= 之类），发给 Agent 之前只留路径——跟
 *   project_tools.model_page_path 同一条：预览主机不进对话，模型会把它当链接写给用户。
 */
import type { PreviewRuntimeError } from "./preview-selection-bridge";

/** 一次最多带几条进对话。同一页最多也就十条（桥那一侧封顶）。 */
export const PREVIEW_ERRORS_IN_PROMPT = 3;

const KIND_LABEL: Record<PreviewRuntimeError["kind"], string> = {
  uncaught_exception: "未捕获的异常",
  unhandled_rejection: "未处理的 Promise 拒绝",
};

/** 只认 URL 形状、不认具体是哪个主机：预览主机换了写法（http/https、带端口、e2b 直连）也剥得掉。 */
export function withoutPreviewHost(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s/)]+(?=\/)/g, "");
}

export function previewErrorSummary(errors: PreviewRuntimeError[]): string {
  const first = errors[0];
  if (!first) return "";
  const line = first.message.split("\n", 1)[0];
  return errors.length > 1 ? `${line}（另有 ${errors.length - 1} 条）` : line;
}

export function previewErrorPrompt(errors: PreviewRuntimeError[]): string {
  const shown = errors.slice(0, PREVIEW_ERRORS_IN_PROMPT);
  const blocks = shown.map(error => {
    // V8 的 stack 第一行就是「TypeError: 原话」，已经含了就不重复。
    const body = !error.stack
      ? error.message
      : error.stack.includes(error.message)
        ? error.stack
        : `${error.message}\n${error.stack}`;
    return `${KIND_LABEL[error.kind]}：\n\`\`\`\n${withoutPreviewHost(body)}\n\`\`\``;
  });
  const more = errors.length > shown.length ? `\n（还有 ${errors.length - shown.length} 条没列出）` : "";
  return `预览里的应用报错了，请找到原因并修复：\n\n${blocks.join("\n\n")}${more}`;
}
