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
  /**
   * 点了当前角色无权限的 tab。
   *
   * 原本这里是静默 no-op：图标灰掉、挂一个 title 提示。但 title 是鼠标悬停
   * 才出的东西，触屏上根本不存在——手机用户点一下，什么都不发生，也没有
   * 任何说明，只会以为应用卡了。灰掉是"看得出来不能点"，点了之后还得告诉
   * 他为什么不能点。
   */
  onLockedTap?: (item: PhoneTabItem) => void;
}

export default function PhoneTabBar({
  items,
  activeId,
  onChange,
  onLockedTap,
}: PhoneTabBarProps) {
  return (
    // Wrapper div carries the stable testid — antd-mobile TabBar does not forward data-testid to DOM
    <div data-testid="app-runtime-tabbar" style={{ background: "#fff" }}>
    <TabBar
      activeKey={activeId}
      onChange={(key) => {
        const item = items.find((i) => i.pageId === key);
        if (!item) return;
        if (item.locked) {
          onLockedTap?.(item);
          return;
        }
        onChange(key);
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
