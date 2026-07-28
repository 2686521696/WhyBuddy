/**
 * PhoneDetailFields — 手机档行详情的字段表（antd-mobile List）。
 *
 * 替掉 antd `Descriptions`。Descriptions 是桌面组件：它按 `column` 排成
 * 表格状的标签/值网格，窄屏下长值会把标签挤到换行，读起来是散的。移动端
 * 的原生形态是 List——一行一个字段，标签在左、值在右，值过长自动往下走。
 *
 * 只换容器，不换内容：字段标签仍带 probe 探针（X 光要靠它把 DOM 节点连回
 * datamodel 字段），值仍由父层的 FieldValue 渲染。两处都是跨设备共用的东西，
 * 挪到这里会让手机档和桌面档对同一个字段给出不同的样子。
 */

import React from "react";
import { List } from "antd-mobile";

export interface PhoneDetailField {
  id: string;
  /** 字段标签，父层已裹好 probe 探针 */
  label: React.ReactNode;
  /** 字段值，父层用 FieldValue 渲染 */
  value: React.ReactNode;
}

export default function PhoneDetailFields({
  fields,
}: {
  fields: PhoneDetailField[];
}) {
  if (fields.length === 0) return null;
  return (
    <List mode="card" style={{ margin: 0 }} data-testid="phone-detail-fields">
      {fields.map(f => (
        <List.Item
          key={f.id}
          extra={
            // 值靠右、可换行。默认 extra 是单行不折的（给"›"这种短标记用的），
            // 长文本字段会被截成省略号——详情页把值截掉等于没显示。
            <span
              style={{
                display: "inline-block",
                maxWidth: 200,
                whiteSpace: "normal",
                wordBreak: "break-word",
                textAlign: "right",
                color: "#333",
              }}
            >
              {f.value}
            </span>
          }
        >
          <span style={{ color: "#666", fontSize: 13 }}>{f.label}</span>
        </List.Item>
      ))}
    </List>
  );
}
