/**
 * 缩放画布：固定设计分辨率 + CSS transform 等比缩放，右下角一枚自述标识。
 *
 * ## 为什么单独抽一个文件（2026-08-14）
 *
 * 这套东西原本整份长在 AppRuntimeScreen 里，只有区块页用得上。spec-first
 * 那条链路的页面（SpecPageLiveStage）此前是**直接铺满容器**的：容器多宽就
 * 多宽，于是同一份 HTML 在不同宽度的窗口里是不同的版式——而它偏偏是
 * 照着固定视口画出来的（见下面 SPEC_PAGE_VIEWPORT 的注释）。
 *
 * 两处要的是同一件事，所以**抽出来共用而不是复制一份**。这份仓库在
 * 「同一个东西写两遍必然分叉」上栽过太多次（手写 uses 声明、前端手抄区域
 * 词汇、pageKinds 两处数字打架），缩放系数这种"改一处忘一处就悄悄不一致"
 * 的东西尤其不该抄。
 *
 * ⚠ 抽出来的是**机制**，不是尺寸：两条链路的设计分辨率不同，各自传各自的
 *   （见下面两个常量）。把尺寸也统一掉是另一个决定，不在这次范围内。
 */

import React from "react";

/**
 * 缩放模式（2026-07-30 补 "width"）。
 *
 *   contain — min(w/W, h/H)：保证整个应用可见，代价是宽高比不匹配时留边。
 *             应用舞台要这个：用户要看全。
 *   width   — w/W：**只按宽度算，高度由内容推导**。缩略图墙要这个。
 *
 * 为什么加这一档：作品墙那版设计里卡片大中小交错、宽高比五花八门，用 contain
 * 的结果是每张卡两侧一大片灰（实测 778×272 的卡里应用只有 484px 宽，
 * 383×130 的卡里只有 230px）。
 *
 * 做法照 WordPress Gutenberg 的 ScaledBlockPreview
 * （packages/block-editor/src/components/block-preview/auto.js）：
 *     const scale = containerWidth / viewportWidth;
 *     const aspectRatio = containerWidth / (contentHeight * scale);
 * 它也是缩放真实渲染的组件树（不是 iframe、不是截图），跟这里同一个问题。
 * 关键在**宽度定缩放、高度跟着内容走**，而不是把内容塞进一个固定尺寸的盒子
 * ——后者必然要么留边要么裁切。调用方据此把容器高度设成 designH×scale。
 */
export type ScaleFitMode = "contain" | "width";

/**
 * spec-first 那条链路的设计分辨率。
 *
 * **1920×1080 不是随手挑的圆整数**：这些页面的唯一参照渲染器
 * `experiments/visual-first/render_pages.cjs` 就是用
 * `viewport: { width: 1920, height: 1080 }` 截的图，而 V6.0 那次
 * 「有图 / 无图哪个好」的裁决，用户看的正是那批 1920 宽的截图
 * （架构图 ⚑3：判据是渲染出来用眼睛看）。
 *
 * 也就是说：**页面是照着 1920 画的，验收也是在 1920 下做的**。画布用别的
 * 宽度，等于让用户看一个从没被验收过的版式——1440 下 Tailwind 的
 * `xl:` 断点（1280）还在，但 `2xl:`（1536）整档失效，多列栅格会塌成少列。
 */
export const SPEC_PAGE_VIEWPORT = { w: 1920, h: 1080 } as const;

/**
 * 移动端竖屏的设计分辨率（2026-08-14）。
 *
 * 1080×1920 = 桌面的转置：spec-first 认出「手机/移动端/App」话题时
 * （device_policy 同一份词表），页面按移动设计系统生成（顶栏 + 底部
 * 标签栏，无侧栏），画布用这个视口。1080 宽下 Tailwind 的 lg:（1024）
 * 断点仍生效、xl:（1280）不生效——移动页的提示词本来就不该写 xl:。
 */
export const SPEC_PAGE_VIEWPORT_PHONE = { w: 1080, h: 1920 } as const;

/** 按设备取 spec 页画布视口。词表与后端 device_policy 一致（desktop/phone）。 */
export function specPageViewport(device?: string | null): { w: number; h: number } {
  return device === "phone" ? SPEC_PAGE_VIEWPORT_PHONE : SPEC_PAGE_VIEWPORT;
}

/**
 * 容器实测尺寸 → 等比缩放系数。
 *
 * ⚠ 只在 ResizeObserver 里量，不监听 window.resize：容器被侧栏折叠、抽屉
 *   推挤而变形时 window 尺寸一动不动，靠 resize 事件会漏掉一整类变化。
 */
export function useScaleToFit(
  designW: number,
  designH: number,
  mode: ScaleFitMode = "contain"
): {
  ref: React.RefObject<HTMLDivElement | null>;
  scale: number;
} {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0) return;
      if (mode === "width") {
        setScale(w / designW);
        return;
      }
      if (h > 0) setScale(Math.min(w / designW, h / designH));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designW, designH, mode]);
  return { ref, scale };
}

/**
 * 右下角那枚「1920×1080 · 52%」。
 *
 * 它是**可交互运行时**的自述——告诉你当前看到的是固定设计分辨率按容器
 * 等比缩下来的结果，而不是一张按屏幕宽度重排过的响应式页面。少了它，
 * 用户会把"字怎么这么小"当成设计问题去改，而那只是缩放。
 */
export function ScaleBadge({
  w,
  h,
  scale,
  testId,
}: {
  w: number;
  h: number;
  scale: number;
  testId?: string;
}): React.ReactElement {
  return (
    <span
      className="absolute bottom-2 right-3 rounded-full bg-black/30 px-2 py-0.5 font-mono text-[9px] text-white/90"
      title={`固定 ${w}×${h} 设计分辨率，按容器等比缩放显示`}
      data-testid={testId}
    >
      {w}×{h} · {Math.round(scale * 100)}%
    </span>
  );
}
