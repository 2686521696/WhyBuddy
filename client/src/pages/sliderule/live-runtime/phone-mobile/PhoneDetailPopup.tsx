/**
 * PhoneDetailPopup — 手机档行详情（antd-mobile Popup，④）。
 *
 * 替掉桌面档 antd Drawer 的 placement="bottom" 变通写法。Drawer 本身是
 * 桌面组件，"从底部滑出"只是把它掰弯用；Popup 才是移动端的原生形态，
 * 圆角、拖拽条、遮罩点击关闭这些都是默认行为，不用自己拼。
 *
 * 详情正文（detailBody）仍由父层渲染并原样塞进来——那部分内容跨设备共用，
 * 这里只负责换掉「容器」。
 */

import React from "react";
import { Popup } from "antd-mobile";

export interface PhoneDetailPopupProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  getContainer?: () => HTMLElement;
}

export default function PhoneDetailPopup({
  open,
  title,
  onClose,
  children,
  getContainer,
}: PhoneDetailPopupProps) {
  return (
    <Popup
      visible={open}
      onMaskClick={onClose}
      onClose={onClose}
      position="bottom"
      destroyOnClose
      getContainer={getContainer}
      bodyStyle={{
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        height: "72%",
        display: "flex",
        flexDirection: "column",
      }}
      data-testid="phone-detail-popup"
    >
      {/* 拖拽条：移动端「这层能往下拖掉」的通用暗示 */}
      <div style={{ padding: "8px 0 4px", textAlign: "center", flexShrink: 0 }}>
        <span
          style={{
            display: "inline-block",
            width: 36,
            height: 4,
            borderRadius: 2,
            background: "#e5e5e5",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 16px 12px",
          borderBottom: "1px solid #eee",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            flex: 1,
            fontWeight: 600,
            fontSize: 16,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <a onClick={onClose} style={{ color: "#999", fontSize: 14 }} data-testid="phone-detail-close">
          关闭
        </a>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px 20px" }}>
        {children}
      </div>
    </Popup>
  );
}
