/**
 * 设计系统右侧栏：清单 + 色板面板，并排。
 *
 * ## 为什么清单不在作曲家里
 *
 * ⚠ 2026-08-25 用户原话「显示在右侧，点击预设不消失，侧边栏弹出色板，点击应用
 *   一起消失」。上一版清单是 ComposerDock 里的一个下拉——它跟着作曲家浮在
 *   **对话栏上方**，而面板在**屏幕最右**，两者隔半个屏幕，看一套改一套要来回
 *   横跳。搬到右侧跟面板并排之后，清单和它的色板挨着，连着比几套才顺。
 *
 * ## 布局
 *
 *     [ 清单 ][ 色板面板 ]  ← 清单钉在作曲家按钮正上方，面板从它**右边**弹出
 *
 * ⚠ 2026-08-25 第三轮修正。上一版把清单也推到了屏幕最右边缘——那是我把用户
 *   截图里"从面板指向清单的箭头"读反了：那支箭头的意思是**把面板挪到清单旁边**，
 *   不是把清单挪去右边。结果两块都跑到了离作曲家半个屏幕远的地方，点开的东西
 *   不在手指落点附近。
 *
 *   现在整块锚在作曲家那颗按钮上（absolute bottom-full left-0），面板作为第二列
 *   向右展开。清单位置因此不随面板开合移动——点第一个预设时清单不会横跳。
 *
 * ⚠ 但**不能**用 absolute 锚在按钮上。真机量到：作曲家坐在
 *   `max-w-[720px] overflow-y-auto` 的对话滚动容器里，右边界 1321，而
 *   清单 272 + 面板 300 要到 1378 —— 面板被那一列**裁掉 57px**（种子色输入框、
 *   角半径、应用按钮全部截断）。锚在按钮上就逃不出这个列宽。
 *
 *   所以走 portal + fixed：位置由按钮的 getBoundingClientRect 现算，视觉上仍
 *   贴着按钮，但脱离所有 overflow:hidden 的祖先。右边放不下时整体左移，
 *   不让面板出屏。
 */
import React from "react";
import { createPortal } from "react-dom";
import { Check, Palette, Plus } from "lucide-react";

import { DesignSystemSwatch } from "./DesignSystemSwatch";
import { DesignSystemPanel } from "./DesignSystemPanel";
import { useDesignSystemPanel } from "./DesignSystemContext";
import {
  FREE_STYLE_HINT,
  FREE_STYLE_LABEL,
  allDesignSystems,
  isCustomDesignSystem,
} from "./design-system";

const MENU_W = 272;
const PANEL_W = 300;
const GAP = 8;

