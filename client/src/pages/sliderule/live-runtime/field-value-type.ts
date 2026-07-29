/**
 * field-value-type — 字段声明 → 控件档位（valueType）的**单一判定表**。
 *
 * 对标 ant-design/pro-components 的 `valueType` 机制（`src/field/
 * ValueTypeToComponent.tsx`）：那边一个 valueType 对应一个组件，组件内部按
 * `mode` 分 read / edit 两个分支（见 `components/Percent/index.tsx`），于是
 * 表格单元格、详情行、表单输入天然由同一个声明驱动，不可能各写各的。
 *
 * 本仓库此前是分裂的：读侧在 FieldValue.tsx 按 format switch，写侧在
 * AppRuntimeScreen 的 FieldInput 里另写一套 if/else，表格列第三次判定。
 * 后果是明摆着的——日期读出来是纯文本、写进去用的是原生 `<input type="date">`
 * （连 antd 都没用上）；enum 无论 2 个取值还是 20 个取值一律 Select。
 * 这个文件把"这个字段该用哪一档"收敛成一个纯函数，两侧共读。
 *
 * 与 ProComponents 的一处**有意分歧**：那边 valueType 必须显式声明，
 * 这边没得声明——五系统模型只给 type + format + options，是 LLM 产出的
 * 业务语义，不是前端的控件选型。所以枚举按**取值个数**自动分档
 * （2-3 → Segmented，4-6 → Radio，更多 → Select）。这是产品判断：生成的
 * 应用要一眼像"设计过的"，而不是满屏一模一样的下拉框。分档阈值集中在这里，
 * 改一处全站生效。
 */

import type { AppFormFieldSchema } from "./app-runtime-schema";
import { normalizeFieldFormat } from "./field-display";

/**
 * 控件档位。命名跟 ProComponents 的 valueType 对齐（money/percent/digit/
 * dateTime/segmented/…），便于对照它的实现查具体组件用法。
 */
export type RuntimeValueType =
  | "text" // 单行文本 → Input
  | "textarea" // 长文本 → Input.TextArea
  | "password" // 脱敏 → Input.Password
  | "digit" // 裸数字 → InputNumber
  | "money" // 金额 → InputNumber（¥ 前缀 + 千分位）
  | "percent" // 百分比 → Slider + InputNumber
  | "progress" // 进度 → Slider（读侧 Progress 条）
  | "score" // 评估分 → InputNumber（读侧档位色）
  | "rate" // 星级 → Rate
  | "date" // 日期 → DatePicker
  | "dateTime" // 日期时间 → DatePicker showTime
  | "switch" // 布尔 → Switch
  | "segmented" // 少量枚举 → Segmented
  | "radio" // 中量枚举 → Radio.Group
  | "select" // 多量枚举 → Select
  | "tags" // 无声明取值的枚举 → Select mode=tags（可输入新值）
  | "ref"; // 关联记录 → Select（带搜索）

/** 枚举分档阈值。≤3 用 Segmented（一屏平铺、零点击可见全部选项）， */
export const SEGMENTED_MAX_OPTIONS = 3;
/** ≤6 用 Radio.Group（竖排也不占太多高度，仍是零点击可见）；再多才收进 Select。 */
export const RADIO_MAX_OPTIONS = 6;

type FieldLike = Pick<AppFormFieldSchema, "type" | "format" | "options">;

/**
 * 字段声明 → 控件档位。
 *
 * 判定顺序是有讲究的：**先看 options 再看 type**。模型偶尔会把带取值声明的
 * 字段写成 `type: "string"`（枚举语义、字符串类型），此时按 options 走枚举
 * 档比按 string 走裸输入框更接近它的本意；反过来 type=enum 但没有 options
 * 的，退到 tags 档（可选可输），不能给个空下拉让人没法填。
 */
export function resolveValueType(field: FieldLike): RuntimeValueType {
  const type = String(field.type ?? "string").toLowerCase();
  const format = normalizeFieldFormat(type, field.format);
  const optionCount = field.options?.length ?? 0;

  if (optionCount > 0) {
    if (optionCount <= SEGMENTED_MAX_OPTIONS) return "segmented";
    if (optionCount <= RADIO_MAX_OPTIONS) return "radio";
    return "select";
  }
  if (type === "enum") return "tags";
  if (type === "ref") return "ref";
  if (type === "boolean") return "switch";
  if (type === "date") return "date";
  if (type === "datetime") return "dateTime";
  if (type === "text") return "textarea";

  if (type === "number") {
    if (format === "money") return "money";
    if (format === "percent") return "percent";
    if (format === "progress") return "progress";
    if (format === "score") return "score";
    if (format === "rating") return "rate";
    return "digit";
  }

  if (format === "masked") return "password";
  return "text";
}

/**
 * 同一张表，但把「已经写进去的行里出现过的取值」也算成候选（2026-07-29）。
 *
 * 手机档一直有这条兜底：模型没声明 options 时，用历史值当选择器候选。不把
 * 这批值喂进判定表的话，一个实际只有两三种取值的字段会被判成 tags 档
 *（自由输入），白白丢掉选择器。
 *
 * ref **不合成**候选——它的候选是「另一张表的行」，不是枚举取值；判定表里
 * ref 本来就是独立一档，合成了会被当成枚举、走错取候选的分支。
 *
 * 放在这个文件而不是手机档那边：判定表的意义就是"只有一处"，多一个入口也
 * 得在同一个门里，否则又是两套判定各自演化（这次改的就是这个病）。
 */
export function resolveValueTypeWithObservedOptions(
  field: FieldLike,
  observed: string[]
): RuntimeValueType {
  if (String(field.type ?? "").toLowerCase() === "ref") return "ref";
  if (!field.options?.length && observed.length > 0) {
    return resolveValueType({
      ...field,
      options: observed.map(o => ({ id: o, label: o, tone: "default" as const })),
    });
  }
  return resolveValueType(field);
}

/** 这一档是不是 0-100 的有界数值（percent/progress/score 共用边界与滑杆）。 */
export function isBounded100(valueType: RuntimeValueType): boolean {
  return valueType === "percent" || valueType === "progress" || valueType === "score";
}

/** 这一档在表单里要不要占满整行（长文本/滑杆/日期都需要完整宽度）。 */
export function isBlockControl(valueType: RuntimeValueType): boolean {
  return valueType !== "rate" && valueType !== "switch";
}
