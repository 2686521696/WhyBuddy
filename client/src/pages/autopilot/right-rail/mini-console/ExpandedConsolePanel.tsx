/**
 * ExpandedConsolePanel — MiniConsoleBar 展开层薄包装。
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-narrative-swiper/`
 * - Requirement 5.6：展开态复用既有 `<AutopilotConsolePanel>` 的滚动日志、筛选与连接
 *   状态展示，不重新实现日志渲染。
 * - Requirement 5.7：以左下浮层定位避开右栏主区域，避免遮挡核心工作台；
 *   不通过撑开布局的方式让出空间。
 *
 * 设计约束：
 * - 不直接 `import` `<AutopilotConsolePanel>`：消费者通过 `renderExpanded` 透传，
 *   避免与既有 `client/src/pages/autopilot/AutopilotRoutePage.tsx` 的本地组件
 *   形成循环依赖（task 7.5 在路由页装配时再传入既有 panel）。
 * - 渲染失败兜底交由上层 `<ErrorBoundary>` 处理（见 task 7.5）。
 * - 复用既有 `framer-motion`（进入动画）与 `lucide-react`（关闭图标）；不引入
 *   新的 npm 运行时依赖（Req 10.5）。
 * - 关闭按钮使用 `aria-label` 同步中英文（Req 12.4），不在动效层硬编码文案。
 * - `prefers-reduced-motion` 由 framer-motion `useReducedMotion()` 自动降级。
 */

import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import type { FC, ReactNode } from "react";

import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

/**
 * 内部 i18n 工具：与 right-rail 其它组件保持一致的二选一签名。
 * 不引入额外 i18n 资源；本组件仅承担装饰文案（Req 12.4）。
 */
function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

export interface ExpandedConsolePanelProps {
  /**
   * 展开层主体内容渲染函数。由消费者传入既有 `<AutopilotConsolePanel>`，
   * 避免本组件直接耦合具体日志渲染实现（Req 5.6）。
   */
  renderExpanded: () => ReactNode;
  /**
   * 用户点击关闭按钮 / Esc 触发的折叠回调。由 `useConsoleCollapseState`
   * 暴露的 `collapse()` 直接传入即可。
   */
  onCollapse: () => void;
  /**
   * 应用语言。未传时默认中文，与 `AutopilotConsolePanel` 保持一致。
   */
  locale?: AppLocale;
  /**
   * 允许消费者覆盖根容器 className，承担少量响应式微调。
   * 不参与定位主轴；定位主轴由本组件内联固定（Req 5.7）。
   */
  className?: string;
}

/**
 * 左下浮层定位策略说明：
 *
 * - 桌面 1280+：`fixed bottom-4 left-4`，宽度上限 `min(720px, 50vw)`，
 *   `right` 留出右栏所需空间，避免遮挡右栏主内容（Req 5.7）。
 *   通过 `max-width` 控制即可，不需要硬绑定具体右栏宽度变量。
 * - 768-1280px：缩为 `min(560px, 70vw)`，仍保持左下定位。
 * - <768px：`left-2 right-2 bottom-2`，几乎全宽，承接窄屏 drawer 兜底。
 *
 * 高度上限 `max-h-[60vh]`：防止日志极长时浮层吃满整屏。
 */
const PANEL_POSITIONING_CLASS =
  "fixed bottom-4 left-4 right-4 z-40 " +
  "md:right-auto md:max-w-[min(560px,70vw)] " +
  "xl:max-w-[min(720px,50vw)] " +
  "max-h-[60vh] overflow-hidden";

export const ExpandedConsolePanel: FC<ExpandedConsolePanelProps> = ({
  renderExpanded,
  onCollapse,
  locale = "zh-CN",
  className,
}) => {
  // prefers-reduced-motion 命中时直接关闭进入动画。framer-motion 的
  // `useReducedMotion()` 在 SSR / 测试环境下返回 null，等价于"没有偏好"，
  // 此时仍走默认动画但 duration 极短，不阻塞 SSR markup（Req 9.4）。
  const prefersReducedMotion = useReducedMotion();

  const closeAriaLabel = t(locale, "折叠运行时控制台", "Collapse runtime console");

  return (
    <motion.section
      data-testid="autopilot-runtime-console-expanded"
      role="dialog"
      aria-modal="false"
      aria-label={t(
        locale,
        "自动驾驶运行时控制台（展开）",
        "Autopilot runtime console (expanded)",
      )}
      // 进入动画：从下方 8px 滑入 + fade。退出动画交给消费者卸载即可，
      // 不在本层挂 AnimatePresence，避免跨组件状态复杂化。
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: prefersReducedMotion ? 0 : 0.18,
        ease: "easeOut",
      }}
      className={cn(
        PANEL_POSITIONING_CLASS,
        // 视觉与既有 console panel 一致：深底 + glass blur，避免与 3D 场景
        // 视觉冲突。圆角与边框在浮层语境下保留，便于与背景区分。
        "rounded-[12px] border border-white/10 bg-slate-950/92 text-white",
        "shadow-[0_24px_64px_rgba(2,6,23,0.45)] backdrop-blur-xl",
        // 内部 flex column：header 固定高度，body 占满剩余高度并允许滚动。
        "flex flex-col",
        className,
      )}
    >
      {/* Header：与 AutopilotConsolePanel 内部 chip 行视觉对齐，但本组件只
          承担定位与折叠交互，不重复渲染 console 自身的事件流 chip / 行计数。 */}
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-3",
          "border-b border-white/[0.06] px-3 py-2",
        )}
      >
        <span className="text-[11px] font-black uppercase tracking-normal text-white/65">
          {t(locale, "运行时控制台", "Runtime console")}
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={closeAriaLabel}
          title={closeAriaLabel}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "text-white/60 transition-colors hover:bg-white/10 hover:text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60",
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      {/* Body：直接渲染消费者透传的展开层（既有 AutopilotConsolePanel）。
          外层 max-h + overflow 已经把滚动语义留给内部既有实现，本组件不
          额外包裹 overflow 容器，避免双重滚动条（Req 5.6）。 */}
      <div className="min-h-0 flex-1 overflow-hidden">{renderExpanded()}</div>
    </motion.section>
  );
};

export default ExpandedConsolePanel;
