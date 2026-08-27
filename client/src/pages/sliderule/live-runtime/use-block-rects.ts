/**
 * 刀 1 的接线：把块矩形量测挂到画板上（2026-08-27）。
 *
 * `block-rects.ts` 是纯的、判据齐的；这个文件负责让它**真的被调用到**。
 * CLAUDE.md 第一条：函数写对了 ≠ 它被调用了。所以另有一条源码级判据
 * （`block-rects-reaches-the-live-path.test.ts`）钉着 ArtboardNode 上的挂载点。
 *
 * ## 量测时机
 *
 * 挂在 `HtmlAppSurface` 的 `onReport` 上——它在 `applyBindings` 的下一行触发
 * （html-app-surface.tsx，"填数必须在写进框之后"那段）。早一步量，表格块的
 * 高度是模板行的高度。
 *
 * ## ⚠ 但 onReport **不是最后一次**布局变化
 *
 * Tailwind Play 扫完 DOM 之后还会往 head 补注一层 utility（同一份头注里
 * "刚铺满，过一秒又缩回屏幕中间一张卡片"那段记的就是这件事）。也就是说
 * onReport 那一刻量到的矩形**可能还会再变一次**，而且不报错。
 *
 * 所以除了 onReport，还挂一个 ResizeObserver 在 iframe 的 documentElement 上：
 * 布局再动就推进 layoutEpoch，几何世代号跟着变，下一帧重量。这正是两条
 * 世代号里 `layoutEpoch` 那一项的来源。
 *
 * ## ⚠ fail-open
 *
 * 量不到（iframe 还没挂、跨源、ResizeObserver 不存在）一律**如实回空快照**，
 * 不抛、不重试、不猜一个矩形。块矩形是画布上的增强，不是闭环证据——炸了
 * 只该少一层框，不许拖垮画板本身（纪律七）。
 */

import * as React from "react";

import {
  EMPTY_BLOCK_RECTS,
  deriveGenerations,
  isBlockRectsStale,
  measureBlockRects,
  type BlockRectSnapshot,
} from "./block-rects";

export interface UseBlockRectsResult {
  snapshot: BlockRectSnapshot;
  /** 内容世代号：刀 4 的绑定索引拿它当失效键（**不是**几何世代号）。 */
  contentGeneration: number;
  /** 交给 `HtmlAppSurface.onReport`。 */
  onSurfaceReport: () => void;
}

/**
 * 量这一块画板上所有块的矩形。
 *
 * @param hostRef 画板最外层的 div。iframe 在它里面（跟 pickElementAtPoint
 *                找 iframe 的走法一致——**不另写一套**）。
 * @param html    这一页的源 HTML。内容世代号只跟它走。
 * @param nodeSize 画板节点尺寸（设计分辨率原值，不含 React Flow 的 zoom）。
 * @param enabled 没挂载（还没进视口）时传 false：不量、不装观察者。
 */
export function useBlockRects(
  hostRef: React.RefObject<HTMLElement | null>,
  html: string,
  nodeSize: { width: number; height: number },
  enabled: boolean
): UseBlockRectsResult {
  const [snapshot, setSnapshot] =
    React.useState<BlockRectSnapshot>(EMPTY_BLOCK_RECTS);
  const [layoutEpoch, setLayoutEpoch] = React.useState(0);

  const { contentGeneration, geometryGeneration } = React.useMemo(
    () => deriveGenerations({ html, layoutEpoch }),
    [html, layoutEpoch]
  );

  /* 尺寸进 ref 而不是进 measure 的依赖：nodeSize 每次渲染都是新对象字面量，
     进依赖数组会让 measure 每帧换一个身份，ResizeObserver 跟着反复装拆。 */
  const nodeSizeRef = React.useRef(nodeSize);
  nodeSizeRef.current = nodeSize;
  const genRef = React.useRef(geometryGeneration);
  genRef.current = geometryGeneration;

  const measure = React.useCallback(() => {
    const frame = hostRef.current?.querySelector("iframe");
    if (!frame) return;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return; // 跨源。srcdoc 同源，理论上到不了这儿。
    }
    if (!doc?.body) return;
    /* ⚠ 文档尺寸取 documentElement.clientWidth，节点尺寸取设计分辨率原值。
       这两个口径必须跟 pickElementAtPoint 一模一样，否则同一块的"高亮框"
       和"块框"会差一个比例，看着像抖。那边头注记着"缩两次"的真机账。 */
    const docSize = {
      width: doc.documentElement.clientWidth || frame.clientWidth,
      height: doc.documentElement.clientHeight || frame.clientHeight,
    };
    if (!(docSize.width > 0) || !(docSize.height > 0)) return;
    const next = measureBlockRects(
      doc.body,
      docSize,
      nodeSizeRef.current,
      genRef.current
    );
    setSnapshot(prev =>
      isBlockRectsStale(prev, next.geometryGeneration) ? next : prev
    );
  }, [hostRef]);

  /* 世代号变了（内容变了、或布局纪元推进了）就重量。 */
  React.useEffect(() => {
    if (!enabled) return;
    measure();
  }, [enabled, measure, geometryGeneration]);

  /* 布局再动 → 推进 layoutEpoch → 上面那条 effect 重量。
     ⚠ 观察的是 iframe 里的 documentElement，不是外面的画板 div：画板尺寸是
       设计分辨率写死的，永远不变；真正会变的是 Tailwind 补注之后的内容布局。 */
  React.useEffect(() => {
    if (!enabled) return;
    if (typeof ResizeObserver === "undefined") return; // fail-open
    const frame = hostRef.current?.querySelector("iframe");
    let doc: Document | null = null;
    try {
      doc = frame?.contentDocument ?? null;
    } catch {
      return;
    }
    const target = doc?.documentElement;
    if (!target) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      /* ⚠ 装上去那一次会立刻回调一发（ResizeObserver 的既定行为）。
         那一发不算"布局变了"，吞掉——否则每次挂载都白推进一次世代号。 */
      if (first) {
        first = false;
        return;
      }
      setLayoutEpoch(e => e + 1);
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, [enabled, hostRef, html]);

  return { snapshot, contentGeneration, onSurfaceReport: measure };
}
