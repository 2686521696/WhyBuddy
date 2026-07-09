/**
 * `autopilot-spec-documents-workbench-v2` — ChapterChecklist 派生纯函数。
 *
 * 基于当前 SpecDocument 的 Markdown 二级标题（`## `）生成章节清单，
 * 不要求新建额外的章节元数据存储（R4.7）。
 *
 * 派生规则：
 * - 仅扫描 Markdown 顶层二级标题 `^## (.+)$`（R4.7）。
 * - `id` 通过 `title.trim().toLowerCase().replace(/\s+/g, "-")` 生成。
 * - `completed`：章节内是否存在非空内容（即从当前 `##` 到下一个 `##` 或文件末尾
 *   之间，至少有一行非空白文本且不是另一个标题行）。
 */

/** 章节清单项。 */
export interface ChapterChecklistItem {
  /** 章节锚点 id，由章节标题 slug 化得到。 */
  id: string;
  /** 章节标题原文。 */
  title: string;
  /** 章节是否有非空内容。 */
  completed: boolean;
}

/**
 * 从 Markdown 文本派生章节清单。
 *
 * 仅匹配顶层二级标题 `^## (.+)$`，忽略 `# / ### / ####` 等其他层级标题。
 * `id` 通过 `title.trim().toLowerCase().replace(/\s+/g, "-")` 生成，不引入新的 slug 依赖。
 * `completed` 判定为：从当前 `##` 标题行的下一行开始，到下一个 `##` 标题行（或文件末尾）之间，
 * 是否存在至少一行非空白文本。
 */
export function deriveChapterChecklist(markdown: string): ChapterChecklistItem[] {
  if (!markdown) {
    return [];
  }

  const lines = markdown.split("\n");
  const h2Regex = /^## (.+)$/;
  const items: ChapterChecklistItem[] = [];

  /** 收集所有二级标题的行索引与标题文本。 */
  const headings: Array<{ lineIndex: number; title: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = h2Regex.exec(lines[i]);
    if (match) {
      headings.push({ lineIndex: i, title: match[1] });
    }
  }

  for (let h = 0; h < headings.length; h++) {
    const { title, lineIndex } = headings[h];
    const startLine = lineIndex + 1;
    const endLine = h + 1 < headings.length ? headings[h + 1].lineIndex : lines.length;

    // 判断章节内是否存在非空内容
    let hasContent = false;
    for (let i = startLine; i < endLine; i++) {
      const line = lines[i];
      // 跳过空白行
      if (line.trim().length > 0) {
        hasContent = true;
        break;
      }
    }

    const trimmedTitle = title.trim();
    const id = trimmedTitle.toLowerCase().replace(/\s+/g, "-");

    items.push({
      id,
      title: trimmedTitle,
      completed: hasContent,
    });
  }

  return items;
}
