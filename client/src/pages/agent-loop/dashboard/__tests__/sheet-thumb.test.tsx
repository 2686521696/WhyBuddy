/**
 * 应用中心卡片缩略图：贴参照板 vs 活渲染的取舍。
 *
 * 背景：卡片此前一律活渲染——每张挂一个真的 AppRuntimeScreen（antd 表格 +
 * echarts）。LiveAppThumb 自己的注释记着实测「生产构建下同屏 14 张卡，最长
 * 单任务 4106ms，主线程连续堵四秒」。生成应用时本来就画过一张首页参照板，
 * 现在把那张图落库当缩略图，活渲染降级成回落路径。
 *
 * 这份测试盯两件事：
 *   ① 取舍判据本身（新能力缺席时必须退回旧行为，不是退化成空白卡）；
 *   ② 有图时**活渲染不被挂载**——那正是这次改动省下来的开销，挂了就白改。
 *
 * 没有 jsdom（仓库里 React 测试统一用 renderToStaticMarkup），所以 onError
 * 触发的回落转换测不了；判据本身抽成了纯函数 shouldUseSheetThumb，转换后要
 * 渲染的东西就是 fallback 那个节点，两头都在下面覆盖到了。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import { SheetThumb, appPreviewUrl, shouldUseSheetThumb } from "../AppsWorkbench";

describe("shouldUseSheetThumb", () => {
  it("App Store 卡且后端说有图 → 贴图", () => {
    expect(shouldUseSheetThumb({ appId: "a1", summary: { has_preview: true } })).toBe(true);
  });

  it("后端说没图 → 活渲染（老记录就是这一档）", () => {
    expect(shouldUseSheetThumb({ appId: "a1", summary: { has_preview: false } })).toBe(false);
  });

  it("has_preview 字段缺席 → 活渲染，即改动前的行为", () => {
    // 老 Python 后端不返回这个字段。新能力缺席必须退回旧行为，
    // 不能退化成空白卡。
    expect(shouldUseSheetThumb({ appId: "a1", summary: {} })).toBe(false);
    expect(shouldUseSheetThumb({ appId: "a1", summary: null })).toBe(false);
    expect(shouldUseSheetThumb({ appId: "a1" })).toBe(false);
  });

  it("会话卡没有 app_id → 无图可取，活渲染", () => {
    // 还没落进 App Store 的会话卡：就算摘要里莫名带了 has_preview，
    // 也没有能取图的 id。
    expect(shouldUseSheetThumb({ appId: null, summary: { has_preview: true } })).toBe(false);
    expect(shouldUseSheetThumb({ appId: "", summary: { has_preview: true } })).toBe(false);
  });
});

describe("appPreviewUrl", () => {
  it("指向取图接口并对 id 转义", () => {
    expect(appPreviewUrl("abc123")).toBe("/api/sliderule/apps/abc123/preview");
    expect(appPreviewUrl("a/b?c")).toBe("/api/sliderule/apps/a%2Fb%3Fc/preview");
  });
});

describe("SheetThumb", () => {
  const fallback = <div data-testid="fallback-live-render">活渲染</div>;

  it("渲染指向取图接口的 img", () => {
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} />
    );
    expect(html).toContain(`src="${appPreviewUrl("app-77")}"`);
    expect(html).toContain('alt="园务通"');
  });

  it("有图时**不渲染** fallback —— 省下的就是这一处开销", () => {
    // 这条是整个改动的收益所在：活渲染那棵树一旦被挂上，主线程该堵还是堵，
    // 图贴不贴都白搭。
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} />
    );
    expect(html).not.toContain("fallback-live-render");
  });

  it("卡片点击不被图挡住（整张卡是一个可点区域）", () => {
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} />
    );
    expect(html).toContain("pointer-events-none");
  });

  it("首屏之外的图不抢带宽/解码（lazy + 低优先级）", () => {
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} />
    );
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});
