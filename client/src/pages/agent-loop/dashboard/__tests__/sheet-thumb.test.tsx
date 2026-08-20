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
import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import { DEVICE_ASPECT } from "@/lib/justified-rows";
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

  it("spec-first 有图也贴图——不再因为 iframe 截不到就永远活渲染", () => {
    // 判据本身不看 has_pages：有 appId + has_preview 就贴。media 分支必须先
    // 问 shouldUseSheetThumb，再决定要不要挂 HtmlLiveThumb（源码顺序下面钉）。
    expect(shouldUseSheetThumb({ appId: "spec-1", summary: { has_preview: true } })).toBe(true);
  });
});

describe("appPreviewUrl", () => {
  it("指向取图接口并对 id 转义", () => {
    expect(appPreviewUrl("abc123")).toBe("/api/sliderule/apps/abc123/preview");
    expect(appPreviewUrl("a/b?c")).toBe("/api/sliderule/apps/a%2Fb%3Fc/preview");
  });

  it("带上 preview_tag 当缓存版本位，并转义", () => {
    expect(appPreviewUrl("abc123", "shot.1754140000123456")).toBe(
      "/api/sliderule/apps/abc123/preview?v=shot.1754140000123456"
    );
    expect(appPreviewUrl("abc", "a b&c")).toBe("/api/sliderule/apps/abc/preview?v=a%20b%26c");
  });

  it("**图变了 URL 必须跟着变** —— 强缓存的正确性就靠这个", () => {
    // 取图响应带 immutable、max-age 一年。而同一个 app_id 的图是会变的：真截图
    // 是事后由前端采集回传的（lib/thumb-capture.ts），卡片会从参照板升级成真
    // 截图。URL 不变，浏览器就永远停在升级前那张——**这不是缓存优化问题，
    // 是用户看到的图是错的**。
    const before = appPreviewUrl("app-9", "sheet.1754140000000000");
    const after = appPreviewUrl("app-9", "shot.1754140060000000");
    expect(after).not.toBe(before);
  });

  it("没有 tag（老后端）退回不带查询串的老 URL", () => {
    // 新能力缺席时退回旧行为：强缓存照旧生效，只是拿不到升级后的新图。
    expect(appPreviewUrl("abc", undefined)).toBe("/api/sliderule/apps/abc/preview");
    expect(appPreviewUrl("abc", null)).toBe("/api/sliderule/apps/abc/preview");
    expect(appPreviewUrl("abc", "")).toBe("/api/sliderule/apps/abc/preview");
  });
});

describe("回落的活渲染必须按宽度缩放", () => {
  const src = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");

  it("卡片比例与活渲染画布同比（2026-08-03 起）", () => {
    // 这条原先断言的是**两者不相等**——08-01 卡片对齐出图、画布留在 0.462
    // 时的状态。08-03 画布也改成 9:16 之后前提反转了，断言跟着反转。
    //
    // 相等之后 contain 与 width 两种缩放算出来一样，下面那条 scaleFit 断言
    // 就不再是"修补"而是"显式声明"——它仍然必须在，理由见那一条。
    const canvas = readFileSync(
      new URL("../../../sliderule/live-runtime/AppRuntimeScreen.tsx", import.meta.url),
      "utf8"
    );
    const m = /phone:\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)/.exec(canvas);
    expect(m, "AppRuntimeScreen 的 DEVICE_SPECS.phone 没找到").toBeTruthy();
    const canvasAspect = Number(m![1]) / Number(m![2]);
    expect(canvasAspect).toBeCloseTo(DEVICE_ASPECT.phone, 4);
    expect(canvasAspect).toBeCloseTo(0.5625, 4);
  });

  it("LiveAppThumb 必须传 scaleFit=\"width\"", () => {
    // 不传吃的是默认 contain。上面那条已经证明两个比例不相等，于是 contain
    // 会在手机档卡片两侧各留一条灰边（实测宽度只铺 81.8%）。
    // "width" 模式就是为缩略图墙加的（见 AppRuntimeScreen 的 ScaleFitMode）。
    const block = src.slice(src.indexOf("function LiveAppThumb"));
    const mount = block.slice(0, block.indexOf("</React.Suspense>"));
    expect(mount).toContain("LazyAppRuntimeScreen");
    expect(mount).toMatch(/scaleFit=["{]?["']?width/);
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

  it("previewTag 透传进 img 的 src", () => {
    // 组件不解释这个值、也不关心图是哪一路的——挑图是服务端的事，这里只负责
    // 把缓存版本位原样带上。
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} previewTag="shot.17541400001" />
    );
    expect(html).toContain(`src="${appPreviewUrl("app-77", "shot.17541400001")}"`);
  });

  it("**不按来源分支** —— 真截图和参照板走同一条渲染路径", () => {
    // 两个来源画幅一致、同一个接口，前端多一个分支只会多一处要跟后端对齐的
    // 地方。除了 src 上的版本位，两者的产出应当逐字节相同。
    const asSheet = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} previewTag="sheet.1" />
    );
    const asShot = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={fallback} previewTag="shot.1" />
    );
    expect(asShot.replace("v=shot.1", "v=sheet.1")).toBe(asSheet);
  });
});

