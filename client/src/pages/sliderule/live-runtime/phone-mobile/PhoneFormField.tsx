/**
 * PhoneFormField — 手机档表单的一行（antd-mobile Form.Item，④）。
 *
 * 为什么整行是一个组件：选择类字段要自己存"浮层开没开"，而 hooks 不能在
 * 父层的 fields.map() 里调。一个字段一个组件，状态就落在自己身上。
 *
 * 为什么用 Form.Item 而不是手搓 <div>标签</div>+<控件>：官方那套长相
 * （标签在左、整行、行间细分隔线、右侧 › 箭头、点整行弹选择器）全是
 * Form.Item 给的，手搓一个都拿不到——第一版就是手搓的，所以看着像"PC 表单
 * 塞进手机"。Form.Item 不传 name 时走纯布局分支（form-item.js 里
 * `if (!name && !isRenderProps && !dependencies) return renderLayout(children)`），
 * 正好配我们自管的受控值，不用把 formValues 交给 rc-field-form。
 *
 * 值的形状与桌面档一致（日期仍是 "YYYY-MM-DD" 串），上层写库逻辑不用改。
 */

import React from "react";
import { Form, Input, TextArea, Stepper, Picker, DatePicker, Rate } from "antd-mobile";
import type { AppFormFieldSchema } from "../app-runtime-schema";

export interface PhoneFormFieldProps {
  field: AppFormFieldSchema;
  value: unknown;
  /** ref 字段的候选行（id + 展示名） */
  refRows: Array<{ id: string; label: string }>;
  /** enum 字段的既有取值（来自已写入的行，去重） */
  enumOptions?: string[];
  onChange: (v: unknown) => void;
  /** Picker/DatePicker 的挂载容器：必须挂进画布，否则浮层跑到画布外面 */
  getContainer?: () => HTMLElement;
}

/** 日期串 → Date；空/非法一律 undefined（不猜今天）。 */
export function parseDate(value: unknown): Date | undefined {
  const s = String(value ?? "").trim();
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Date → 与桌面档一致的字符串形状。 */
export function formatDate(d: Date, withTime: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${day}T${p(d.getHours())}:${p(d.getMinutes())}` : day;
}

/** 选择器候选：声明取值优先，没有就用历史值兜底；都没有返回空（调用方退回自由输入）。 */
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

/** 占位文字：跟已填值区分开（灰 vs 正文色），跟官方 Form 的观感一致。 */
function Placeholder({ text }: { text: string }) {
  return <span style={{ color: "var(--adm-color-light, #cccccc)" }}>{text}</span>;
}

export default function PhoneFormField({
  field,
  value,
  refRows,
  enumOptions = [],
  onChange,
  getContainer,
}: PhoneFormFieldProps) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [dateOpen, setDateOpen] = React.useState(false);

  // ── 数值 ──────────────────────────────────────────────────────────
  if (field.type === "number") {
    if (field.format === "rating") {
      return (
        <Form.Item label={field.label}>
          <Rate allowHalf value={Number(value) || 0} onChange={v => onChange(v)} />
        </Form.Item>
      );
    }
    const bounded =
      field.format === "percent" || field.format === "progress" || field.format === "score";
    // Stepper 摆在行右侧（childElementPosition="right"）——就是官方「数量 − 0 +」那行
    return (
      <Form.Item label={field.label} childElementPosition="right">
        <Stepper
          value={(value as number) ?? undefined}
          onChange={v => onChange(v)}
          min={bounded ? 0 : undefined}
          max={bounded ? 100 : undefined}
          digits={field.format === "money" ? 2 : 0}
        />
      </Form.Item>
    );
  }

  // ── 日期 / 时间 ───────────────────────────────────────────────────
  if (field.type === "date" || field.type === "datetime") {
    const withTime = field.type === "datetime";
    const current = parseDate(value);
    return (
      <Form.Item
        label={field.label}
        arrow
        clickable
        onClick={() => setDateOpen(true)}
        data-testid={`phone-field-${field.id}`}
      >
        {current ? formatDate(current, withTime) : <Placeholder text={`请选择${field.label}`} />}
        <DatePicker
          visible={dateOpen}
          onClose={() => setDateOpen(false)}
          precision={withTime ? "minute" : "day"}
          value={current}
          getContainer={getContainer}
          onConfirm={d => onChange(formatDate(d, withTime))}
        />
      </Form.Item>
    );
  }

  // ── 枚举 / 引用 ───────────────────────────────────────────────────
  if (field.type === "enum" || field.type === "ref") {
    const opts = pickerOptions(field, refRows, enumOptions);
    // 一个候选都没有 → 老实退回自由输入，不摆一个点开是空的选择器
    if (opts.length === 0) {
      return (
        <Form.Item label={field.label}>
          <Input
            value={String(value ?? "")}
            onChange={v => onChange(v)}
            placeholder={`请输入${field.label}`}
          />
        </Form.Item>
      );
    }
    const label = opts.find(o => o.value === String(value ?? ""))?.label;
    return (
      <Form.Item
        label={field.label}
        arrow
        clickable
        onClick={() => setPickerOpen(true)}
        data-testid={`phone-field-${field.id}`}
      >
        {label ?? <Placeholder text={`请选择${field.label}`} />}
        <Picker
          columns={[opts]}
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          value={value ? [String(value)] : []}
          getContainer={getContainer}
          onConfirm={v => onChange(v[0] ?? "")}
        />
      </Form.Item>
    );
  }

  // ── 长文本 ────────────────────────────────────────────────────────
  if (field.type === "text") {
    // 长文本用竖排（标签在上），否则一行挤不下——官方「竖直布局表单」那档
    return (
      <Form.Item label={field.label} layout="vertical">
        <TextArea
          value={String(value ?? "")}
          onChange={v => onChange(v)}
          placeholder={`请输入${field.label}`}
          maxLength={500}
          showCount
          autoSize={{ minRows: 2, maxRows: 5 }}
        />
      </Form.Item>
    );
  }

  // ── 其余按字符串 ──────────────────────────────────────────────────
  return (
    <Form.Item label={field.label}>
      <Input
        value={String(value ?? "")}
        onChange={v => onChange(v)}
        placeholder={`请输入${field.label}`}
      />
    </Form.Item>
  );
}
