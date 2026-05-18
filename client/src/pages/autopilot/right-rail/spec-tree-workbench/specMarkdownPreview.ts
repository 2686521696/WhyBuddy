/**
 * `autopilot-llm-spec-generation` Task 12.6 (Quality Uplift Wave)：
 * 把 spec 文档的 markdown content 解析成右栏卡片可消费的轻量预览结构。
 *
 * 输入是单份文档的 markdown（来自 LLM 路径或 Quality Uplift 后的多章节
 * 模板兜底路径）；输出是首个 H2 章节标题 + 该章节下前 3 行非标题段落。
 *
 * 解析规则：
 * - H2 标题严格匹配 `^## <heading>$`，行首两个 `#` + 一个空格。
 * - 非标题段落跳过空行、跳过 `#` 开头标题；保留普通文本与列表项的前 3 行。
 * - 没有 H2：返回 `{ firstH2: undefined, paragraphLines: [] }`。
 *
 * 这是一个纯函数，不依赖 React / DOM，便于在 SSR 与单元测试中直接调用。
 */

export interface SpecMarkdownPreview {
  /** 第一个 H2 章节标题（不含 `## ` 前缀）；缺失时为 `undefined`。 */
  firstH2?: string;
  /**
   * 第一个 H2 章节下方的前 3 行非空文本（保留原始内容，未做截断）。
   * 列表项与普通段落都算在内，连续空行只保留一行间距。
   */
  paragraphLines: ReadonlyArray<string>;
}

const H2_PATTERN = /^##\s+(.+?)\s*$/;
const HEADING_PATTERN = /^#+\s+/;

/**
 * 把 markdown 文本拆为 `{ firstH2, paragraphLines }` 预览结构。
 *
 * 容错：
 * - 输入 `undefined` / 空字符串：返回空预览。
 * - 没有 H2：`firstH2` 为 `undefined`，`paragraphLines` 为空。
 */
export function buildSpecMarkdownPreview(
  markdown: string | undefined,
): SpecMarkdownPreview {
  if (!markdown || markdown.length === 0) {
    return { firstH2: undefined, paragraphLines: [] };
  }

  const lines = markdown.split(/\r?\n/);

  // 找第一个 H2 标题。
  let firstH2: string | undefined;
  let h2Index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const match = H2_PATTERN.exec(lines[i] ?? "");
    if (match) {
      firstH2 = match[1].trim();
      h2Index = i;
      break;
    }
  }

  if (h2Index < 0) {
    return { firstH2: undefined, paragraphLines: [] };
  }

  // 在 h2Index 之后收集前 3 行非空、非标题文本。
  const paragraphLines: string[] = [];
  for (
    let i = h2Index + 1;
    i < lines.length && paragraphLines.length < 3;
    i += 1
  ) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0) continue;
    if (HEADING_PATTERN.test(line)) {
      // 遇到下一个 H1/H2/H3 则停止。
      break;
    }
    paragraphLines.push(line);
  }

  return { firstH2, paragraphLines };
}
