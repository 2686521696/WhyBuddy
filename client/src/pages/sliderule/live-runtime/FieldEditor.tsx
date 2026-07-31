/**
 * FieldEditor — 字段的**写侧**控件（read 侧在 FieldValue.tsx）。
 *
 * 两侧共读 field-value-type.ts 那一张档位表，这是 ant-design/pro-components
 * 的 valueType 机制的本地版：那边一个 valueType 一个组件、组件里按 mode 分
 * read/edit（`src/field/components/Percent/index.tsx` 是最短的范例）；这边
 * 拆成两个文件、共用一个判定函数，效果一样——不会出现"读的时候是进度条、
 * 写的时候是裸数字框"这种漂移。
 *
 * 一律用 antd 现成控件，不自造。此前这里有两处是自造的：
 *   - 日期用原生 `<input type="date">`：跟 antd 的表单外观、主题、
 *     禁用态、locale 全都对不上，深色档下是白底方块；
 *   - 枚举无论几个取值一律 Select：2 个取值也要点开才知道有什么。
 * 现在分别换成 DatePicker 与 Segmented/Radio.Group/Select 三档。
 *
 * 值的进出一律用**字符串/数字等原始值**，不外泄 dayjs 对象——运行时状态要
 * 能直接 JSON.stringify 进 localStorage（见 runtime-persistence.ts）。
 * DatePicker 只在组件内部把字符串包成 dayjs、把 dayjs 拆回字符串。
 */

import React from "react";
import {
  DatePicker,
  Input,
  InputNumber,
  Radio,
  Rate,
  Segmented,
  Select,
  Slider,
  Switch,
} from "antd";
import dayjs from "dayjs";
import type { AppFormFieldSchema } from "./app-runtime-schema";
import { isBounded100, resolveValueType } from "./field-value-type";

const DATE_FMT = "YYYY-MM-DD";
const DATETIME_FMT = "YYYY-MM-DD HH:mm";

/** 字符串 → dayjs（空/不合法给 null，DatePicker 收 null 显示占位）。 */
function toDayjs(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const d = dayjs(String(value));
  return d.isValid() ? d : null;
}

export interface FieldEditorProps {
  field: AppFormFieldSchema;
  value: unknown;
  /** ref 字段的候选行（id + 显示名） */
  refRows: Array<{ id: string; label: string }>;
  /** enum 无声明取值时的历史取值（来自已写入的行，去重） */
  enumOptions?: string[];
  onChange: (v: unknown) => void;
}

