/**
 * TruncatedText — 放不下就省略号 + 悬浮看全文。
 *
 * 2026-08-26 用户要求：卡片墙一行四个之后文字挤了，"文字长了就加省略号 +
 * tooltip"。
 *
 * ⚠ **只在真的截断时才挂 tooltip。** 无条件挂的话，短文案也会在鼠标扫过时
 *   弹一个跟眼前一模一样的浮层——一屏几十张卡，扫过去满屏乱弹，比不做还烦。
 *   所以量一次：scrollWidth/Height 超出 clientWidth/Height 才算截断。
 *
 * ⚠ 量完还要**跟着尺寸变**（ResizeObserver）：分栏拖窄、侧栏折叠、窗口缩放
 *   都会把原本放得下的文案挤成截断。只在挂载时量一次的话，那之后省略号出来了
 *   而 tooltip 没跟上——用户看到"…"却悬浮不出全文，比没有省略号更让人困惑。
 *
 * ⚠ jsdom 里没有 ResizeObserver 也没有真实布局，这里要能安静地退化成
 *   "不截断、不挂 tooltip"，别让静态渲染测试炸掉。
 */

import React from "react";
import { Tooltip } from "antd";

export function TruncatedText({
  text,
  className = "",
  lines = 1,
  as: Tag = "span",
  "data-testid": testId,
}: {
  text: React.ReactNode;
  className?: string;
  /** 1 = 单行 truncate；>1 = 多行夹断 */
  lines?: number;
  as?: "span" | "div" | "p";
  "data-testid"?: string;
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [clipped, setClipped] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      /*
       * ⚠ **量到 0 就当"不知道"，保留上一次的结论。**
       *
       *   2026-08-26 真机量出来的：切 tab 时元素会被卸载，ResizeObserver 在
       *   它已经脱离布局之后还会再回调一次，那时 scroll/client 全是 0——
       *   `0 > 0+1` 为假，于是把上一轮**正确的**"已截断"覆盖成"没截断"。
       *   现象是省略号明明在，悬浮却不出 tooltip，而且只在某些进入路径上复现。
       *   一个脱离布局的元素给不出任何信息，别拿它下结论。
       */
      if (!el.clientWidth && !el.clientHeight) return;
      // +1 容忍亚像素：不加的话某些缩放下会把没截断的也判成截断，
      // 于是一批短文案凭空长出 tooltip。
      setClipped(
        el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines]);

  const clampStyle: React.CSSProperties =
    lines > 1
      ? {
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: lines,
          overflow: "hidden",
        }
      : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  const node = (
    <Tag
      ref={ref as never}
      style={clampStyle}
      className={className}
      data-testid={testId}
      data-clipped={clipped ? "1" : "0"}
    >
      {text}
    </Tag>
  );

  if (!clipped) return node;
  return (
    <Tooltip title={text} mouseEnterDelay={0.35} placement="top">
      {node}
    </Tooltip>
  );
}
