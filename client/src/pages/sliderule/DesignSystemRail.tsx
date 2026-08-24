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
 *     [ 色板面板 ][ 清单 ]  ← 清单钉在右边缘，面板从它左边"弹出"
 *
 * 清单位置固定（右边缘），面板出现时向左展开。反过来（面板钉右、清单左移）
 * 会让清单在点第一个预设时整条横跳，看着像点错了。
 */
import React from "react";
import { Check, Palette, Plus } from "lucide-react";

import { DesignSystemSwatch } from "./DesignSystemSwatch";
import { DesignSystemPanel } from "./DesignSystemPanel";
import { useDesignSystemPanel } from "./DesignSystemContext";
import { allDesignSystems, isCustomDesignSystem } from "./design-system";

export function DesignSystemRail() {
  const panel = useDesignSystemPanel();
  const open = !!panel?.menuOpen;
  // 每次展开现读：新建保存完不用刷新页面就能在清单里看到。
  const list = React.useMemo(() => (open ? allDesignSystems() : []), [open]);
  if (!panel) return null;

  return (
    <>
      {/* 面板在清单左边。清单收起时面板也不该单独留着（closeAll / toggleMenu 已保证）。 */}
      <DesignSystemPanel />

      <div
        role="menu"
        data-testid="sliderule-design-system-menu"
        className={`fixed right-4 top-16 z-[75] flex max-h-[calc(100vh-96px)] w-[272px] flex-col overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0_24px_64px_rgb(15_23_42/0.18)] transition-all duration-150 ${
          open
            ? "translate-x-0 opacity-100"
            : "pointer-events-none translate-x-3 opacity-0"
        }`}
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
    </>
  );
}