export function FieldEditor({
  field,
  value,
  refRows,
  enumOptions = [],
  onChange,
}: FieldEditorProps) {
  const valueType = resolveValueType(field);
  const full = { width: "100%" } as const;

  switch (valueType) {
    // ── 数值 ────────────────────────────────────────────────────────
    case "rate":
      return <Rate allowHalf value={Number(value) || 0} onChange={onChange} />;

    case "money":
      return (
        <InputNumber
          style={full}
          value={value as number | undefined}
          onChange={onChange}
          placeholder={field.label}
          prefix="¥"
          min={0}
          // 千分位：录入 1200000 时当场显示 1,200,000，跟读侧 formatMoney 对齐
          formatter={v => (v === undefined || v === null ? "" : `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ","))}
          parser={v => (v ? Number(String(v).replace(/,/g, "")) : 0) as never}
        />
      );

    case "percent":
    case "progress":
    case "score": {
      // 有界 0-100 → 滑杆 + 数字框并排：滑杆给"大概多少"的手感，
      // 数字框给精确值。此前只有一个 InputNumber，拖不了。
      const n = typeof value === "number" ? value : Number(value);
      const current = Number.isFinite(n) ? n : 0;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Slider
            style={{ flex: 1, marginInline: 4 }}
            min={0}
            max={100}
            value={current}
            onChange={onChange}
            tooltip={{ formatter: v => (valueType === "score" ? `${v} 分` : `${v}%`) }}
          />
          <InputNumber
            style={{ width: 92 }}
            min={0}
            max={100}
            value={value as number | undefined}
            onChange={onChange}
            suffix={valueType === "score" ? "分" : "%"}
          />
        </div>
      );
    }

    case "digit":
      return (
        <InputNumber
          style={full}
          value={value as number | undefined}
          onChange={onChange}
          placeholder={field.label}
        />
      );

    // ── 时间 ────────────────────────────────────────────────────────
    case "date":
      return (
        <DatePicker
          style={full}
          value={toDayjs(value)}
          onChange={d => onChange(d ? d.format(DATE_FMT) : "")}
          format={DATE_FMT}
          placeholder={`选择${field.label}`}
          allowClear
        />
      );

    case "dateTime":
      return (
        <DatePicker
          style={full}
          showTime={{ format: "HH:mm" }}
          value={toDayjs(value)}
          onChange={d => onChange(d ? d.format(DATETIME_FMT) : "")}
          format={DATETIME_FMT}
          placeholder={`选择${field.label}`}
          allowClear
        />
      );

    // ── 枚举三档（按取值个数，见 field-value-type.ts）────────────────
    case "segmented":
      return (
        <Segmented
          block
          value={(value as string) || (field.options?.[0]?.id ?? "")}
          onChange={v => onChange(String(v))}
          options={(field.options ?? []).map(o => ({ value: o.id, label: o.label }))}
        />
      );

    case "radio":
      return (
        <Radio.Group
          value={(value as string) || undefined}
          onChange={e => onChange(e.target.value)}
          options={(field.options ?? []).map(o => ({ value: o.id, label: o.label }))}
          optionType="button"
          buttonStyle="solid"
        />
      );

    case "select":
      return (
        <Select
          style={full}
          value={(value as string) || undefined}
          onChange={v => onChange(v ?? "")}
          options={(field.options ?? []).map(o => ({ value: o.id, label: o.label }))}
          placeholder={`选择${field.label}`}
          showSearch
          optionFilterProp="label"
          allowClear
        />
      );

    case "tags":
      // 无声明取值：已写入过的值当候选，仍允许输入新值（schema 没有约束，
      // 渲染层不能凭空造一个约束出来）
      return (
        <Select
          style={full}
          mode="tags"
          maxCount={1}
          value={value ? [String(value)] : []}
          onChange={v => onChange(v.at(-1) ?? "")}
          options={enumOptions.map(o => ({ value: o, label: o }))}
          placeholder={
            enumOptions.length > 0 ? `选择或输入${field.label}` : `${field.label}（输入后回车）`
          }
        />
      );

    // ── 关联 ────────────────────────────────────────────────────────
    case "ref":
      if (refRows.length === 0) {
        // 目标实体一行都没有 → 如实说明，不给个空下拉让人以为坏了
        return (
          <Input
            value={(value as string) ?? ""}
            onChange={e => onChange(e.target.value)}
            placeholder={`暂无可选的${field.label}，可先手填`}
          />
        );
      }
      return (
        <Select
          style={full}
          value={(value as string) || undefined}
          onChange={onChange}
          options={refRows.map(r => ({ value: r.id, label: r.label }))}
          placeholder={`选择${field.label}`}
          showSearch
          optionFilterProp="label"
          allowClear
        />
      );

    // ── 其余 ────────────────────────────────────────────────────────
    case "switch":
      return <Switch checked={Boolean(value)} onChange={onChange} />;

    case "textarea":
      return (
        <Input.TextArea
          value={(value as string) ?? ""}
          onChange={e => onChange(e.target.value)}
          placeholder={field.label}
          autoSize={{ minRows: 2, maxRows: 5 }}
          showCount
          maxLength={500}
        />
      );

    case "password":
      // masked 字段此前录入时是明文 Input，只有读出来才打码——录的人旁边
      // 站个人就全看见了。用 Input.Password（自带显隐切换）。
      return (
        <Input.Password
          value={(value as string) ?? ""}
          onChange={e => onChange(e.target.value)}
          placeholder={field.label}
          visibilityToggle
        />
      );

    default:
      return (
        <Input
          value={(value as string) ?? ""}
          onChange={e => onChange(e.target.value)}
          placeholder={field.label}
          allowClear
        />
      );
  }
}

export { isBounded100 };
