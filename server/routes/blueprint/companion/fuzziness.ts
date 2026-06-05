/**
 * `blueprint-v4-full-alignment` Module A — 模糊度评分器（纯函数，规则引擎）。
 *
 * 计算 artifact 文本的模糊度评分（0-1）。Critic 触发依据（R2.1）。
 * 不依赖 LLM —— 无 LLM 时仍可工作（设计 A-D2）。
 *
 * 评分维度：
 * - 模糊修饰词密度（maybe/possibly/somehow/etc.）
 * - 占位符 / TODO / TBD 出现
 * - 过度自信副词（definitely/obviously/clearly 无证据）
 * - 文本过短（信息不足）
 */

const AMBIGUOUS_TERMS = [
  "maybe", "possibly", "perhaps", "somehow", "probably", "might",
  "could be", "not sure", "unclear", "tbd", "to be determined",
  "todo", "fixme", "等等", "可能", "也许", "大概", "待定", "暂定",
];

const OVERCONFIDENT_TERMS = [
  "definitely", "obviously", "clearly", "undoubtedly", "certainly",
  "of course", "always", "never", "guaranteed", "肯定", "必然", "绝对",
];

function extractText(artifact: unknown): string {
  if (typeof artifact === "string") return artifact;
  try {
    return JSON.stringify(artifact);
  } catch {
    return String(artifact);
  }
}

/**
 * 计算模糊度评分 0-1。越高越模糊。
 */
export function computeFuzzinessScore(artifact: unknown): number {
  const text = extractText(artifact).toLowerCase();
  if (text.length === 0) return 1;

  const wordCount = Math.max(1, text.split(/\s+/).length);

  let ambiguousHits = 0;
  for (const term of AMBIGUOUS_TERMS) {
    if (text.includes(term)) ambiguousHits += 1;
  }

  let overconfidentHits = 0;
  for (const term of OVERCONFIDENT_TERMS) {
    if (text.includes(term)) overconfidentHits += 1;
  }

  // 各维度归一化贡献
  const ambiguityScore = Math.min(1, ambiguousHits / 5);
  const overconfidenceScore = Math.min(1, overconfidentHits / 5);
  // 过短惩罚：少于 20 词视为信息不足
  const brevityScore = wordCount < 20 ? (20 - wordCount) / 20 : 0;

  // 加权合成（模糊词权重最高）
  const score =
    0.5 * ambiguityScore + 0.3 * overconfidenceScore + 0.2 * brevityScore;

  return Math.min(1, Math.max(0, score));
}
