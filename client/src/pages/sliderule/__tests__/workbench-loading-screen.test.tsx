/**
 * E33 工作台加载幕布：可见性与文案契约（静态渲染；淡出/自毁时序走 e2e）。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkbenchLoadingScreen } from "../WorkbenchLoadingScreen";

describe("WorkbenchLoadingScreen", () => {
  it("visible=true 渲染幕布：品牌 + 三段文案 + 进度条", () => {
    const html = renderToStaticMarkup(<WorkbenchLoadingScreen visible />);
    expect(html).toContain("sliderule-loading-screen");
    expect(html).toContain("正在准备工作台");
    expect(html).toContain("加载推演引擎与最近会话");
    expect(html).toContain("请稍候，马上就好");
    expect(html).toContain("最近会话");
    expect(html).toContain("sr-load-sweep"); // 不确定进度动画（不假装百分比）
  });

  it("visible=false 初始即不渲染任何 DOM", () => {
    const html = renderToStaticMarkup(
      <WorkbenchLoadingScreen visible={false} />
    );
    expect(html).toBe("");
  });
});
