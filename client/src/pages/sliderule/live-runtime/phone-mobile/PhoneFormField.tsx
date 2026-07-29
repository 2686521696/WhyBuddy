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
 * 2026-07-29 **接上 field-value-type 那张判定表**。此前这里是自己一套
 * `if (type === "number") … else if (type === "date") …`，跟桌面档各判各的，
 * 桌面档为此专门建的单一真相源在手机档形同虚设。后果是实打实的：
 * - `boolean` 字段一条分支都没命中，掉到最后的字符串 Input——布尔值在手机上
 *   是个让人手打 "true" 的文本框；
 * - 2-3 个取值的枚举跟 20 个取值的枚举一样弹 Picker 浮层，明明平铺一行就能选完；
 * - percent/progress/score 用 Stepper 一下一下点，0→80 要点 80 次；
 * - `masked` 格式在桌面档是密码框，这里是明文。
 * 现在两侧共读 resolveValueType，档位判定只有一处，控件形态各按各端的库来。
 *
 * 值的形状与桌面档一致（日期仍是 "YYYY-MM-DD" 串），上层写库逻辑不用改。
 */

import React from "react";
import {
  Form,
  Input,
  TextArea,
  Stepper,
  Picker,
  DatePicker,
  Rate,
  Selector,
  Slider,
  Switch,
} from "antd-mobile";
import type { AppFormFieldSchema } from "../app-runtime-schema";
import {
  isBounded100,
  resolveValueTypeWithObservedOptions,
} from "../field-value-type";

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
  // 档位判定与桌面档同一张表（历史取值也算候选，见该函数的注释）
  const valueType = resolveValueTypeWithObservedOptions(field, enumOptions);

  // ── 布尔 → Switch ─────────────────────────────────────────────────
  // 此前掉进字符串 Input，用户得手打 "true"。childElementPosition="right"
  // 是官方那行「开关贴右边」的写法。
  if (valueType === "switch") {
    return (
      <Form.Item label={field.label} childElementPosition="right">
        <Switch
          checked={value === true || value === "true"}
          onChange={v => onChange(v)}
          data-testid={`phone-field-${field.id}`}
        />
      </Form.Item>
    );
  }

  // ── 星级 ──────────────────────────────────────────────────────────
  if (valueType === "rate") {
    return (
      <Form.Item label={field.label}>
        <Rate allowHalf value={Number(value) || 0} onChange={v => onChange(v)} />
      </Form.Item>
    );
  }

  // ── 0-100 有界数值 → Slider ───────────────────────────────────────
  // 拖一下就到位；Stepper 要点 80 次才能从 0 到 80。竖排是因为滑杆需要整行
  // 宽度，挤在标签右边只剩一小截没法拖。
  if (isBounded100(valueType)) {
    return (
      <Form.Item label={field.label} layout="vertical">
        <Slider
          min={0}
          max={100}
          step={1}
          value={Number(value) || 0}
          onChange={v => onChange(Array.isArray(v) ? v[0] : v)}
          // 拖动时冒出当前值——滑杆本身不显示数字，不给 popover 就是盲拖
          popover
          data-testid={`phone-field-${field.id}`}
        />
      </Form.Item>
    );
  }

  // ── 其余数值 → Stepper ────────────────────────────────────────────
  if (valueType === "digit" || valueType === "money") {
    return (
      <Form.Item label={field.label} childElementPosition="right">
        <Stepper
          value={(value as number) ?? undefined}
          onChange={v => onChange(v)}
          digits={valueType === "money" ? 2 : 0}
        />
      </Form.Item>
    );
  }

  // ── 日期 / 时间 ───────────────────────────────────────────────────
  if (valueType === "date" || valueType === "dateTime") {
    const withTime = valueType === "dateTime";
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

  // ── 少量枚举 → Selector（平铺，零点击可见全部）────────────────────
  //
  // 用 Selector 不用 Segmented：官方对二者的定位写得很明确——Segmented 是
  //「切换选中项时关联区域内容发生变化」（视图切换），Selector 是「提供多个
  // 选项供用户选择，一般在筛选和**表单**中使用」。这里是表单录入。
  //
  // 竖排是因为选项文字长度不定，挤在标签右边会换行错位。
  if (valueType === "segmented" || valueType === "radio") {
    const opts = pickerOptions(field, refRows, enumOptions);
    const current = String(value ?? "");
    return (
      <Form.Item label={field.label} layout="vertical">
        <Selector
          options={opts}
          // ≤3 个一行铺开；4-6 个两列，一行三个中文标签就挤了
          columns={valueType === "segmented" ? Math.max(1, opts.length) : 2}
          value={current ? [current] : []}
          onChange={v => onChange(v[0] ?? "")}
          data-testid={`phone-field-${field.id}`}
        />
      </Form.Item>
    );
  }

  // ── 多量枚举 / 引用 → Picker 浮层 ─────────────────────────────────
  if (valueType === "select" || valueType === "ref") {
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
  if (valueType === "textarea") {
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

  // ── 脱敏 → 密码框 ─────────────────────────────────────────────────
  // 桌面档这一档早就是 Input.Password 了，手机档一直是明文——同一个字段
  // 换个设备就把内容摊开给旁边的人看。
  if (valueType === "password") {
    return (
      <Form.Item label={field.label}>
        <Input
          type="password"
          value={String(value ?? "")}
          onChange={v => onChange(v)}
          placeholder={`请输入${field.label}`}
          data-testid={`phone-field-${field.id}`}
        />
      </Form.Item>
    );
  }

  // ── 其余（text / tags）按自由输入 ─────────────────────────────────
  // tags 档 = 声明成 enum 但既没有取值声明、也还没有任何历史值，此时给个
  // 空选择器等于让人填不进去，老实退回输入框。
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
