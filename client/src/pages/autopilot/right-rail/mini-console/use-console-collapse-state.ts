/**
 * MiniConsoleBar 折叠/peek/展开状态机 hook
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-narrative-swiper/`
 * - Requirement 5.3：hover ≥ 250ms 进入 `peek`，离开 250ms 后回 `collapsed`
 * - Requirement 5.4：显式点击展开按钮进入 `expanded`，持续展开直到再次手动折叠
 * - Requirement 5.5：`Esc` 监听器只在 `expanded` 模式下挂载，避免污染全局键盘
 * - Requirement 5.8：sessionStorage 键 `autopilot.console.collapsed`，仅在用户显式
 *   点击时写入；sessionStorage 不可用时（隐私模式）退化为内存态
 * - Requirement 9.5：所有 timer / listener 在 `useEffect` cleanup 中释放，不在
 *   React 严格模式下产生悬挂副作用
 *
 * 硬性约束：
 * - 不订阅 `useAppStore` / `useProjectStore`；不写入全局 store。
 * - 不读 / 写 `localStorage`。
 * - hover 进入 / 离开均使用 250ms 阈值，避免快速划过时反复抖动。
 * - sessionStorage 读写均通过 `try/catch` 包裹；任何异常都不冒泡到 React render path。
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * MiniConsoleBar 当前展示形态：
 * - `collapsed`：默认极简形态，只显示最近 1-2 行系统流水
 * - `peek`：hover ≥ 250ms 触发的临时浮起态，离开 250ms 后回 `collapsed`
 * - `expanded`：用户显式点击展开按钮后的持续展开态，仅 `collapse()` / `Esc` 退出
 */
export type ConsoleCollapseMode = "collapsed" | "peek" | "expanded";

/**
 * sessionStorage 键。仅在用户显式点击 `expand()` / `collapse()` 时写入，
 * hover/peek 不会触达 storage。
 */
export const CONSOLE_COLLAPSE_STORAGE_KEY = "autopilot.console.collapsed";

/**
 * hover 进入 → `peek` 与 hover 离开 → `collapsed` 的延迟阈值。
 * 两个方向使用相同时长，避免视觉抖动。
 */
const HOVER_DELAY_MS = 250;

export interface UseConsoleCollapseStateResult {
  /** 当前模式。组件根据此值决定渲染高度与内容。 */
  mode: ConsoleCollapseMode;
  /** 用户显式点击展开按钮：进入 `expanded` 并写入 sessionStorage。 */
  expand: () => void;
  /** 用户显式点击折叠按钮 / Esc：进入 `collapsed` 并写入 sessionStorage。 */
  collapse: () => void;
  /** hover 进入 mini bar：在 `collapsed` 状态下启动 250ms 计时器，到点切换 `peek`。 */
  hoverEnter: () => void;
  /** hover 离开 mini bar：在 `peek` 状态下启动 250ms 计时器，到点切换 `collapsed`。 */
  hoverLeave: () => void;
}

/**
 * 安全读取 sessionStorage。隐私模式 / SSR / 异常环境下返回 `null`，调用方
 * 退化为默认 `collapsed` 状态。
 */
function readPersistedMode(): ConsoleCollapseMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage?.getItem(CONSOLE_COLLAPSE_STORAGE_KEY);
    if (raw === "true") return "collapsed";
    if (raw === "false") return "expanded";
    return null;
  } catch {
    // 隐私模式 / 跨域 iframe 等场景下读取失败：退化为内存态。
    return null;
  }
}

/**
 * 安全写入 sessionStorage。仅在 `expand()` / `collapse()` 时调用。
 * 写入失败不影响内存态推进；调用方依然能在当前会话内保持目标模式。
 */
