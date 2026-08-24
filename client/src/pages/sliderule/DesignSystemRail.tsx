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
import { allDesignSystems, isCustomDesignSystem } from "./design-system";

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

  if (!panel) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid="sliderule-design-rail"
      style={
        pos
          ? { left: pos.left, bottom: pos.bottom, maxHeight: pos.maxH }
          : { left: -9999, bottom: 0 }
      }
      className={`fixed z-[75] flex items-stretch gap-2 transition-opacity duration-150 ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div
        role="menu"
        data-testid="sliderule-design-system-menu"
        className="flex h-full w-[272px] shrink-0 flex-col overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0_24px_64px_rgb(15_23_42/0.18)]"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
