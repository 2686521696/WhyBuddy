/**
 * PhonePageList — 手机档业务页（antd-mobile 渲染档，④）。
 *
 * 设备 → 库映射的第三档：desktop/tablet=antd，phone=antd-mobile。
 * 本组件只经 React.lazy 引入（antd-mobile 独立 chunk，不进主 bundle）。
 * 行数据 → List.Item（标题 = 首字段值，描述 = 后续 2-3 字段），
 * 新建 = antd-mobile 主按钮；空态文案与桌面档一致（诚实空态）。
 */

import React from "react";
import { List, Button as MobileButton } from "antd-mobile";
// 图标复用 @ant-design/icons（已在主包），省掉 antd-mobile-icons 依赖
import { PlusOutlined, LockOutlined } from "@ant-design/icons";

export interface PhoneListField {
  id: string;
  label: string;
}

export interface PhoneListRow {
  id: string;
  values: Record<string, unknown>;
}

interface PhonePageListProps {
  rows: PhoneListRow[];
  /** 描述区字段（通常 detailFields 第 2-4 个） */
  descFields: PhoneListField[];
  canCreate: boolean;
  createLockedHint?: string;
  /** X 光元素级埋点属性（父层 probe() 产出，spread 到新建按钮包裹层） */
  createProbeProps?: React.HTMLAttributes<HTMLElement>;
  onCreate: () => void;
  onOpenRow: (row: PhoneListRow) => void;
  /** 行尾操作区（提交审批/删除等，由父层用现有逻辑渲染） */
  renderRowActions?: (row: PhoneListRow) => React.ReactNode;
}

export default function PhonePageList({
  rows,
  descFields,
  canCreate,
  createLockedHint,
  createProbeProps,
  onCreate,
  onOpenRow,
  renderRowActions,
}: PhonePageListProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span {...createProbeProps}>
        <MobileButton
          color="primary"
          block
          disabled={!canCreate}
          onClick={onCreate}
          data-testid="app-runtime-create"
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {canCreate ? <PlusOutlined /> : <LockOutlined />}
            {canCreate ? "新建" : createLockedHint || "无新建权限"}
          </span>
        </MobileButton>
      </span>
      {rows.length === 0 ? (
        <div style={{ textAlign: "center", fontSize: 12, color: "#bfbfbf", padding: "24px 0" }}>
          暂无数据 — 点「新建」写入第一条真实数据
        </div>
      ) : (
        <List style={{ "--border-top": "none", "--border-bottom": "none", borderRadius: 8, overflow: "hidden" }}>
          {rows.map((row) => (
            <List.Item
              key={row.id}
              onClick={() => onOpenRow(row)}
              description={
                <div>
                  {descFields.map((f) => (
                    <div key={f.id} style={{ display: "flex", fontSize: 12, marginTop: 2 }}>
                      <span style={{ color: "#999", width: 84, flexShrink: 0 }}>{f.label}</span>
                      <span style={{ color: "#262626" }}>{String(row.values[f.id] ?? "—")}</span>
                    </div>
                  ))}
                  {renderRowActions && (
                    <div
                      style={{ marginTop: 6, textAlign: "right" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderRowActions(row)}
                    </div>
                  )}
                </div>
              }
            >
              <span style={{ fontWeight: 600, fontSize: 14, color: "#262626" }}>
                {String(Object.values(row.values)[0] ?? row.id)}
              </span>
            </List.Item>
          ))}
        </List>
      )}
    </div>
  );
}
