/**
 * PhoneFieldInput — 手机档录入控件（antd-mobile，④）。
 *
 * 桌面档那套 antd 控件（InputNumber 带步进箭头、Select 下拉浮层、
 * <input type=date> 的浏览器原生日历）在 390 宽的画布里全是错的交互：
 * 点击目标太小、浮层比画布宽、原生日历在移动端各家浏览器长得不一样。
 * 这里按 antd-mobile 的移动端范式重做——枚举/引用走全屏 Picker，日期走
 * DatePicker 滚轮，数值走 Stepper，长文本走 TextArea。
 *
 * 与桌面 FieldInput 的契约保持一致：受控 value + onChange(v)，
 * 值的形状不变（日期仍是 "YYYY-MM-DD" 字符串），这样上层 formValues 和
 * 写库逻辑一行都不用改。
 */

import React from "react";
import {
  Input,
  TextArea,
  Stepper,
  Picker,
  DatePicker,
  Rate,
  Button,
} from "antd-mobile";
import type { AppFormFieldSchema } from "../app-runtime-schema";

export interface PhoneFieldInputProps {
  field: AppFormFieldSchema;
  value: unknown;
  /** ref 字段的候选行（id + 展示名） */
  refRows: Array<{ id: string; label: string }>;
  /** enum 字段的既有取值（来自已写入的行，去重）——无声明取值时的候选来源 */
  enumOptions?: string[];
  onChange: (v: unknown) => void;
  /** Popup/Picker 的挂载容器：必须挂进画布，否则浮层会跑到画布外面 */
  getContainer?: () => HTMLElement;
}

/** 日期串 → DatePicker 的 Date；空/非法一律给 undefined（不猜今天）。 */
function parseDate(value: unknown): Date | undefined {
  const s = String(value ?? "").trim();
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Date → 与桌面档一致的字符串形状（date=YYYY-MM-DD，datetime=本地 ISO 到分钟）。 */
export function formatDate(d: Date, withTime: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${day}T${p(d.getHours())}:${p(d.getMinutes())}` : day;
}

/** 选择器候选：声明取值优先，没有就用历史值兜底；都没有则返回空（调用方降级成自由输入）。 */
export function pickerOptions(
  field: AppFormFieldSchema,
  refRows: Array<{ id: string; label: string }>,
  enumOptions: string[]
): Array<{ value: string; label: string }> {
  if (field.type === "ref") return refRows.map(r => ({ value: r.id, label: r.label }));
  if (field.options?.length)
    return field.options.map(o => ({ value: o.id, label: o.label }));
  return enumOptions.map(o => ({ value: o, label: o }));
}

export default function PhoneFieldInput({
  field,
  value,
  refRows,
  enumOptions = [],
  onChange,
  getContainer,
}: PhoneFieldInputProps) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [dateOpen, setDateOpen] = React.useState(false);

  if (field.type === "number") {
    if (field.format === "rating") {
      return (
        <Rate allowHalf value={Number(value) || 0} onChange={v => onChange(v)} />
      );
    }
    const bounded =
      field.format === "percent" ||
      field.format === "progress" ||
      field.format === "score";
    // Stepper 在手机上是「点两下加减 / 也能直接敲」，比 InputNumber 的小箭头好按
    return (
      <Stepper
        style={{ "--input-width": "100%", width: "100%" }}
        value={(value as number) ?? undefined}
        onChange={v => onChange(v)}
        min={bounded ? 0 : undefined}
        max={bounded ? 100 : undefined}
        digits={field.format === "money" ? 2 : 0}
      />
    );
  }

  if (field.type === "date" || field.type === "datetime") {
    const withTime = field.type === "datetime";
    const current = parseDate(value);
    return (
      <>
        <Button
          block
          fill="outline"
          style={{ justifyContent: "flex-start", textAlign: "left" }}
          onClick={() => setDateOpen(true)}
        >
          {current ? formatDate(current, withTime) : `选择${field.label}`}
        </Button>
        <DatePicker
          visible={dateOpen}
          onClose={() => setDateOpen(false)}
          precision={withTime ? "minute" : "day"}
          value={current}
          getContainer={getContainer}
          onConfirm={d => onChange(formatDate(d, withTime))}
        />
      </>
    );
  }

  if (field.type === "enum" || field.type === "ref") {
    const opts = pickerOptions(field, refRows, enumOptions);
    // 一个候选都没有（既无声明取值、也无历史数据）→ 老实退回自由输入，
    // 不摆一个点开是空的 Picker 骗人。
    if (opts.length === 0) {
      return (
        <Input
          value={String(value ?? "")}
          onChange={v => onChange(v)}
          placeholder={`${field.label}（直接输入）`}
        />
      );
    }
    const label = opts.find(o => o.value === String(value ?? ""))?.label;
    return (
      <>
        <Button
          block
          fill="outline"
          style={{ justifyContent: "flex-start", textAlign: "left" }}
          onClick={() => setPickerOpen(true)}
          data-testid={`phone-picker-${field.id}`}
        >
          {label ?? `选择${field.label}`}
        </Button>
        <Picker
          columns={[opts]}
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          value={value ? [String(value)] : []}
          getContainer={getContainer}
          onConfirm={v => onChange(v[0] ?? "")}
        />
      </>
    );
  }

  if (field.type === "text") {
    return (
      <TextArea
        value={String(value ?? "")}
        onChange={v => onChange(v)}
        placeholder={field.label}
        rows={3}
        autoSize={{ minRows: 2, maxRows: 5 }}
      />
    );
  }

  return (
    <Input
      value={String(value ?? "")}
      onChange={v => onChange(v)}
      placeholder={field.label}
    />
  );
}
