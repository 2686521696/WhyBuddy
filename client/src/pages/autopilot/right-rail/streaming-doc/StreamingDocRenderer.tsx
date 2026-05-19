/**
 * `autopilot-streaming-doc-renderer` — 全新 2 栏布局版本
 *
 * 流式文档渲染主容器（全新 IA）。
 *
 * 历史背景：之前使用 `DocTabBar` 横向标签栏展示多文档，但当 SPEC 树有
 * `~50` 个节点 × `3` 类文档（Requirements / Design / Tasks）= `150+` 文档时，
 * 横向 tab 总宽度超过 `15000px`，无法横向滚动且 UX 极差。
 *
 * 新设计：
 * - 左侧 `200px` 固定宽度侧边栏：搜索框 + 节点折叠树
 *   - 一级：SPEC 节点（按 `nodeId` 分组）
 *   - 二级：3 类文档（带类型徽章 `需 / 设 / 任`）
 *   - 当前 active 文档：indigo 高亮 + 左侧 2px 竖条
 *   - 流式生成中：右侧蓝色脉冲圆点
 * - 右侧主区：当前文档头部（标题 + 类型徽章 + 流式状态） + 可滚动 markdown
 * - 实时生成但尚未落库的文档（`documentId === "default"` 等）放在侧边栏顶部
 *   "实时生成" 分组中
 * - 搜索时自动展开匹配的节点
 *
 * 设计约束：
 * - 不引入 `@testing-library/react`，所有验证依赖纯函数 + SSR 渲染。
 * - 不扩大 TS 基线 117 errors。
 * - 浅色主题：右栏底色为白色，使用 `bg-slate-50 / text-slate-700` 等浅色
 *   语义；不允许出现 `bg-white/5 / text-white/*` 等深色毛玻璃语义。
 * - 宽度硬约束：每一层都使用 inline style `width: 100%, maxWidth: 100%,
 *   minWidth: 0, boxSizing: border-box`，杜绝 flex item `min-width: auto =
 *   min-content` 把容器撑出 grid track。
 *
 * 与 reducer 的协作：
 * - `streamingDocsReducer` / `appendChunkReducer` / `pickChunk` 等纯函数
 *   逻辑保持不变，仅替换可视化层。
 * - 测试导入的 `__testing__` 命名空间维持不变，不破坏现有测试契约。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FC,
} from "react";

import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import { MarkdownRenderer } from "./MarkdownRenderer";
import { StreamCursor } from "./StreamCursor";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * `StreamingDocRenderer` 的对外 props。
 *
 * 与设计文档「关键接口」一节保持一致；新增 `specTree` 用于把 `nodeId` 映射
 * 到节点 `title`，让侧边栏展示节点中文标题而不是裸 UUID。
 */
export interface StreamingDocRendererProps {
  /** 当前 job 的 spec documents entries（已包含全部阶段，组件内部再过滤）。 */
  entries: AgentReasoningEntry[];
  /** 已完成的 SpecDocument 对象（用于静态展示已完成文档）。 */
  specDocuments?: BlueprintSpecDocument[];
  /** SPEC 树，用于将 `nodeId` 解析为节点中文标题。 */
  specTree?: BlueprintSpecTree | null;
  locale: AppLocale;
}

// ---------------------------------------------------------------------------
// 状态层：StreamingState + reducer
// ---------------------------------------------------------------------------

export interface StreamingDocState {
  rawMarkdown: string;
  parsedTokens: readonly unknown[];
  lastParsedLength: number;
  isStreaming: boolean;
}

interface StreamingDocsReducerState {
  documents: Record<string, StreamingDocState>;
  documentIds: readonly string[];
}

type StreamingDocsAction =
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

const EMPTY_DOC_STATE: StreamingDocState = {
  rawMarkdown: "",
  parsedTokens: [],
  lastParsedLength: 0,
  isStreaming: false,
};

const INITIAL_REDUCER_STATE: StreamingDocsReducerState = {
  documents: {},
  documentIds: [],
};

function appendChunkReducer(
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

function streamingDocsReducer(
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
const DEFAULT_DOCUMENT_ID = "default";

function pickString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length === 0) return undefined;
  return value;
}

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

export function pickDocumentId(entry: AgentReasoningEntry): string {
  const extended = entry as SpecDocumentEntry;
  return (
    pickString(extended.documentId) ??
    pickString(extended.payload?.documentId) ??
    DEFAULT_DOCUMENT_ID
  );
}

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
// 标签名派生
// ---------------------------------------------------------------------------

