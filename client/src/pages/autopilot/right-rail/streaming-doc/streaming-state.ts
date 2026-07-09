/**
 * `autopilot-streaming-doc-renderer` — 流式文档共享状态层。
 *
 * 历史背景：
 * - 之前所有流式 reducer / entries→chunks 派生 / 节点分组 / 类型徽章工具
 *   都集中在 `StreamingDocRenderer.tsx` 一份文件中，并通过 `__testing__`
 *   命名空间对外暴露给测试。
 * - `autopilot-spec-documents-workbench-v2` Phase 1 / Task 4 把流式状态从
 *   `StreamingDocRenderer.tsx` 上移到 `AutopilotSpecDocumentsWorkbench`
 *   容器层（容器持有 reducer 与派生记忆，并通过 props 透传给
 *   `WorkbenchDocMain`），以避免把 reducer 状态、scroll restore 与四区
 *   driver 的关注点混在同一个组件里。
 *
 * 本模块的定位：
 * - 沉淀流式 reducer 与所有上游派生工具，是 `StreamingDocRenderer.tsx`
 *   `__testing__` 命名空间的真正实现来源；后者继续从这里 re-export，
 *   保证 `__testing__` shape 与既有测试契约不变。
 * - 不修改任何对外签名 / 行为：
 *   - `streamingDocsReducer / appendChunkReducer` 三类 action 的处理顺序、
 *     `INITIAL_REDUCER_STATE / EMPTY_DOC_STATE` 形状保持不变；
 *   - `isSpecDocumentContentEntry / pickDocumentId / pickChunk` 仍兼容
 *     `spec_documents` 与历史 `spec_docs` stage、payload 嵌套字段、
 *     `observationSummary / thought` 兜底；
 *   - `deriveDocumentTitle / groupDocumentsByNode / getTypeBadge` 行为
 *     与旧实现完全一致（包括 zh-CN / en 文案、TYPE_ORDER 排序、未知
 *     节点 title 回退到 nodeId）。
 *
 * 工程约束：
 * - 不引入新的 npm 运行时依赖（R6.2）。
 * - 模块描述、关键函数说明使用中文 JSDoc（R6.3）；`data-testid` /
 *   payload 字段名一律使用英文（R6.4）。
 */

import type { AppLocale } from "@/lib/locale";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
} from "@shared/blueprint/contracts";

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export interface StreamingDocState {
  rawMarkdown: string;
  parsedTokens: readonly unknown[];
  lastParsedLength: number;
  isStreaming: boolean;
}

export interface StreamingDocsReducerState {
  documents: Record<string, StreamingDocState>;
  documentIds: readonly string[];
}

export type StreamingDocsAction =
  | {
      type: "append-chunk";
      documentId: string;
      chunk: string;
    }
  | {
      type: "mark-streaming";
      documentId: string;
      isStreaming: boolean;
    }
  | {
      type: "reset";
    };

export const EMPTY_DOC_STATE: StreamingDocState = {
  rawMarkdown: "",
  parsedTokens: [],
  lastParsedLength: 0,
  isStreaming: false,
};

export const INITIAL_REDUCER_STATE: StreamingDocsReducerState = {
  documents: {},
  documentIds: [],
};

/**
 * 流式 chunk 累积纯函数：把同一 documentId 的新增片段写入 reducer 状态，
 * 同时维护 `documentIds` 的顺序集合。
 */
export function appendChunkReducer(
  state: StreamingDocsReducerState,
  documentId: string,
  chunk: string
): StreamingDocsReducerState {
  if (chunk.length === 0) {
    return state;
  }
  const existing = state.documents[documentId] ?? EMPTY_DOC_STATE;
  const nextRaw = existing.rawMarkdown + chunk;
  const nextDoc: StreamingDocState = {
    rawMarkdown: nextRaw,
    parsedTokens: existing.parsedTokens,
    lastParsedLength: nextRaw.length,
    isStreaming: true,
  };
  const nextDocumentIds = state.documentIds.includes(documentId)
    ? state.documentIds
    : [...state.documentIds, documentId];
  return {
    documents: {
      ...state.documents,
      [documentId]: nextDoc,
    },
    documentIds: nextDocumentIds,
  };
}

/**
 * 流式文档 reducer：处理三类动作，append-chunk / mark-streaming / reset。
 */
export function streamingDocsReducer(
  state: StreamingDocsReducerState,
  action: StreamingDocsAction
): StreamingDocsReducerState {
  switch (action.type) {
    case "append-chunk":
      return appendChunkReducer(state, action.documentId, action.chunk);
    case "mark-streaming": {
      const existing = state.documents[action.documentId] ?? EMPTY_DOC_STATE;
      if (existing.isStreaming === action.isStreaming) return state;
      return {
        ...state,
        documents: {
          ...state.documents,
          [action.documentId]: {
            ...existing,
            isStreaming: action.isStreaming,
          },
        },
      };
    }
    case "reset":
      return INITIAL_REDUCER_STATE;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Entries → chunks 派生
// ---------------------------------------------------------------------------

type SpecDocumentEntry = AgentReasoningEntry & {
  stage?: unknown;
  type?: unknown;
  documentId?: unknown;
  chunk?: unknown;
  payload?: {
    stage?: unknown;
    type?: unknown;
    documentId?: unknown;
    chunk?: unknown;
    [key: string]: unknown;
  };
};

const SPEC_DOCUMENTS_STAGE = "spec_documents";
const SPEC_DOCUMENTS_LEGACY_STAGE = "spec_docs";
const CONTENT_TYPE = "content";
export const DEFAULT_DOCUMENT_ID = "default";

function pickString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length === 0) return undefined;
  return value;
}

