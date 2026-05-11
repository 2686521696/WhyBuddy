/**
 * Shim：historically `BlueprintProgressPanel` 内部聚合了多条 blueprint fetch 调用，
 * 自 Spec 4 `autopilot-right-rail-data-hook` 起统一改由 `useAutopilotRightRailData`
 * 承接。此文件保留为单行 re-export，兼容历史 import 路径；详细语义与类型请见：
 *   `@/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data`
 *
 * 未来 Phase B cleanup 可以直接 `git rm` 本文件，不需要额外迁移调用方。
 */

export {
  useAutopilotRightRailData as useBlueprintProgressData,
  type RightRailDataView,
  type RightRailDataFieldStatus,
  type UseAutopilotRightRailDataOptions,
} from "@/pages/autopilot/right-rail/hooks/use-autopilot-right-rail-data";