function writePersistedMode(mode: "collapsed" | "expanded"): void {
  if (typeof window === "undefined") return;
  try {
    const storage = window.sessionStorage;
    if (!storage) return;
    storage.setItem(
      CONSOLE_COLLAPSE_STORAGE_KEY,
      mode === "collapsed" ? "true" : "false",
    );
  } catch {
    // 隐私模式下写入失败：忽略，保持内存态行为一致。
  }
}

/**
 * MiniConsoleBar 折叠状态 hook。
 *
 * 状态迁移规则：
 * 1. 初始：读 sessionStorage；命中 `"true"` → `collapsed`，命中 `"false"` →
 *    `expanded`，其他情况退化为 `collapsed`。
 * 2. `hoverEnter()`：仅在 `collapsed` 时启动 250ms 计时器；到点 → `peek`。
 *    若中途 `hoverLeave()` 或 `expand()` / `collapse()` 调用，计时器在 cleanup
 *    中释放。
 * 3. `hoverLeave()`：仅在 `peek` 时启动 250ms 计时器；到点 → `collapsed`。
 *    `expanded` 模式下 hoverLeave 不触发任何状态变化。
 * 4. `expand()`：无视当前模式直接进入 `expanded`，并写入 sessionStorage `"false"`。
 *    任何 hover 计时器一并清理。
 * 5. `collapse()`：无视当前模式直接进入 `collapsed`，并写入 sessionStorage `"true"`。
 *    任何 hover 计时器一并清理。
 * 6. `Esc` 键：仅当 `mode === "expanded"` 时挂载 `keydown` 监听；触发等价于
 *    `collapse()`。其他模式下监听器卸载，不污染全局键盘。
 */
export function useConsoleCollapseState(): UseConsoleCollapseStateResult {
  const [mode, setMode] = useState<ConsoleCollapseMode>(() => {
    return readPersistedMode() ?? "collapsed";
  });

  // hover 计时器：collapsed → peek 与 peek → collapsed 共用同一 ref，
  // 任一 transition 触发前都先 clear，避免计时器重叠。
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // 卸载时确保所有计时器释放（Requirement 9.5）。
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
  }, []);

  const expand = useCallback(() => {
    clearHoverTimer();
    setMode("expanded");
    writePersistedMode("expanded");
  }, [clearHoverTimer]);

  const collapse = useCallback(() => {
    clearHoverTimer();
    setMode("collapsed");
    writePersistedMode("collapsed");
  }, [clearHoverTimer]);

  const hoverEnter = useCallback(() => {
    // 仅在 `collapsed` 状态下安排 peek 切换；`peek` / `expanded` 状态下
    // 已经处于浮起 / 持续展开，无需再次推进。
    setMode(current => {
      if (current !== "collapsed") {
        // 不变：返回相同引用避免不必要的渲染。
        return current;
      }
      // 安排进入 peek。先 clear 上一轮残留 timer，避免离开 → 进入快速切换时
      // 把 collapse 计时器误认为 peek 计时器。
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current);
      }
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null;
        setMode(inner => (inner === "collapsed" ? "peek" : inner));
      }, HOVER_DELAY_MS);
      return current;
    });
  }, []);

  const hoverLeave = useCallback(() => {
    // 仅在 `peek` 状态下安排回 collapsed；`expanded` 不被 hover leave 影响
    // （Requirement 5.4：显式点击展开后持续展开直到再次手动折叠）。
    setMode(current => {
      if (current !== "peek") {
        return current;
      }
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current);
      }
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null;
        setMode(inner => (inner === "peek" ? "collapsed" : inner));
      }, HOVER_DELAY_MS);
      return current;
    });
  }, []);

  // Esc 监听器：仅在 `expanded` 模式下挂载（Requirement 5.5）。
  // 监听器在 effect cleanup 中卸载，避免折叠后仍消费全局键盘事件。
  useEffect(() => {
    if (mode !== "expanded") return;
    if (typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        collapse();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mode, collapse]);

  return { mode, expand, collapse, hoverEnter, hoverLeave };
}