/**
 * 判断一条 reasoning entry 是否属于 `spec_documents` 阶段的内容片段。
 * 兼容历史 `spec_docs` stage 命名。
 */
export function isSpecDocumentContentEntry(
  entry: AgentReasoningEntry
): boolean {
  const extended = entry as SpecDocumentEntry;
  const stage =
    pickString(extended.stage) ??
    pickString(extended.stageId) ??
    pickString(extended.payload?.stage);
  if (
    stage !== SPEC_DOCUMENTS_STAGE &&
    stage !== SPEC_DOCUMENTS_LEGACY_STAGE
  ) {
    return false;
  }
  const type =
    pickString(extended.type) ?? pickString(extended.payload?.type);
  if (type !== undefined && type !== CONTENT_TYPE) {
    return false;
  }
  return true;
}

/**
 * 从 reasoning entry 中提取 documentId，缺失时回退到 `DEFAULT_DOCUMENT_ID`。
 */
export function pickDocumentId(entry: AgentReasoningEntry): string {
  const extended = entry as SpecDocumentEntry;
  return (
    pickString(extended.documentId) ??
    pickString(extended.payload?.documentId) ??
    DEFAULT_DOCUMENT_ID
  );
}

/**
 * 从 reasoning entry 中提取 chunk 字符串；按 chunk → payload.chunk →
 * observationSummary → thought 的优先级回退。
 */
export function pickChunk(entry: AgentReasoningEntry): string {
  const extended = entry as SpecDocumentEntry;
  return (
    pickString(extended.chunk) ??
    pickString(extended.payload?.chunk) ??
    pickString(entry.observationSummary) ??
    pickString(entry.thought) ??
    ""
  );
}

// ---------------------------------------------------------------------------
// 节点分组与标签派生
// ---------------------------------------------------------------------------

/**
 * 推导文档标题：优先取 SpecDocument.title，缺失时根据 documentId 给出降级文案。
 */
export function deriveDocumentTitle(
  documentId: string,
  specDocuments: readonly BlueprintSpecDocument[] | undefined,
  locale: AppLocale
): string {
  const matched = specDocuments?.find((doc) => doc.id === documentId);
  if (matched && typeof matched.title === "string" && matched.title.length > 0) {
    return matched.title;
  }
  if (documentId === DEFAULT_DOCUMENT_ID) {
    return locale === "zh-CN" ? "默认文档" : "Default Document";
  }
  return documentId;
}

export interface DocGroup {
  nodeId: string;
  nodeTitle: string;
  documents: BlueprintSpecDocument[];
}

export const TYPE_ORDER: Record<BlueprintSpecDocumentType, number> = {
  requirements: 0,
  design: 1,
  tasks: 2,
};

/**
 * 把 specDocuments 按 nodeId 分组，并使用 specTree 把 nodeId 解析为节点
 * 中文标题。组内文档按 requirements → design → tasks 顺序排序。
 */
export function groupDocumentsByNode(
  documents: readonly BlueprintSpecDocument[],
  nodeTitleByNodeId: ReadonlyMap<string, string>
): DocGroup[] {
  const map = new Map<string, DocGroup>();
  for (const doc of documents) {
    const existing = map.get(doc.nodeId);
    if (existing) {
      existing.documents.push(doc);
    } else {
      map.set(doc.nodeId, {
        nodeId: doc.nodeId,
        nodeTitle: nodeTitleByNodeId.get(doc.nodeId) ?? doc.nodeId,
        documents: [doc],
      });
    }
  }
  for (const group of map.values()) {
    group.documents.sort(
      (a, b) =>
        (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99)
    );
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// 类型徽章
// ---------------------------------------------------------------------------

export interface TypeBadgeStyle {
  shortLabel: string;
  fullLabel: string;
  className: string;
}

/**
 * 根据 SpecDocument.type 与 locale 返回类型徽章的短 / 长标签与样式 className。
 */
export function getTypeBadge(
  type: BlueprintSpecDocumentType,
  locale: AppLocale
): TypeBadgeStyle {
  const isZh = locale === "zh-CN";
  switch (type) {
    case "requirements":
      return {
        shortLabel: isZh ? "需" : "REQ",
        fullLabel: isZh ? "需求" : "Requirements",
        className: "bg-indigo-100 text-indigo-700",
      };
    case "design":
      return {
        shortLabel: isZh ? "设" : "DSG",
        fullLabel: isZh ? "设计" : "Design",
        className: "bg-emerald-100 text-emerald-700",
      };
    case "tasks":
      return {
        shortLabel: isZh ? "任" : "TSK",
        fullLabel: isZh ? "任务" : "Tasks",
        className: "bg-amber-100 text-amber-700",
      };
  }
}
