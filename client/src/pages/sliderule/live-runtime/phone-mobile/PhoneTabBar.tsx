/**
 * PhoneTabBar — 手机档底部导航（antd-mobile TabBar，④）。
 * 只经 React.lazy 引入（与 PhonePageList 同一 antd-mobile chunk）。
 * 锁定页（当前角色无权限）保留可见但禁用语义：点击不切页，图标换锁。
 */

import React from "react";
import { TabBar } from "antd-mobile";
import {
  DashboardOutlined,
  TableOutlined,
  ProfileOutlined,
  FormOutlined,
  AppstoreOutlined,
  LockOutlined,
} from "@ant-design/icons";

const MENU_ICONS = [TableOutlined, ProfileOutlined, FormOutlined, AppstoreOutlined];

export interface PhoneTabItem {
  pageId: string;
  label: string;
  locked: boolean;
}

interface PhoneTabBarProps {
  items: PhoneTabItem[];
  activeId: string;
  onChange: (pageId: string) => void;
}

export default function PhoneTabBar({ items, activeId, onChange }: PhoneTabBarProps) {
  return (
    // Wrapper div carries the stable testid — antd-mobile TabBar does not forward data-testid to DOM
    <div data-testid="app-runtime-tabbar" style={{ background: "#fff" }}>
    <TabBar
      activeKey={activeId}
      onChange={(key) => {
        const item = items.find((i) => i.pageId === key);
        if (item && !item.locked) onChange(key);
      }}
      safeArea={false}
      style={{ background: "#fff", borderTop: "1px solid #f0f0f0" }}
    >
      {items.map((item, i) => {
        const Icon =
          item.pageId === "home"
            ? DashboardOutlined
            : item.locked
            ? LockOutlined
            : MENU_ICONS[(i - 1 + MENU_ICONS.length) % MENU_ICONS.length];
        return (
          <TabBar.Item
            key={item.pageId}
            icon={<Icon style={item.locked ? { color: "#bfbfbf" } : undefined} />}
            title={
              <span style={item.locked ? { color: "#bfbfbf" } : undefined} title={item.locked ? "当前角色无本页权限" : item.label}>
                {item.label}
              </span>
            }
          />
        );
      })}
    </TabBar>
    </div>
  );
}
