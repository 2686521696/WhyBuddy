/**
 * field-display — 字段语义（加厚 schema 一期）的纯函数层。
 *
 * 生成契约允许字段声明 enum options（取值 + tone 颜色语义）与 format
 * （money/percent/progress/score/rating/masked）。合法域来自单一真相源
 * @legal（slide-rule-python/services/data/five_system_legal.json，E40.1）——
 * 与门/修复器/生成契约同一本账，运行时数组直接派生，TS 联合类型与账本的
 * 一致性由 legal-domains parity 测试锁死。门禁在生成侧拦非法声明，这里对
 * "已经进来的模型"做防御性归一化：非法 tone 降级 default、类型不匹配的
 * format 丢弃（门禁负责标红，运行应用不渲染坏声明）。无 React 依赖。
 */

import legalDomains from "@legal";

export type FieldTone =
  | "success"
  | "processing"
  | "warning"
  | "danger"
  | "default";

export const FIELD_TONES: readonly FieldTone[] =
  legalDomains.fieldTones as FieldTone[];

export type FieldFormat =
  | "money"
  | "percent"
  | "progress"
  | "score"
  | "rating"
  | "masked";

const NUMBER_FORMATS: readonly FieldFormat[] =
  legalDomains.numberFormats as FieldFormat[];
const STRING_FORMATS: readonly FieldFormat[] =
  legalDomains.stringFormats as FieldFormat[];

export interface NormalizedFieldOption {
  id: string;
  label: string;
  tone: FieldTone;
}

export interface FieldOptionLike {
  id?: string;
  label?: string;
  tone?: string;
}

/**
 * enum options 归一化：只对 enum 字段生效；空 id 剔除、重复 id 保首个、
 * 非法 tone 降级 default。返回空数组 = 无可用声明（调用方回退观测值行为）。
 */
export function normalizeFieldOptions(
  fieldType: string | undefined,
  options: FieldOptionLike[] | undefined
): NormalizedFieldOption[] {
  if (
    String(fieldType || "").toLowerCase() !== "enum" ||
    !Array.isArray(options)
  )
    return [];
  const seen = new Set<string>();
  const out: NormalizedFieldOption[] = [];
  for (const raw of options) {
    const id = String(raw?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const tone = String(raw?.tone ?? "").trim() as FieldTone;
    out.push({
      id,
      label: String(raw?.label ?? "").trim() || id,
      tone: FIELD_TONES.includes(tone) ? tone : "default",
    });
  }
  return out;
}

/** format 归一化：与字段类型不匹配 / 未知的丢弃（返回 undefined）。 */
export function normalizeFieldFormat(
  fieldType: string | undefined,
  format: string | undefined
): FieldFormat | undefined {
  const fmt = String(format || "").trim() as FieldFormat;
  if (!fmt) return undefined;
  const type = String(fieldType || "string").toLowerCase();
  if (type === "number" && NUMBER_FORMATS.includes(fmt)) return fmt;
  if ((type === "string" || type === "text") && STRING_FORMATS.includes(fmt))
    return fmt;
  return undefined;
}

/** tone → antd Tag 预设色名（Tag 的 success/processing/warning/error/default）。 */
export function toneToTagColor(tone: FieldTone): string {
  return tone === "danger" ? "error" : tone;
}

/** 数值解析：空串/空白不算 0（Number("")===0 的坑），解析不出返回 null。 */
function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ¥ 千分位（最多 2 位小数）。非数值返回 null——调用方如实显示原文。 */
export function formatMoney(value: unknown): string | null {
  const n = parseNumeric(value);
  if (n === null) return null;
  return `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

/** 百分比文本（最多 1 位小数）。非数值返回 null。 */
export function formatPercent(value: unknown): string | null {
  const n = parseNumeric(value);
  if (n === null) return null;
  return `${Number(n.toFixed(1))}%`;
}

/** progress/score/rating 的数值钳制；非数值返回 null。 */
export function clampNumber(
  value: unknown,
  min: number,
  max: number
): number | null {
  const n = parseNumeric(value);
  if (n === null) return null;
  return Math.min(max, Math.max(min, n));
}

/**
 * 敏感值脱敏（masked）：≥7 位保首 3 尾 2（138****78 式）；
 * 短值保首位其余打星；空值原样返回。
 */
export function maskValue(value: unknown): string {
  const s = String(value ?? "");
  if (!s) return s;
  if (s.length >= 7) return `${s.slice(0, 3)}****${s.slice(-2)}`;
  if (s.length <= 1) return s;
  return `${s[0]}${"*".repeat(s.length - 1)}`;
}

/** score（0-100）的档位色：≥80 绿 / ≥60 金 / 其余红——通用评估分惯例。 */
export function scoreColor(score: number): string {
  if (score >= 80) return "#52c41a";
  if (score >= 60) return "#faad14";
  return "#ff4d4f";
}
