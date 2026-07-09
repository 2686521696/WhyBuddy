/**
 * MiniConsoleBar — 左下系统流水极简折叠条
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-narrative-swiper/`
 * - Requirement 4.1 / 4.2：通过 `routeConsoleLine()` 过滤掉 `narrative-only`
 *   的 entry，仅展示系统流水（console-only / both）。
 * - Requirement 5.1：桌面 1280+ 默认渲染为 80-120px 高度。
 * - Requirement 5.2：显示最近 1-2 条系统流水摘要 + 连接状态指示 + 展开按钮。
 *
 * 设计约束：
 * - 接入 `useConsoleCollapseState`，根据 mode 决定渲染折叠态或展开态。
 * - 折叠态（`collapsed`）：80-120px 高度，显示最近 1-2 条过滤后的 console lines、
 *   连接状态绿点、展开按钮（带 aria-label）。
 * - `peek` / `expanded` 态：渲染 `<ExpandedConsolePanel>`，通过 `renderExpanded`
 *   prop 透传既有 `<AutopilotConsolePanel>`。
 * - 通过 mouse events 驱动 hover 状态：`onMouseEnter` → `hoverEnter()`，
 *   `onMouseLeave` → `hoverLeave()`。
 * - 不修改 `AutopilotConsolePanel`（Req 10.8）。
 * - 不引入新的 npm 运行时依赖（Req 10.5）。
 * - 复用 `lucide-react` 图标。
 * - `data-testid="autopilot-runtime-console-mini"` 在根容器上。
 */

import { ChevronUp } from "lucide-react";
import type { FC, ReactNode } from "react";

import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { ConsoleLine } from "../../AutopilotRoutePage";
import { routeConsoleLine } from "../right-rail-console-routing";
import { ExpandedConsolePanel } from "./ExpandedConsolePanel";
import { useConsoleCollapseState } from "./use-console-collapse-state";

/**
 * 内部 i18n 工具：与 right-rail 其它组件保持一致的二选一签名。
 */
function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

export interface MiniConsoleBarProps {
  /** 应用语言。 */
  locale: AppLocale;
  /** 当前所有 console lines（由 `buildConsoleLines` 派生）。 */
  consoleLines: ConsoleLine[];
  /**
   * 展开层主体内容渲染函数。由消费者传入既有 `<AutopilotConsolePanel>`，
   * 避免本组件直接耦合具体日志渲染实现（Req 5.6）。
   */
  renderExpanded: () => ReactNode;
}

/**
 * 过滤 console lines：仅保留 `console-only` 或 `both` 的 entry，
 * 过滤掉 `narrative-only`（Req 4.1 / 4.2）。
 */
function filterConsoleLines(lines: ConsoleLine[]): ConsoleLine[] {
  return lines.filter((line) => {
    const decision = routeConsoleLine(line);
    return decision.target !== "narrative-only";
  });
}

/**
 * MiniConsoleBar 组件。
 *
 * 折叠态：80-120px 高度，显示最近 1-2 条系统流水摘要 + 连接状态指示 + 展开按钮。
 * peek / expanded 态：渲染 `<ExpandedConsolePanel>`。
 */
export const MiniConsoleBar: FC<MiniConsoleBarProps> = ({
  locale,
  consoleLines,
  renderExpanded,
}) => {
  const { mode, expand, collapse, hoverEnter, hoverLeave } =
    useConsoleCollapseState();

  // 过滤掉 narrative-only 的 entry（Req 4.1 / 4.2）
  const filteredLines = filterConsoleLines(consoleLines);

  // 取最近 1-2 条用于折叠态展示
  const recentLines = filteredLines.slice(-2);

  // peek / expanded 态：渲染展开面板
  if (mode === "peek" || mode === "expanded") {
    return (
      <div
        data-testid="autopilot-runtime-console-mini"
        onMouseEnter={hoverEnter}
        onMouseLeave={hoverLeave}
      >
        <ExpandedConsolePanel
          renderExpanded={renderExpanded}
          onCollapse={collapse}
          locale={locale}
        />
      </div>
    );
  }

  // collapsed 态：80-120px mini bar
  return (
    <section
      data-testid="autopilot-runtime-console-mini"
      aria-label={t(
        locale,
        "自动驾驶运行时控制台（折叠）",
        "Autopilot runtime console (collapsed)",
      )}
      className={cn(
        "relative flex flex-col justify-center",
        // 桌面 1280+ 默认 80-120px 高度（Req 5.1）
        "h-[96px] min-h-[80px] max-h-[120px]",
        // 视觉：深底 + 圆角 + 边框，与 ExpandedConsolePanel 一致
        "rounded-[10px] border border-white/10 bg-slate-950/88",
        "px-3 py-2 text-white",
      )}
      onMouseEnter={hoverEnter}
      onMouseLeave={hoverLeave}
    >
      {/* 顶部行：连接状态指示 + 标题 + 展开按钮 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* 连接状态绿点（Req 5.2） */}
          <span
            className="inline-block size-2 shrink-0 rounded-full bg-emerald-400"
            aria-label={t(locale, "已连接", "Connected")}
          />
          <span className="text-[11px] font-medium uppercase tracking-wide text-white/60">
            {t(locale, "系统流水", "System log")}
          </span>
        </div>

        {/* 展开按钮（Req 5.2） */}
        <button
          type="button"
          onClick={expand}
          aria-label={t(locale, "展开运行时控制台", "Expand runtime console")}
          title={t(locale, "展开运行时控制台", "Expand runtime console")}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "text-white/60 transition-colors hover:bg-white/10 hover:text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60",
          )}
        >
          <ChevronUp className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* 最近 1-2 条系统流水摘要（Req 5.2） */}
      <div className="mt-1.5 flex flex-col gap-0.5 overflow-hidden">
        {recentLines.length === 0 ? (
          <span className="text-[11px] text-white/40">
            {t(locale, "暂无系统流水", "No system logs")}
          </span>
        ) : (
          recentLines.map((line) => (
            <p
              key={line.id}
              className={cn(
                "truncate text-[11px] leading-tight",
                line.tone === "danger"
                  ? "text-red-300/80"
                  : line.tone === "warning"
                    ? "text-amber-300/80"
                    : line.tone === "success"
                      ? "text-emerald-300/80"
                      : "text-white/50",
              )}
            >
              {line.message}
            </p>
          ))
        )}
      </div>
    </section>
  );
};

export default MiniConsoleBar;
