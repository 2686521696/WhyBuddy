/**
 * 设置中心重构（推演通道 / 浏览器直连 / 系统设置）的结构回归。
 *
 * 约定：renderToStaticMarkup（不跑 effect，不发真实请求）。
 * 覆盖：三分类导航（系统设置排第一且为默认落点，用户裁决）、
 * 偏好/隐私说明在场、底部保存不出现在默认分类（各自即时生效）。
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDialog, SettingsPage, SystemPrefs } from "../SettingsDialog";

// SystemPrefs 的数据管理区读 localStorage — node 环境补一个最小 shim
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
} as unknown as Storage;

describe("SettingsDialog（设置中心重构）", () => {
  it("导航：系统设置（第一且默认）+ 推演通道 + 浏览器直连（常驻，自定义厂商重要）", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog open onClose={() => {}} sessionId="s1" />
    );
    expect(html).toContain('data-testid="sliderule-settings-nav-channel"');
    expect(html).toContain('data-testid="sliderule-settings-nav-system"');
    expect(html).toContain("推演通道");
    // 用户反馈：浏览器直连的自定义厂商很重要——本地也常驻可见，不再按启用状态隐藏
    expect(html).toContain('data-testid="sliderule-settings-nav-llm"');
    // 导航顺序：系统设置排第一（用户裁决：日常高频项放前面）
    expect(html.indexOf("sliderule-settings-nav-system")).toBeLessThan(
      html.indexOf("sliderule-settings-nav-channel")
    );
    // 默认分类 = 系统设置：偏好面板在场，真通道面板不渲染
    expect(html).toContain('data-testid="sliderule-settings-user-prefs"');
    expect(html).not.toContain('data-testid="llm-channel-panel"');
  });

  it("SettingsPage 整页形态：无遮罩/关闭按钮，三分类导航在场", () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    expect(html).toContain('data-testid="sliderule-settings-page"');
    expect(html).toContain('data-testid="sliderule-settings-nav-channel"');
    expect(html).toContain('data-testid="sliderule-settings-nav-llm"');
    expect(html).toContain('data-testid="sliderule-settings-nav-system"');
    // 整页无对话框化装置
    expect(html).not.toContain('data-testid="sliderule-settings-dialog"');
    expect(html).not.toContain('data-testid="sliderule-settings-close"');
  });

  it("默认分类（系统设置）不渲染底部「保存」（面板各自即时生效）", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog open onClose={() => {}} sessionId="s1" />
    );
    expect(html).not.toContain('data-testid="sliderule-settings-save"');
  });

  it("关闭态不渲染任何内容", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog open={false} onClose={() => {}} />
    );
    expect(html).toBe("");
  });

  it("系统设置：「偏好」三控件（减少动效/完成通知/Enter 行为）+ 隐私事实说明在场", () => {
    const html = renderToStaticMarkup(<SystemPrefs sessionId="s1" />);
    expect(html).toContain('data-testid="sliderule-settings-user-prefs"');
    expect(html).toContain("减少动态效果");
    expect(html).toContain("推演完成通知");
    expect(html).toContain("Enter 键行为");
    expect(html).toContain("Enter 发送");
    expect(html).toContain("Ctrl+Enter 发送");
    // 隐私事实（人话版）：只陈述已成立的事实
    expect(html).toContain('data-testid="sliderule-settings-privacy-facts"');
    expect(html).toContain("你的数据存在哪里");
    expect(html).toContain("本地存储");
    expect(html).toContain("服务器环境变量");
  });
});
