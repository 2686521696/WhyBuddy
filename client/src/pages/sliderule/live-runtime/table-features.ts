/**
 * table-features — 表格自带能力（schema 驱动，纯函数）。
 *
 * 用户裁决：不要独立的"设计"属性面板配表格——排序/筛选/列设置
 * 本来就该是表格自带的功能。这里从五系统模型的字段类型推导 antd
 * Table 的列级能力：
 *   - 排序：number 按数值，其余按中文本地化字符串比较；
 *   - 筛选：enum 字段（或低基数真实取值 2~8 个）出筛选项——
 *     选项来自已写入的运行时行数据，不造假枚举。
 * 列显隐（列设置）由调用方持状态，这里只提供默认列推导。
 */

import type { RuntimeRow } from "./live-runtime";

export interface TableFieldLike {
  id: string;
  label?: string;
  type?: string;
}

export interface ColumnFeatures {
  sorter: (a: RuntimeRow, b: RuntimeRow) => number;
  filters?: Array<{ text: string; value: string }>;
  onFilter?: (value: unknown, row: RuntimeRow) => boolean;
}

/** 按字段类型 + 真实行数据推导 antd 列的 sorter/filters。 */
export function buildColumnFeatures(field: TableFieldLike, rows: RuntimeRow[]): ColumnFeatures {
  const val = (r: RuntimeRow): unknown => r.values[field.id];
  const features: ColumnFeatures = {
    sorter:
      field.type === "number"
        ? (a, b) => (Number(val(a)) || 0) - (Number(val(b)) || 0)
        : (a, b) => String(val(a) ?? "").localeCompare(String(val(b) ?? ""), "zh"),
  };

  const distinct = [
    ...new Set(
      rows
        .map(val)
        .filter((v) => v !== undefined && v !== null && v !== "")
        .map(String)
    ),
  ];
  // enum 字段永远给筛选（有值才有选项）；非 enum 低基数（2~8 个真实取值）也给
  const lowCardinality = distinct.length >= 2 && distinct.length <= 8;
  if ((field.type === "enum" && distinct.length >= 1) || lowCardinality) {
    features.filters = distinct.map((v) => ({ text: v, value: v }));
    features.onFilter = (value, row) => String(val(row) ?? "") === value;
  }
  return features;
}
