/**
 * Autopilot 右栏数据层 hooks — barrel re-export
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-data-hook/`
 * - Requirement 9.3
 *
 * 本 barrel 存在的理由：
 * - 消费者通过 `import { useAutopilotRightRailData } from "@/pages/autopilot/right-rail/hooks"`
 *   的稳定路径访问 hook，避免深链 `./use-autopilot-right-rail-data` 在未来子模块拆分时
 *   产生调用方大面积修改。
 * - 顶层 `client/src/pages/autopilot/right-rail/index.ts` 继续作为对外唯一出口 re-export 本 barrel
 *   中的 named exports。
 */

export {
  useAutopilotRightRailData,
  type RightRailDataFieldStatus,
  type RightRailDataView,
  type UseAutopilotRightRailDataOptions,
} from "./use-autopilot-right-rail-data";
