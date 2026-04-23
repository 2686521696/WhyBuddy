import { DocumentChunker } from "../../rag/chunking/document-chunker.js";
import { SlidingWindowChunker, estimateTokenCount } from "../../rag/chunking/sliding-window-chunker.js";
import type { ChunkRecord, ChunkMetadata } from "../../../shared/rag/contracts.js";
import type {
  LongTextExtractionChunkInfo,
  LongTextExtractionFragment,
  LongTextExtractionKeyword,
  LongTextExtractionMode,
  LongTextExtractionNodeExecutionRequest,
  LongTextExtractionNodeExecutionResult,
  LongTextExtractionNodeType,
} from "../../../shared/web-aigc-long-text-extraction.js";

const DEFAULT_MAX_INPUT_CHARS = 24000;
const DEFAULT_MAX_SUMMARY_CHARS = 320;
const DEFAULT_MAX_KEYWORDS = 8;
const DEFAULT_MAX_FRAGMENTS = 3;
const DEFAULT_FRAGMENT_CHAR_LIMIT = 180;
const MIN_FRAGMENT_SCORE = 1;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "have",
  "will",
  "your",
  "about",
  "通过",
  "进行",
  "需要",
  "可以",
  "以及",
  "如果",
  "因为",
  "然后",
  "就是",
  "一个",
  "我们",
  "你们",
  "他们",
  "已经",
  "相关",
  "当前",
  "其中",
  "这些",
  "那些",
  "没有",
  "不是",
  "作为",
  "用于",
  "用于",
  "the",
  "are",
  "was",
  "were",
  "has",
  "had",
  "been",
]);

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeMode(value: unknown): LongTextExtractionMode {
  return value === "summary_first" || value === "fragments_first"
    ? value
    : "balanced";
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function createMetadata(): ChunkMetadata {
  const now = new Date().toISOString();
  return {
    ingestedAt: now,
    lastAccessedAt: now,
    contentHash: `long-text-${Date.now()}`,
  };
}

function compactWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function splitSentences(text: string): string[] {
  return compactWhitespace(text)
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function buildTitle(inputTitle: string | undefined, text: string): string | undefined {
  if (inputTitle) {
    return inputTitle;
  }

  const firstLine = compactWhitespace(text).split(/\n/)[0]?.trim();
  if (!firstLine) {
    return undefined;
  }

  return truncateText(firstLine, 36);
}

function tokenizeKeywords(text: string): string[] {
  const matches = text.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z][a-zA-Z0-9_-]{2,}/g) ?? [];
  return matches.map(token => token.toLowerCase());
}