function deriveDocumentTitle(
  documentId: string,
  specDocuments: readonly BlueprintSpecDocument[] | undefined,
  locale: AppLocale
): string {
  const matched = specDocuments?.find(doc => doc.id === documentId);
  if (matched && typeof matched.title === "string" && matched.title.length > 0) {
    return matched.title;
  }
  if (documentId === DEFAULT_DOCUMENT_ID) {
    return locale === "zh-CN" ? "默认文档" : "Default Document";
  }
  return documentId;
}

// ---------------------------------------------------------------------------
// 节点分组
// ---------------------------------------------------------------------------

interface DocGroup {
  nodeId: string;
  nodeTitle: string;
  documents: BlueprintSpecDocument[];
}

const TYPE_ORDER: Record<BlueprintSpecDocumentType, number> = {
  requirements: 0,
  design: 1,
  tasks: 2,
};

/**
 * 把 specDocuments 按 nodeId 分组，并使用 specTree 把 nodeId 解析为节点
 * 中文标题。组内文档按 requirements → design → tasks 顺序排序。
 */
function groupDocumentsByNode(
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

interface TypeBadgeStyle {
  shortLabel: string;
  fullLabel: string;
  className: string;
}

function getTypeBadge(
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

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export const StreamingDocRenderer: FC<StreamingDocRendererProps> = ({
  entries,
  specDocuments,
  specTree,
  locale,
}) => {
  const isZh = locale === "zh-CN";

  // ── reducer ───────────────────────────────────────────────────────────
  const [state, dispatch] = useReducer(
    streamingDocsReducer,
    INITIAL_REDUCER_STATE
  );

  const dispatchedIdsRef = useRef<Set<string>>(new Set());

  // entries → reducer：把所有未处理过的 spec documents content entry 顺序
  // 追加到对应文档。
  useEffect(() => {
    const dispatched = dispatchedIdsRef.current;
    for (const entry of entries) {
      if (dispatched.has(entry.id)) continue;
      if (!isSpecDocumentContentEntry(entry)) {
        dispatched.add(entry.id);
        continue;
      }
      const documentId = pickDocumentId(entry);
      const chunk = pickChunk(entry);
      dispatched.add(entry.id);
      if (chunk.length === 0) continue;
      dispatch({ type: "append-chunk", documentId, chunk });
    }
  }, [entries]);

  // ── 节点分组（侧边栏数据源）─────────────────────────────────────────
  const nodeTitleByNodeId = useMemo(() => {
    const map = new Map<string, string>();
    if (specTree) {
      for (const node of specTree.nodes) {
        map.set(node.id, node.title);
      }
    }
    return map;
  }, [specTree]);

  const groupedDocs = useMemo(() => {
    if (!specDocuments || specDocuments.length === 0) return [];
    return groupDocumentsByNode(specDocuments, nodeTitleByNodeId);
  }, [specDocuments, nodeTitleByNodeId]);

  /** documentId → 完整 doc 对象的快速查询表。 */
  const docById = useMemo(() => {
    const map = new Map<string, BlueprintSpecDocument>();
    if (specDocuments) {
      for (const doc of specDocuments) {
        map.set(doc.id, doc);
      }
    }
    return map;
  }, [specDocuments]);

  /** 实时生成中但尚未落库为 SpecDocument 的文档 id（例如 "default"）。 */
  const streamingOnlyIds = useMemo(() => {
    return state.documentIds.filter(id => !docById.has(id));
  }, [state.documentIds, docById]);

  // ── 搜索 + 折叠状态 ─────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  /** 搜索过滤后的分组列表。搜索匹配节点标题、文档标题或类型字符串。 */
  const filteredGroups = useMemo(() => {
    if (searchQuery.trim().length === 0) return groupedDocs;
    const q = searchQuery.trim().toLowerCase();
    const result: DocGroup[] = [];
    for (const group of groupedDocs) {
      const nodeTitleMatched = group.nodeTitle.toLowerCase().includes(q);
      const matchedDocs = nodeTitleMatched
        ? group.documents
        : group.documents.filter(
            doc =>
              doc.title.toLowerCase().includes(q) ||
              doc.type.toLowerCase().includes(q)
          );
      if (matchedDocs.length > 0) {
        result.push({
          ...group,
          documents: matchedDocs,
        });
      }
    }
    return result;
  }, [groupedDocs, searchQuery]);

  /** 搜索时自动展开所有匹配的分组；非搜索状态下用用户手动展开的集合，
   *  并兜底展开第一个分组（如果用户尚未手动操作）以让 IA 在首次渲染
   *  / SSR 渲染时立刻可见，不依赖 useEffect。 */
  const effectiveExpandedIds = useMemo<ReadonlySet<string>>(() => {
    if (searchQuery.trim().length > 0) {
      return new Set(filteredGroups.map(g => g.nodeId));
    }
    if (expandedNodeIds.size > 0) {
      return expandedNodeIds;
    }
    if (groupedDocs.length > 0) {
      const firstGroup = groupedDocs[0];
      if (firstGroup) {
        return new Set([firstGroup.nodeId]);
      }
    }
    return expandedNodeIds;
  }, [searchQuery, filteredGroups, expandedNodeIds, groupedDocs]);

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // ── active doc id ──────────────────────────────────────────────────
  const allDocIds = useMemo<readonly string[]>(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    // 1. 实时生成中的 default doc 等放最前
    for (const id of streamingOnlyIds) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    // 2. 已落库的 SpecDocuments 按节点分组顺序
    for (const group of groupedDocs) {
      for (const doc of group.documents) {
        if (!seen.has(doc.id)) {
          seen.add(doc.id);
          order.push(doc.id);
        }
      }
    }
    return order;
  }, [streamingOnlyIds, groupedDocs]);

  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  useEffect(() => {
    if (activeDocId === null && allDocIds.length > 0) {
      setActiveDocId(allDocIds[0] ?? null);
      return;
    }
    if (
      activeDocId !== null &&
      allDocIds.length > 0 &&
      !allDocIds.includes(activeDocId)
    ) {
      setActiveDocId(allDocIds[0] ?? null);
    }
  }, [activeDocId, allDocIds]);

  /** 当 active doc 落在某个分组内但该分组未展开时，自动展开它。 */
  useEffect(() => {
    if (activeDocId === null) return;
    const doc = docById.get(activeDocId);
    if (!doc) return;
    setExpandedNodeIds(prev => {
      if (prev.has(doc.nodeId)) return prev;
      const next = new Set(prev);
      next.add(doc.nodeId);
      return next;
    });
  }, [activeDocId, docById]);

  // ── 滚动位置维护 ───────────────────────────────────────────────────
  const [scrollPositions, setScrollPositions] = useState<
    Readonly<Record<string, number>>
  >({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRef = useRef<string | null>(null);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const top = target.scrollTop;
      if (activeDocId === null) return;
      setScrollPositions(prev => {
        if (prev[activeDocId] === top) return prev;
        return { ...prev, [activeDocId]: top };
      });
    },
    [activeDocId]
  );

  useLayoutEffect(() => {
    if (activeDocId === null) return;
    if (pendingRestoreRef.current !== activeDocId) {
      pendingRestoreRef.current = activeDocId;
      const target = scrollPositions[activeDocId] ?? 0;
      const node = scrollRef.current;
      if (node) {
        node.scrollTop = target;
      }
    }
  }, [activeDocId, scrollPositions]);

  /** 切换文档：先 snapshot 当前滚动位置再切，避免 onScroll 节流尾帧丢失。 */
  const handleSelectDoc = useCallback(
    (docId: string) => {
      if (docId === activeDocId) return;
      const node = scrollRef.current;
      if (node && activeDocId !== null) {
        const top = node.scrollTop;
        setScrollPositions(prev => {
          if (prev[activeDocId] === top) return prev;
          return { ...prev, [activeDocId]: top };
        });
      }
      pendingRestoreRef.current = null;
      setActiveDocId(docId);
    },
    [activeDocId]
  );

  // ── 当前 active 文档元数据 ────────────────────────────────────────
  const activeDocState = useMemo<StreamingDocState>(() => {
    if (activeDocId === null) return EMPTY_DOC_STATE;
    return state.documents[activeDocId] ?? EMPTY_DOC_STATE;
  }, [activeDocId, state.documents]);

  /**
   * 渲染时实际使用的 markdown：优先用流式累积的 rawMarkdown，没有时
   * 退回到稳定 `BlueprintSpecDocument.content`。这样：
   * - 流式生成中的文档实时显示 chunk 累积
   * - 已落库（生成完成）的文档点击侧边栏后立即回显完整 content
   * - 切换文档不会出现"等待文档生成…"卡死状态
   */
  const renderedMarkdown = useMemo<string>(() => {
    if (activeDocState.rawMarkdown.length > 0) {
      return activeDocState.rawMarkdown;
    }
    if (activeDocId === null) return "";
    const doc = docById.get(activeDocId);
    return typeof doc?.content === "string" ? doc.content : "";
  }, [activeDocState.rawMarkdown, activeDocId, docById]);

  interface ActiveDocMeta {
    id: string;
    title: string;
    type: BlueprintSpecDocumentType | undefined;
    nodeTitle: string | undefined;
    isStreaming: boolean;
  }

  const activeDocMeta = useMemo<ActiveDocMeta | null>(() => {
    if (activeDocId === null) return null;
    const doc = docById.get(activeDocId);
    const isStreaming =
      state.documents[activeDocId]?.isStreaming ?? false;
    if (doc) {
      return {
        id: doc.id,
        title: doc.title,
        type: doc.type,
        nodeTitle: nodeTitleByNodeId.get(doc.nodeId),
        isStreaming,
      };
    }
    return {
      id: activeDocId,
      title: deriveDocumentTitle(activeDocId, specDocuments, locale),
      type: undefined,
      nodeTitle: undefined,
      isStreaming,
    };
  }, [
    activeDocId,
    docById,
    nodeTitleByNodeId,
    specDocuments,
    locale,
    state.documents,
  ]);

  const isEmpty = activeDocId === null || renderedMarkdown.length === 0;
  const emptyHint = isZh ? "等待文档生成…" : "Waiting for document…";
  const ariaLabel = isZh ? "流式文档渲染区" : "Streaming document area";

  // ── 渲染 ────────────────────────────────────────────────────────────
  return (
    <div
      className="flex h-full min-h-0 overflow-hidden rounded-lg bg-slate-50"
      data-testid="streaming-doc-renderer"
      role="region"
      aria-label={ariaLabel}
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      {/* 左侧：节点折叠树 + 搜索 */}
      <aside
        className="flex flex-col border-r border-slate-200 bg-white"
        data-testid="streaming-doc-sidebar"
        style={{
          width: "200px",
          minWidth: "200px",
          maxWidth: "200px",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        {/* 搜索框 */}
        <div className="border-b border-slate-100 p-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={isZh ? "搜索文档…" : "Search docs…"}
            className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] outline-none transition focus:border-indigo-300 focus:bg-white"
            data-testid="streaming-doc-sidebar-search"
            aria-label={isZh ? "搜索文档" : "Search documents"}
          />
        </div>

        {/* 滚动列表 */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden"
          data-testid="streaming-doc-sidebar-list"
          style={{ minHeight: 0 }}
        >
          {/* 实时生成中的文档（无 artifact） */}
          {streamingOnlyIds.length > 0 && (
            <div
              className="border-b border-slate-100 py-1"
              data-testid="streaming-doc-sidebar-streaming-section"
            >
              <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-slate-400">
                {isZh ? "实时生成" : "Live"}
              </div>
              {streamingOnlyIds.map(id => {
                const isActive = id === activeDocId;
                const isStreaming =
                  state.documents[id]?.isStreaming ?? false;
                const title = deriveDocumentTitle(
                  id,
                  specDocuments,
                  locale
                );
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectDoc(id)}
                    className={cn(
                      "flex w-full items-center gap-1.5 border-l-2 py-1 pl-2 pr-2 text-left text-[10px] transition",
                      isActive
                        ? "border-indigo-500 bg-indigo-50 text-indigo-900"
                        : "border-transparent text-slate-600 hover:bg-slate-50"
                    )}
                    data-testid={`streaming-doc-sidebar-streaming-${id}`}
                    data-active={isActive ? "true" : "false"}
                    title={title}
                  >
                    {isStreaming && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-400"
                        aria-label="streaming"
                      />
                    )}
                    <span
                      className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                      style={{ minWidth: 0 }}
                    >
                      {title}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 节点分组列表 */}
          {filteredGroups.length === 0 && streamingOnlyIds.length === 0 ? (
            <div className="px-3 py-6 text-center text-[10px] text-slate-400">
              {searchQuery.trim().length > 0
                ? isZh
                  ? "无匹配文档"
                  : "No matching docs"
                : isZh
                  ? "等待文档生成…"
                  : "Waiting for documents…"}
            </div>
          ) : (
            filteredGroups.map(group => {
              const isExpanded = effectiveExpandedIds.has(group.nodeId);
              const hasActive = group.documents.some(
                d => d.id === activeDocId
              );
              const hasStreaming = group.documents.some(
                d => state.documents[d.id]?.isStreaming
              );
              return (
                <div
                  key={group.nodeId}
                  className="border-b border-slate-100 last:border-b-0"
                  data-testid={`streaming-doc-sidebar-group-${group.nodeId}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleNode(group.nodeId)}
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition",
                      hasActive ? "bg-slate-50" : "hover:bg-slate-50"
                    )}
                    data-testid={`streaming-doc-sidebar-group-toggle-${group.nodeId}`}
                    aria-expanded={isExpanded}
                    title={group.nodeTitle}
                  >
                    <span
                      className="w-2 shrink-0 text-center font-mono text-[9px] text-slate-400"
                      aria-hidden="true"
                    >
                      {isExpanded ? "▼" : "▶"}
                    </span>
                    <span
                      className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-semibold text-slate-700"
                      style={{ minWidth: 0 }}
                    >
                      {group.nodeTitle}
                    </span>
                    {hasStreaming && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-400"
                        aria-label="streaming"
                      />
                    )}
                    <span className="shrink-0 font-mono text-[9px] text-slate-400">
                      {group.documents.length}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="pb-1">
                      {group.documents.map(doc => {
                        const isActive = doc.id === activeDocId;
                        const isStreaming =
                          state.documents[doc.id]?.isStreaming ?? false;
                        const badge = getTypeBadge(doc.type, locale);
                        return (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => handleSelectDoc(doc.id)}
                            className={cn(
                              "flex w-full items-center gap-1.5 border-l-2 py-1 pl-5 pr-2 text-left transition",
                              isActive
                                ? "border-indigo-500 bg-indigo-50 text-indigo-900"
                                : "border-transparent text-slate-600 hover:bg-slate-50"
                            )}
                            data-testid={`streaming-doc-sidebar-doc-${doc.id}`}
                            data-active={isActive ? "true" : "false"}
                            data-streaming={isStreaming ? "true" : "false"}
                            title={`${badge.fullLabel}: ${doc.title}`}
                          >
                            <span
                              className={cn(
                                "shrink-0 rounded px-1 py-0 text-[9px] font-bold",
                                badge.className
                              )}
                              aria-label={badge.fullLabel}
                            >
                              {badge.shortLabel}
                            </span>
                            <span
                              className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[10px]"
                              style={{ minWidth: 0 }}
                            >
                              {doc.title}
                            </span>
                            {isStreaming && (
                              <span
                                className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-400"
                                aria-label="streaming"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* 右侧：文档主区 */}
      <main
        className="flex flex-1 flex-col bg-slate-50"
        data-testid="streaming-doc-main"
        style={{
          minWidth: 0,
          maxWidth: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* 头部：当前文档标题 + 类型徽章 + 流式状态 */}
        {activeDocMeta && (
          <header
            className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2"
            data-testid="streaming-doc-main-header"
            style={{ minWidth: 0 }}
          >
            {activeDocMeta.type && (
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                  getTypeBadge(activeDocMeta.type, locale).className
                )}
              >
                {getTypeBadge(activeDocMeta.type, locale).fullLabel}
              </span>
            )}
            <div
              className="flex flex-1 items-center gap-1.5 overflow-hidden"
              style={{ minWidth: 0 }}
            >
              {activeDocMeta.nodeTitle && (
                <>
                  <span
                    className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-slate-400"
                    title={activeDocMeta.nodeTitle}
                  >
                    {activeDocMeta.nodeTitle}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-300">
                    /
                  </span>
                </>
              )}
              <h3
                className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-slate-800"
                title={activeDocMeta.title}
                style={{ minWidth: 0 }}
              >
                {activeDocMeta.title}
              </h3>
            </div>
            {activeDocMeta.isStreaming && (
              <span
                className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-blue-600"
                aria-label={isZh ? "生成中" : "Streaming"}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                {isZh ? "生成中" : "Streaming"}
              </span>
            )}
          </header>
        )}

        {/* 滚动容器：markdown 主区 */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-y-auto overflow-x-hidden"
          data-testid="streaming-doc-scroll"
          data-active-doc-id={activeDocId ?? ""}
          data-scroll-position={
            activeDocId !== null ? scrollPositions[activeDocId] ?? 0 : 0
          }
          onScroll={handleScroll}
          style={{
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
          }}
        >
          {isEmpty ? (
            <div
              className="flex h-full items-center justify-center px-4 text-xs text-slate-500"
              data-testid="streaming-doc-empty"
            >
              {emptyHint}
            </div>
          ) : (
            <div
              className="px-4 py-4 text-xs leading-relaxed text-slate-700"
              data-testid="streaming-doc-body"
              data-streaming-doc-body
              data-is-streaming={
                activeDocState.isStreaming ? "true" : "false"
              }
              data-raw-length={renderedMarkdown.length}
              style={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
            >
              <MarkdownRenderer
                markdown={renderedMarkdown}
                isStreaming={activeDocState.isStreaming}
                locale={locale}
              />
              <StreamCursor visible={activeDocState.isStreaming} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default StreamingDocRenderer;

/**
 * 仅供测试导入；正常代码路径不应直接调这些纯函数。
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
