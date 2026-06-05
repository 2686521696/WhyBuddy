/**
 * `blueprint-content-quality-check` spec Task 2.1/2.2：EARS 模式匹配。
 */

/** EARS 句式关键词 */
export const EARS_KEYWORDS = [
  "when", "while", "if", "then", "the", "shall", "where",
] as const;

/**
 * 检查文本是否包含至少一个 EARS 关键词（单词边界匹配，大小写不敏感）。
 */
export function containsEarsKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return EARS_KEYWORDS.some((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    return regex.test(lower);
  });
}

/**
 * 从 Markdown 内容中提取验收标准列表。
 * 匹配 "#### Acceptance Criteria" 或 "#### 验收标准" 段落下方的编号列表。
 */
export function extractAcceptanceCriteria(content: string): string[] {
  const lines = content.split("\n");
  const criteria: string[] = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测验收标准段落开始
    if (
      /^#{1,4}\s*(acceptance\s*criteria|验收标准)/i.test(trimmed)
    ) {
      inSection = true;
      continue;
    }

    // 遇到下一个标题则退出当前段落
    if (inSection && /^#{1,4}\s/.test(trimmed) && !/acceptance\s*criteria|验收标准/i.test(trimmed)) {
      inSection = false;
      continue;
    }

    // 提取编号列表项
    if (inSection && /^\d+\.\s/.test(trimmed)) {
      criteria.push(trimmed.replace(/^\d+\.\s*/, ""));
    }
  }

  return criteria;
}
