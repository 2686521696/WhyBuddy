/**
 * 对话导轨：对话栏左边一列短横线，一条消息一条。照 grok-app 的 MessageNodeRail（src/components/lobe-chat/
 * MessageNodeRail.tsx，它自己说是照 Codex 的样式）。数据在 message-rail-nodes.ts（头注说为什么跟消息列表同源）。
 *
 * - 悬停：刻度伸长，旁边浮出预览——谁说的、开头一句、第几条 / 共几条。
 * - 点击：跳到那条消息，那条消息描一下边；上下两个小箭头是上一条 / 下一条（悬停导轨时才出来）。
 * - 自己滚动时，当前读到的那条高亮（视口上沿往下 28% 那条线）。
 *
 * 跟 grok-app 不一样的两处：
 * 1. 不藏。它在对话栏两侧留白不足 48px 时整个隐藏；我们的对话栏旁边常开着预览，栏窄、两侧没有留白，照抄就永远看不到。
 *    刻度平时只有 6px 宽，放在对话栏左边那 16px 内边距里，悬停才伸长。
 * 2. 跳转不用估高度。它的消息列表是虚拟化的（不在屏幕上的行不渲染），只能按估算的行高先跳个大概；
 *    我们的消息全在 DOM 里，直接量那条消息的位置。
 *
 * 照抄的讲究：滚动时 rAF 节流、每帧只查一次 DOM（它 #280 踩过的卡顿）；高亮状态归导轨自己，不让整个对话列表
 * 每滚一帧就重渲染；点击跳转后锁 1.2 秒不让滚动回调改高亮（平滑滚动途中会经过别的消息）；
 * 让刻度在导轨里可见时只滚导轨自己，不用 scrollIntoView（那会连带把对话栏也滚走）。
 */
import { ChevronDown, ChevronUp } from "lucide-react";
import React from "react";
import { createPortal } from "react-dom";

import { adjacentRailNode, pickActiveNodeId, type RailNode } from "./message-rail-nodes";
import "./message-node-rail.css";

export const RAIL_LABELS = {
  aria: "对话导轨",
  prev: "上一条消息",
  next: "下一条消息",
  user: "你",
  assistant: "面团",
} as const;

/** 视口上沿往下多少算「正在读」（grok-app 的 0.28）。 */
const FOCUS_RATIO = 0.28;
/** 点击跳转后多久不让滚动回调改高亮。 */
const NAV_LOCK_MS = 1200;
/** 跳到的那条消息描边多久。 */
const FLASH_MS = 1600;

type Tip = { node: RailNode; top: number; left: number };

/** 按属性值找元素。不拼选择器：id 里有引号之类就得转义，逐个比更省心。 */
function byAttr(root: HTMLElement, attr: string, value: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) if (el.getAttribute(attr) === value) return el;
  return null;
}

