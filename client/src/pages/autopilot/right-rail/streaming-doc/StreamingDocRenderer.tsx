/**
 * `autopilot-streaming-doc-renderer` — 委托至四区驾驶舱版本。
 *
 * 历史背景：
 * - Wave 0 阶段：在同一文件里实现了流式 SpecDocument 的标签栏 / 多文档切换。
 * - Wave 1 阶段：把 IA 升级为“左侧 200px 节点折叠树 + 右侧 Markdown 主区”的
 *   2 栏布局，避免节点 ×3 文档放在横向 tab 时溢出视口。
 *
 * 重构（`autopilot-spec-documents-workbench-v2`）：
 * - Phase 1 / Task 1：把 IA 进一步升级为“顶部状态栏 + 左侧 Spec 树 + 中间
 *   文档主区 + 底部执行步骤”的四区驾驶舱布局，由
 *   `streaming-doc/workbench/AutopilotSpecDocumentsWorkbench.tsx` 承担渲染。
 * - Phase 1 / Task 4：把流式 reducer / entries→chunks 派生 / 节点分组 /
 *   类型徽章工具上移到独立模块 `streaming-doc/streaming-state.ts`，由四区
 *   容器层消费并通过 props 透传给 `WorkbenchDocMain`。本文件保留为对外
 *   默认导出与 `__testing__` 命名空间的稳定挂载点，避免破坏
 *   `AutopilotRightRail.tsx` 的挂载分支与现有测试导入路径。
 *
 * 兼容约束（与 `requirements.md` Non-Goals 1-4 / 6 / 8 对齐）：
 * - 不修改 `useBlueprintRealtimeStore` schema、`BlueprintGenerationJob /
 *   BlueprintSpecTree / BlueprintSpecDocument` 字段、`MiroFishCardStream` 派生算法
 *   以及 `handleGenerateAllSpecDocs / handleGenerateNodeSpecDocs /
 *   exportSpecDocumentsToDownload` 的签名。
 * - 不向 `package.json` 引入新的 npm 运行时依赖，不要求 `swiper`。
 * - 模块描述、props、关键函数说明使用中文 JSDoc；`data-testid` / promptId /
 *   API 字段名一律使用英文标识。
 *
 * `__testing__` 命名空间继续暴露 `streamingDocsReducer / appendChunkReducer /
 * isSpecDocumentContentEntry / pickDocumentId / pickChunk / deriveDocumentTitle /
 * groupDocumentsByNode / getTypeBadge / INITIAL_REDUCER_STATE / EMPTY_DOC_STATE`，
 * 与既有测试契约一致；这些纯函数自 Task 4 起统一由
 * `streaming-doc/streaming-state.ts` 提供，本文件仅做 re-export。
 */

import type { FC } from "react";

import {
  AutopilotSpecDocumentsWorkbench,
  type AutopilotSpecDocumentsWorkbenchProps,
} from "./workbench/AutopilotSpecDocumentsWorkbench";

import {
  streamingDocsReducer,
  appendChunkReducer,
  isSpecDocumentContentEntry,
  pickDocumentId,
  pickChunk,
  deriveDocumentTitle,
  groupDocumentsByNode,
  getTypeBadge,
  INITIAL_REDUCER_STATE,
  EMPTY_DOC_STATE,
} from "./streaming-state";

export {
  isSpecDocumentContentEntry,
  pickDocumentId,
  pickChunk,
} from "./streaming-state";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * `StreamingDocRenderer` 的对外 props。
 *
 * 形状与 `AutopilotSpecDocumentsWorkbenchProps` 等价；保留独立类型别名是为了
 * 维持既有的命名引用（例如 `AutopilotRightRail` 通过 `StreamingDocRendererProps`
 * 进行类型断言或 props 拼装时仍能稳定 import）。
 */
export type StreamingDocRendererProps = AutopilotSpecDocumentsWorkbenchProps;

// ---------------------------------------------------------------------------
// 组件：委托至四区驾驶舱容器
// ---------------------------------------------------------------------------

/**
 * 流式文档渲染主组件：当前阶段把渲染原样委托给
 * `AutopilotSpecDocumentsWorkbench`，确保 `AutopilotRightRail.tsx` 的挂载分支与
 * 既有 `__testing__` 测试契约保持稳定。后续 Task 5+ 会逐步把真实业务交互填充
 * 到容器内的四个子组件中。
 */
export const StreamingDocRenderer: FC<StreamingDocRendererProps> = (props) => {
  return (
    <div data-testid="streaming-doc-renderer" className="h-full min-h-0">
      <AutopilotSpecDocumentsWorkbench {...props} />
    </div>
  );
};

export default StreamingDocRenderer;

/**
 * 仅供测试导入；正常代码路径不应直接调这些纯函数。
 *
 * 命名空间形状必须与历史版本保持一致，否则会破坏既有 `__testing__` 测试。
 * 自 Task 4 起，所有成员都从 `streaming-doc/streaming-state.ts` 重导出，
 * 实现保持不变。
 */
export const __testing__ = {
  streamingDocsReducer,
  appendChunkReducer,
  isSpecDocumentContentEntry,
  pickDocumentId,
  pickChunk,
  deriveDocumentTitle,
  groupDocumentsByNode,
  getTypeBadge,
  INITIAL_REDUCER_STATE,
  EMPTY_DOC_STATE,
};