function buildKeywords(
  text: string,
  limit: number,
): LongTextExtractionKeyword[] {
  const tokens = tokenizeKeywords(text);
  const counts = new Map<string, number>();

  for (const token of tokens) {
    if (STOP_WORDS.has(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const total = tokens.length || 1;
  return Array.from(counts.entries())
    .map(([keyword, count]) => ({
      keyword,
      count,
      score: Number((count / total).toFixed(4)),
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return right.keyword.length - left.keyword.length;
    })
    .slice(0, limit);
}

function sentenceScore(sentence: string, keywords: LongTextExtractionKeyword[]): number {
  const normalized = sentence.toLowerCase();
  const keywordScore = keywords.reduce((score, keyword) => {
    return normalized.includes(keyword.keyword)
      ? score + Math.max(keyword.count, 1)
      : score;
  }, 0);
  const punctuationBoost = /[:：；;]/.test(sentence) ? 1 : 0;
  const lengthBoost = Math.min(sentence.length / 80, 2);
  return keywordScore + punctuationBoost + lengthBoost;
}

function buildShortSummary(
  sentences: string[],
  keywords: LongTextExtractionKeyword[],
  limit: number,
): string {
  if (sentences.length === 0) {
    return "";
  }

  const selected = [...sentences]
    .map(sentence => ({
      sentence,
      score: sentenceScore(sentence, keywords),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map(item => item.sentence);

  return truncateText(selected.join(" "), limit);
}

function buildParagraphSummary(
  sentences: string[],
  keywords: LongTextExtractionKeyword[],
  limit: number,
  mode: LongTextExtractionMode,
): string {
  if (sentences.length === 0) {
    return "";
  }

  const ranked = [...sentences]
    .map((sentence, index) => ({
      sentence,
      index,
      score:
        sentenceScore(sentence, keywords) +
        (mode === "summary_first" ? 1.5 : mode === "fragments_first" ? 0.2 : 0.8),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .sort((left, right) => left.index - right.index)
    .map(item => item.sentence);

  return truncateText(ranked.join(" "), Math.max(limit, 120));
}

function findOffset(haystack: string, needle: string, fromIndex: number): number {
  const index = haystack.indexOf(needle, fromIndex);
  return index >= 0 ? index : haystack.indexOf(needle);
}

function buildFragments(input: {
  text: string;
  chunks: ChunkRecord[];
  keywords: LongTextExtractionKeyword[];
  maxFragments: number;
  fragmentCharLimit: number;
}): LongTextExtractionFragment[] {
  const fragments: LongTextExtractionFragment[] = [];
  let searchIndex = 0;

  for (const chunk of input.chunks) {
    const sentences = splitSentences(chunk.content);
    const bestSentence = [...sentences]
      .map(sentence => ({
        sentence,
        score: sentenceScore(sentence, input.keywords),
      }))
      .sort((left, right) => right.score - left.score)[0];

    if (!bestSentence || bestSentence.score < MIN_FRAGMENT_SCORE) {
      continue;
    }

    const excerpt = truncateText(bestSentence.sentence, input.fragmentCharLimit);
    const startOffset = Math.max(0, findOffset(input.text, bestSentence.sentence, searchIndex));
    const endOffset = startOffset + bestSentence.sentence.length;
    searchIndex = endOffset;

    fragments.push({
      fragmentId: `fragment-${chunk.chunkIndex + 1}`,
      chunkIndex: chunk.chunkIndex,
      title: `片段 ${chunk.chunkIndex + 1}`,
      excerpt,
      score: Number(bestSentence.score.toFixed(2)),
      startOffset,
      endOffset,
    });
  }

  return fragments
    .sort((left, right) => right.score - left.score || left.startOffset - right.startOffset)
    .slice(0, input.maxFragments);
}

function buildChunkInfos(
  chunks: ChunkRecord[],
  sourceTruncated: boolean,
): LongTextExtractionChunkInfo[] {
  return chunks.map(chunk => ({
    chunkIndex: chunk.chunkIndex,
    charCount: chunk.content.length,
    tokenEstimate: chunk.tokenCount,
    truncated: sourceTruncated && chunk.chunkIndex === chunks.length - 1,
  }));
}

function buildChunks(text: string): ChunkRecord[] {
  const metadata = createMetadata();
  const documentChunks = new DocumentChunker({
    minTokens: 24,
    maxTokens: 220,
  }).chunk(text, metadata);

  if (documentChunks.length > 1) {
    return documentChunks;
  }

  return new SlidingWindowChunker({
    windowSize: 180,
    overlap: 24,
    minTokens: 24,
    maxTokens: 220,
  }).chunk(text, metadata);
}

function buildWarnings(input: {
  originalCharCount: number;
  processedCharCount: number;
  chunkCount: number;
  fragments: LongTextExtractionFragment[];
  keywords: LongTextExtractionKeyword[];
}): string[] {
  const warnings: string[] = [];

  if (input.processedCharCount < input.originalCharCount) {
    warnings.push("输入文本过长，已按最大字符上限截断处理。");
  }
  if (input.chunkCount > 8) {
    warnings.push("文本被切分为较多片段，摘要可能更偏向高频主题。");
  }
  if (input.fragments.length === 0) {
    warnings.push("未识别出高置信度片段，建议结合原文复核。");
  }
  if (input.keywords.length === 0) {
    warnings.push("未提取到稳定关键词，可能是文本过短或噪声较多。");
  }

  return warnings;
}

export function isLongTextExtractionNodeType(
  value: unknown,
): value is LongTextExtractionNodeType {
  return value === "long_text_extraction";
}

export async function executeLongTextExtractionNode(
  request: LongTextExtractionNodeExecutionRequest,
): Promise<LongTextExtractionNodeExecutionResult> {
  if (!isLongTextExtractionNodeType(request.nodeType)) {
    throw new Error("Unsupported long_text_extraction node type.");
  }

  const input = request.input ?? {};
  const text = normalizeString(input.text);
  if (!text) {
    throw new Error("Long text extraction node input requires text.");
  }

  const mode = normalizeMode(input.mode);
  const maxInputChars = normalizeNumber(
    input.maxInputChars,
    DEFAULT_MAX_INPUT_CHARS,
    500,
    120000,
  );
  const maxSummaryChars = normalizeNumber(
    input.maxSummaryChars,
    DEFAULT_MAX_SUMMARY_CHARS,
    80,
    1200,
  );
  const maxKeywords = normalizeNumber(
    input.maxKeywords,
    DEFAULT_MAX_KEYWORDS,
    3,
    20,
  );
  const maxFragments = normalizeNumber(
    input.maxFragments,
    DEFAULT_MAX_FRAGMENTS,
    1,
    10,
  );
  const fragmentCharLimit = normalizeNumber(
    input.fragmentCharLimit,
    DEFAULT_FRAGMENT_CHAR_LIMIT,
    60,
    500,
  );

  const normalizedText = compactWhitespace(text);
  const processedText =
    normalizedText.length > maxInputChars
      ? normalizedText.slice(0, maxInputChars)
      : normalizedText;
  const truncated = processedText.length < normalizedText.length;
  const chunks = buildChunks(processedText);
  const sentences = splitSentences(processedText);
  const keywords = buildKeywords(processedText, maxKeywords);
  const shortSummary = buildShortSummary(sentences, keywords, maxSummaryChars);
  const paragraphSummary = buildParagraphSummary(
    sentences,
    keywords,
    Math.max(maxSummaryChars * 2, 180),
    mode,
  );
  const fragments = buildFragments({
    text: processedText,
    chunks,
    keywords,
    maxFragments,
    fragmentCharLimit,
  });
  const warnings = buildWarnings({
    originalCharCount: normalizedText.length,
    processedCharCount: processedText.length,
    chunkCount: chunks.length,
    fragments,
    keywords,
  });

  return {
    ok: true,
    nodeType: "long_text_extraction",
    output: {
      status: "completed",
      ...(buildTitle(normalizeString(input.title), processedText)
        ? { title: buildTitle(normalizeString(input.title), processedText) }
        : {}),
      mode,
      source: {
        originalCharCount: normalizedText.length,
        processedCharCount: processedText.length,
        chunkCount: chunks.length,
        truncated,
      },
      summary: {
        short: shortSummary,
        paragraph: paragraphSummary,
      },
      keywords,
      fragments,
      chunks: buildChunkInfos(chunks, truncated),
      structured: {
        ...(buildTitle(normalizeString(input.title), processedText)
          ? { title: buildTitle(normalizeString(input.title), processedText) }
          : {}),
        summary: paragraphSummary || shortSummary,
        keywords: keywords.map(item => item.keyword),
        fragments: fragments.map(fragment => ({
          title: fragment.title,
          excerpt: fragment.excerpt,
          score: fragment.score,
        })),
        notes: [
          `chunk_count:${chunks.length}`,
          `token_estimate:${estimateTokenCount(processedText)}`,
          ...(truncated ? ["input_truncated:true"] : []),
        ],
      },
      warnings,
      context: normalizeRecord(input.context),
    },
  };
}