export function MessageNodeRail({
  nodes,
  viewportRef,
}: {
  nodes: readonly RailNode[];
  /** 对话的滚动容器（ThreadPrimitive.Viewport）。 */
  viewportRef: React.RefObject<HTMLElement | null>;
}) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [tip, setTip] = React.useState<Tip | null>(null);
  const [hot, setHot] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const navLockUntil = React.useRef(0);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeIds = React.useMemo(() => new Set(nodes.map(node => node.id)), [nodes]);
  const activeIndex = activeId ? nodes.findIndex(node => node.id === activeId) : -1;

  // 滚动时算「正在读哪条」：rAF 节流，一帧查一次 DOM。
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || nodes.length < 2) return;
    const sync = () => {
      rafRef.current = null;
      if (performance.now() < navLockUntil.current) return;
      const box = viewport.getBoundingClientRect();
      const focusY = box.top + viewport.clientHeight * FOCUS_RATIO;
      const rects = [];
      for (const row of viewport.querySelectorAll<HTMLElement>("[data-message-id]")) {
        const id = row.getAttribute("data-message-id");
        if (!id || !nodeIds.has(id)) continue;
        const r = row.getBoundingClientRect();
        if (r.height > 0) rects.push({ id, top: r.top, bottom: r.bottom });
      }
      const best = pickActiveNodeId(rects, focusY);
      if (best) setActiveId(prev => (prev === best ? prev : best));
    };
    const onScroll = () => {
      if (rafRef.current == null) rafRef.current = window.requestAnimationFrame(sync);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    rafRef.current = window.requestAnimationFrame(sync);
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [viewportRef, nodes.length, nodeIds]);

  // 当前那条刻度在导轨里看不见时，只滚导轨自己（不用 scrollIntoView：它会连带把对话栏滚走）。
  React.useEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0) return;
    const tick = byAttr(list, "data-node-id", nodes[activeIndex].id);
    if (!tick) return;
    const lb = list.getBoundingClientRect();
    const tb = tick.getBoundingClientRect();
    if (tb.top < lb.top) list.scrollTop -= lb.top - tb.top + 4;
    else if (tb.bottom > lb.bottom) list.scrollTop += tb.bottom - lb.bottom + 4;
  }, [activeIndex, nodes]);

  React.useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  const jumpTo = React.useCallback(
    (node: RailNode | null) => {
      const viewport = viewportRef.current;
      if (!node || !viewport) return;
      const el = byAttr(viewport, "data-message-id", node.id);
      if (!el) return;
      navLockUntil.current = performance.now() + NAV_LOCK_MS;
      setActiveId(node.id);
      const top = viewport.scrollTop + el.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
      viewport.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      viewport.querySelectorAll("[data-rail-flash]").forEach(other => other.removeAttribute("data-rail-flash"));
      el.setAttribute("data-rail-flash", "1");
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => el.removeAttribute("data-rail-flash"), FLASH_MS);
    },
    [viewportRef]
  );

  if (nodes.length < 2) return null;

  const showTip = (node: RailNode, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ node, top: r.top + r.height / 2, left: r.right + 8 });
  };
  const hideTip = (id: string) => setTip(cur => (cur?.node.id === id ? null : cur));
  const canPrev = activeIndex !== 0;
  const canNext = activeIndex < 0 || activeIndex < nodes.length - 1;

  return (
    <nav className={"sr-msg-rail" + (hot ? " is-hot" : "")} aria-label={RAIL_LABELS.aria} data-testid="message-rail">
      <div
        className="sr-msg-rail__cluster"
        onPointerEnter={() => setHot(true)}
        onPointerLeave={() => {
          setHot(false);
          setTip(null);
        }}
      >
        <button
          type="button"
          className="sr-msg-rail__chev"
          aria-label={RAIL_LABELS.prev}
          disabled={!canPrev}
          tabIndex={hot && canPrev ? 0 : -1}
          onClick={() => jumpTo(adjacentRailNode(nodes, activeId, -1))}
          data-testid="message-rail-prev"
        >
          <ChevronUp size={14} />
        </button>
        <div ref={listRef} className="sr-msg-rail__list" role="list">
          {nodes.map(node => {
            const role = node.role === "user" ? RAIL_LABELS.user : RAIL_LABELS.assistant;
            return (
              <div key={node.id} role="listitem" className="sr-msg-rail__item">
                <button
                  type="button"
                  data-node-id={node.id}
                  data-testid="message-rail-tick"
                  className={[
                    "sr-msg-rail__tick",
                    node.id === activeId ? "is-active" : "",
                    tip?.node.id === node.id ? "is-hover" : "",
                    node.status === "error" ? "is-error" : "",
                    node.status === "pending" ? "is-pending" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-label={`${role}：${node.preview}`}
                  aria-current={node.id === activeId ? "true" : undefined}
                  onMouseEnter={event => showTip(node, event.currentTarget)}
                  onMouseLeave={() => hideTip(node.id)}
                  onFocus={event => showTip(node, event.currentTarget)}
                  onBlur={() => hideTip(node.id)}
                  onClick={() => jumpTo(node)}
                />
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="sr-msg-rail__chev"
          aria-label={RAIL_LABELS.next}
          disabled={!canNext}
          tabIndex={hot && canNext ? 0 : -1}
          onClick={() => jumpTo(adjacentRailNode(nodes, activeId, 1))}
          data-testid="message-rail-next"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {tip && typeof document !== "undefined"
        ? createPortal(
            <div
              className="sr-msg-rail__tip"
              role="tooltip"
              data-testid="message-rail-tip"
              style={{ top: tip.top, left: tip.left }}
            >
              <div className="sr-msg-rail__tip-role">
                {tip.node.role === "user" ? RAIL_LABELS.user : RAIL_LABELS.assistant}
              </div>
              <div className="sr-msg-rail__tip-body">{tip.node.preview}</div>
              <div className="sr-msg-rail__tip-count">
                {tip.node.nodeIndex + 1} / {nodes.length}
              </div>
            </div>,
            document.body
          )
        : null}
    </nav>
  );
}
