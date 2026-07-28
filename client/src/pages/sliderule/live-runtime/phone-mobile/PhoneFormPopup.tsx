/**
 * PhoneFormPopup — 手机档「新建」表单（antd-mobile Popup，④）。
 *
 * 替掉桌面档的 antd Modal。Modal 是桌面组件：默认 520 宽、居中浮层，
 * 塞进 390 的手机画布会顶穿两边（真机量过右侧溢出 130 设计像素，
 * 「保存」整个按钮在画布外，填完了提交不了）。
 *
 * 移动端范式是底部弹起、圆角、占屏高一截、内容自己滚——就是 Popup 的
 * bodyStyle + 内部 flex 布局。头部左取消右保存，跟 iOS/Android 表单页一致。
 */

import React from "react";
import { Popup } from "antd-mobile";
import PhoneFieldInput from "./PhoneFieldInput";
import type { AppFormFieldSchema } from "../app-runtime-schema";

export interface PhoneFormPopupProps {
  open: boolean;
  title: string;
  fields: AppFormFieldSchema[];
  values: Record<string, unknown>;
  onChange: (fieldId: string, v: unknown) => void;
  onCancel: () => void;
  onSubmit: () => void;
  /** 字段的候选来源（父层按当前实体算好） */
  refRowsFor: (f: AppFormFieldSchema) => Array<{ id: string; label: string }>;
  enumOptionsFor: (f: AppFormFieldSchema) => string[];
  /** 逐字段的 X 光埋点属性（父层 probe() 产出） */
  fieldProbeProps?: (f: AppFormFieldSchema) => React.HTMLAttributes<HTMLElement>;
  /** 挂载容器：画布元素。浮层必须待在画布里，否则缩放和裁剪都对不上 */
  getContainer?: () => HTMLElement;
}

export default function PhoneFormPopup({
  open,
  title,
  fields,
  values,
  onChange,
  onCancel,
  onSubmit,
  refRowsFor,
  enumOptionsFor,
  fieldProbeProps,
  getContainer,
}: PhoneFormPopupProps) {
  return (
    <Popup
      visible={open}
      onMaskClick={onCancel}
      onClose={onCancel}
      position="bottom"
      destroyOnClose
      getContainer={getContainer}
      bodyStyle={{
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        // 高度上限而不是定高：字段少的表单不该撑出一大片空白
        maxHeight: "80%",
        display: "flex",
        flexDirection: "column",
      }}
      data-testid="phone-form-popup"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid #eee",
          flexShrink: 0,
        }}
      >
        <a
          onClick={onCancel}
          style={{ color: "#999", fontSize: 15 }}
          data-testid="phone-form-cancel"
        >
          取消
        </a>
        <span
          style={{
            flex: 1,
            textAlign: "center",
            fontWeight: 600,
            fontSize: 16,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "0 8px",
          }}
        >
          {title}
        </span>
        <a
          onClick={onSubmit}
          style={{ color: "var(--app-primary, #1677ff)", fontSize: 15, fontWeight: 600 }}
          data-testid="phone-form-submit"
        >
          保存
        </a>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "12px 16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {fields.length === 0 ? (
          <div style={{ color: "#bfbfbf", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
            本页没有可录入字段
          </div>
        ) : (
          fields.map(f => (
            <div key={f.id} {...(fieldProbeProps?.(f) ?? {})}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                {f.label}
                <span style={{ color: "#bbb", marginLeft: 6 }}>{f.type}</span>
              </div>
              <PhoneFieldInput
                field={f}
                value={values[f.id]}
                refRows={refRowsFor(f)}
                enumOptions={enumOptionsFor(f)}
                onChange={v => onChange(f.id, v)}
                getContainer={getContainer}
              />
            </div>
          ))
        )}
      </div>
    </Popup>
  );
}