describe("spec-first 卡有图就贴图", () => {
  const stripped = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

  it("media 有图先 return SheetThumb，HtmlLiveThumb 只当没图或 img 失败的回落", () => {
    const mediaStart = stripped.indexOf("media={(() => {");
    const media = stripped.slice(mediaStart, stripped.indexOf("metrics=", mediaStart));
    expect(media).toContain("shouldUseSheetThumb");
    expect(media).toContain("HtmlLiveThumb");
    const sheetReturn = media.indexOf("if (shouldUseSheetThumb");
    const htmlReturn = media.indexOf("if (htmlLive) return htmlLive");
    expect(sheetReturn).toBeGreaterThan(-1);
    expect(htmlReturn).toBeGreaterThan(-1);
    expect(sheetReturn).toBeLessThan(htmlReturn);
    // 反面：无条件 `if (specPages) return <HtmlLiveThumb` 会让有图也挂 iframe
    expect(media).not.toMatch(/if\s*\(\s*detail\?\.specPages\s*\)\s*\{\s*return\s+</);
  });

  it("HtmlLiveThumb 没图时会采集——剥注释后必须还能看到 captureAndUpload", () => {
    const fnStart = stripped.indexOf("function HtmlLiveThumb");
    const fn = stripped.slice(fnStart, stripped.indexOf("function SpecPagesPreview"));
    expect(fn).toContain("captureAndUpload");
    expect(fn).toContain("captureFor");
  });

  it("HtmlLiveThumb 必须 cover + fillPhone，画布层必须脱离文档流", () => {
    // ⚠ 2026-08-20 真机：width 缩放把 1920×1080 缩进 9:16 卡，顶上指甲盖、
    // 下面全白；流式 1920 高还把 masonry 格子撑爆。改回 width / 拿掉
    // absolute / 不传 fillPhone，这条必红。
    const fnStart = stripped.indexOf("function HtmlLiveThumb");
    const fn = stripped.slice(fnStart, stripped.indexOf("function SpecPagesPreview"));
    expect(fn).toMatch(/useScaleToFit\([^)]*"cover"/);
    expect(fn).not.toMatch(/useScaleToFit\([^)]*"width"/);
    expect(fn).toContain("fillPhone={isPhone}");
    expect(fn).toContain('position: "absolute"');
  });
});

describe("SheetThumb 图必须铺满格子", () => {
  it("img 绝对定位 + object-cover，固有尺寸不能赢", () => {
    const html = renderToStaticMarkup(
      <SheetThumb appId="app-77" alt="园务通" fallback={<div />} />
    );
    expect(html).toMatch(/class="[^"]*absolute inset-0[^"]*object-cover/);
    expect(html).not.toMatch(/class="h-full w-full object-cover"/);
  });
});
