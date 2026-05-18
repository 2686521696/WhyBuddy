/**
 * `autopilot-spec-document-export` Task 1.1：文件名片段清洗。
 *
 * 把任意 raw 字符串转成可放进 OS 文件名 / zip entry 的安全片段。
 * 与 design.md `## 组件与接口 > 3. sanitizeFilenameSegment`
 * 一致；规则源自 Req 4.1。
 *
 * 规则：
 * - 替换 Windows / POSIX 文件系统保留字符 `< > : " / \ | ? *` 为 `-`
 * - 把连续空白字符（`\s+`）合并为单个 `_`
 * - 去首尾空白
 * - 截断到 80 字符
 * - 空结果或全空白结果回退为 `"untitled"`
 *
 * 函数纯无副作用；不依赖 `process.env`、不引入 runtime 依赖。
 */
const RESERVED_CHARS_PATTERN = /[<>:"/\\|?*]/g;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const MAX_SEGMENT_LENGTH = 80;

export function sanitizeFilenameSegment(raw: string): string {
  if (typeof raw !== "string") {
    return "untitled";
  }

  // 1. 替换保留字符
  const replaced = raw.replace(RESERVED_CHARS_PATTERN, "-");

  // 2. 先 trim 真正的首尾空白，再合并连续空白为单个 "_"
  //    顺序很重要：若先 collapse "   " 会变成 "_"，再 trim 不会去掉它。
  const trimmed = replaced.trim();
  const collapsedWhitespace = trimmed.replace(WHITESPACE_RUN_PATTERN, "_");

  // 3. 截断到 80 字符
  const truncated =
    collapsedWhitespace.length > MAX_SEGMENT_LENGTH
      ? collapsedWhitespace.slice(0, MAX_SEGMENT_LENGTH)
      : collapsedWhitespace;

  // 4. 空 / 全空白回退
  if (truncated.length === 0) {
    return "untitled";
  }

  return truncated;
}