export function DesignSystemRail({
  anchorRef,
}: {
  /** 触发按钮所在的容器。位置从它的 rect 现算。 */
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const panel = useDesignSystemPanel();
  const open = !!panel?.menuOpen;
  const hasPanel = !!panel?.editing;
  // 每次展开现读：新建保存完不用刷新页面就能在清单里看到。
  const list = React.useMemo(() => (open ? allDesignSystems() : []), [open]);

  const railRef = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{
    left: number;
    bottom: number;
    maxH: number;
  } | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = MENU_W + (hasPanel ? GAP + PANEL_W : 0);
      // 右边放不下就整体左移贴边，别让面板出屏（真机 1680 宽时会差 57px）。
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      // ⚠ 高度也要钳：按钮上方能用的就那么多。真机 900 高时面板 480 会顶出
      //   视口，标题和关闭按钮跑到屏幕上面去（量到 top=-28）。
      setPos({
        left,
        bottom: window.innerHeight - r.top + GAP,
        maxH: Math.max(200, r.top - GAP - 12),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, hasPanel, anchorRef]);

  /**
   * ⚠ 外点 / Esc 关闭。2026-08-25 真机：清单搬出 ComposerDock 时，那边原来的
   * mousedown 外点关闭一并删掉了，而 Rail 里没补——结果**只有再点一次触发按钮
   * 才关得掉**，点空白、按 Esc 都没反应（用户原话"打开之后关不掉了"）。
   *
   * ⚠ 触发按钮在 Rail **外面**（作曲家里），所以必须把 anchor 一起排除：
   * 不排除的话点按钮会先被这里当外点关掉、再被按钮自己 toggle 打开，净效果
   * 是永远关不掉——比现在还糟。
   */
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (railRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      panel?.closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") panel?.closeAll();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, panel, anchorRef]);

  if (!panel) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={railRef}
      data-testid="sliderule-design-rail"
      /**
       * ⚠ items-end + 每列各自钳高，**不能**用 items-stretch / 给整行设 maxHeight。
       * 2026-08-25 真机：整行是 bottom 锚定的，面板(557) 比清单(312) 高，
       * 行高一变大就往上长——清单跟着上移 152px，看着像"位置飘了"。
       * 底对齐之后清单的下沿钉死在行底，面板只往上长，清单一动不动。
       * 高度限制走 CSS 变量下发给两列，不设在行上（设在行上又会撑起行高）。
       */
      style={
        pos
          ? ({
              left: pos.left,
              bottom: pos.bottom,
              ["--ds-max-h" as string]: `${pos.maxH}px`,
            } as React.CSSProperties)
          : { left: -9999, bottom: 0 }
      }
      className={`fixed z-[75] flex items-end gap-2 transition-opacity duration-150 ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div
        role="menu"
        data-testid="sliderule-design-system-menu"
        className="flex max-h-[var(--ds-max-h,60vh)] w-[272px] shrink-0 flex-col overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0_24px_64px_rgb(15_23_42/0.18)]"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {/* 自由风格 = 默认档（appliedId === null）。参照 TRAE 的「自由探索」：
              不钉死任何一套皮，风格段交给模型按题意自己写。 */}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={panel.appliedId === null}
            data-testid="sliderule-design-system-free"
            onClick={() => panel.applyFree()}
            className={`flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4] ${
              panel.appliedId === null ? "bg-[#eef0f4]" : ""
            }`}
          >
            <Palette className="h-5 w-5 shrink-0 text-stone-500" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-stone-800">
                {FREE_STYLE_LABEL}
              </span>
              <span className="block truncate text-[10px] text-stone-500">
                {FREE_STYLE_HINT}
              </span>
            </span>
            {panel.appliedId === null && (
              <Check className="h-3.5 w-3.5 shrink-0 text-[#1677ff]" />
            )}
          </button>

          <div className="my-1 h-px bg-[#eef0f4]" />

          <button
            type="button"
            data-testid="sliderule-design-system-new"
            onClick={() => panel.openNew()}
            className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] text-stone-700 transition hover:bg-[#eef0f4]"
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-stone-400" />
            新建设计系统
          </button>

          {list.map((sys, i) => {
            const on = sys.id === panel.appliedId;
            const viewing = sys.id === panel.editing?.id;
            const mine = isCustomDesignSystem(sys.id);
            const header =
              i === 0 && mine
                ? "我的设计体系"
                : (i === 0 && !mine) ||
                    (i > 0 && isCustomDesignSystem(list[i - 1].id) && !mine)
                  ? "预设"
                  : null;
            return (
              <React.Fragment key={sys.id}>
                {header && (
                  <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] text-stone-400">
                    <Palette className="h-3 w-3" />
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  data-testid={`sliderule-design-system-${sys.id}`}
                  onClick={() => {
                    // ⚠ 只开面板，**不落选中态、不关菜单**（用户第 2 条）。
                    //   落库要等「应用」——不然点着看几套的过程中，每点一下
                    //   都改掉了下一轮真正会用的那套。
                    panel.openView(sys.id);
                  }}
                  className={`flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition hover:bg-[#eef0f4] ${
                    viewing ? "bg-[#eef0f4]" : ""
                  }`}
                >
                  <DesignSystemSwatch seed={sys.seed} size={20} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-stone-800">
                      {sys.label}
                    </span>
                    <span className="block truncate text-[10px] text-stone-500">
                      {sys.description}
                    </span>
                  </span>
                  {on && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[#1677ff]" />
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* 面板是第二列，从清单右边展开。清单收起时它也不该单独留着
          （closeAll / toggleMenu 已保证）。 */}
      <DesignSystemPanel />
    </div>,
    document.body
  );
}
