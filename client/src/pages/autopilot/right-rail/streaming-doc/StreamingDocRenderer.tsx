/**
 * `autopilot-streaming-doc-renderer` — Wave 0 / Task 1.1 + 1.2 +
 * Wave 1 / Task 2.1, 2.3, 3.1, 3.2
 *
 * 流式文档渲染主容器。
 *
 * 该组件消费来自 `useBlueprintRealtimeStore.agentReasoning.entries` 中阶段
 * 为 `spec_documents`、内容类型为 `content` 的增量片段，将其按 `documentId`
 * 分组，维护多文档状态，并把当前活跃文档的 Markdown 字符串交给
 * `MarkdownRenderer` 进行格式化展示，尾部叠加 `StreamCursor` 闪烁光标。
 *
 * 关键边界：
 * - 只读消费 entries，不写 store，不直接订阅 socket。
 * - 不引入 `@testing-library/react`，所有验证依赖纯函数 + SSR 渲染。
 * - 不扩大 TS 基线 116 errors：所有字段读取走显式 narrow，禁止使用 `any`。
 * - 右栏背景为白色，需要使用浅色主题（`bg-slate-50 / text-slate-700`），
 *   不允许出现 `bg-white/5 / text-white/*` 等深色毛玻璃语义（详见 design.md
 *   样式方案的浅色翻译）。
 *
 * 与 `MarkdownRenderer` / `StreamCursor` 的协作：
 * - 当前 active 文档的 `rawMarkdown` 直接交给 `MarkdownRenderer`，由其
 *   完成 token 切分与 React 渲染；
 * - `StreamCursor` 仅在该文档 `isStreaming === true` 时渲染，承担"光标
 *   仅在末尾闪烁"的视觉职责，与 Markdown block 解耦。
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
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type { BlueprintSpecDocument } from "@shared/blueprint/contracts";

import { MarkdownRenderer, extractHeadings } from "./MarkdownRenderer";
import { StreamCursor } from "./StreamCursor";
import { DocOutline } from "./DocOutline";
import { DocTabBar, type DocTabBarItem } from "./DocTabBar";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * `StreamingDocRenderer` 的对外 props。
 *
 * 与设计文档「关键接口」一节保持一致；`specDocuments` 是 socket 推送结束后
 * 已落库的稳定文档列表，用于在流式生成结束后回填完整 Markdown。
 */
export interface StreamingDocRendererProps {
  /** 当前 job 的 spec documents entries（已包含全部阶段，组件内部再过滤）。 */
  entries: AgentReasoningEntry[];
  /** 已完成的 SpecDocument 对象（用于静态展示已完成文档）。 */
  specDocuments?: BlueprintSpecDocument[];
  locale: AppLocale;
}

// ---------------------------------------------------------------------------
// 状态层：StreamingState + reducer
// ---------------------------------------------------------------------------

/**
 * 单个文档的流式渲染状态。
 *
 * - `rawMarkdown`：累积的完整 Markdown 字符串，每次新 chunk 拼接到末尾。
 * - `parsedTokens`：Task 2.1 的 token 缓存位，当前先用空数组占位。
 * - `lastParsedLength`：上次解析到的字符位置，用于 Task 2.1 做 token-level
 *   增量解析；当前与 `rawMarkdown.length` 同步，但保留独立字段避免 2.1
 *   再次扩字段时造成结构变更。
 */
export interface StreamingDocState {
  rawMarkdown: string;
  parsedTokens: readonly unknown[];
  lastParsedLength: number;
  isStreaming: boolean;
}

interface StreamingDocsReducerState {
  /** documentId → 单文档状态。使用 Record 而非 Map 以便受控比较与 SSR。 */
  documents: Record<string, StreamingDocState>;
  /** 已知文档顺序，用于 DocTabBar 顺序稳定。 */
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

/**
 * 仅追加：把 chunk 拼接到指定文档末尾，保证幂等的字符串累积语义。
 *
 * 当 `chunk` 为空字符串时跳过状态更新，避免触发不必要的 re-render；
 * 当文档此前不存在时，自动注册到 `documentIds` 末尾。
 */
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

/**
 * `AgentReasoningEntry` 上 spec documents 流式 chunk 的扩展形态。
 *
 * 设计文档原文：`filter(e => e.stage === 'spec_documents' && e.type === 'content')
 * → groupBy documentId`。当前 `AgentReasoningEntry` 顶层并没有 `stage` /
 * `type` / `documentId` / `chunk` 字段（参见 `shared/blueprint/agent-reasoning.ts`），
 * 但服务端 emitter 在 stage_id = `spec_documents` 时会通过 payload 透传这些
 * 语义字段。我们使用 intersection 类型只读地 narrow，向后兼容上游字段尚未
 * 落地的时间窗口（task 2.1 会真正消费 `chunk`，此处先留出 hook）。
 */
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

/**
 * 判断条目是否属于 spec documents 阶段的 content chunk。
 *
 * 兼容三种来源：
 * 1. 顶层 `entry.stage === 'spec_documents'` 与 `entry.type === 'content'`
 *    （设计文档原口径）。
 * 2. 顶层 `entry.stageId === 'spec_documents'`（`AgentReasoningEntry` 实际
 *    字段名，由 `agent-reasoning-bridge` 翻译时映射）。
 * 3. `entry.payload.stage === 'spec_documents'` & `payload.type === 'content'`
 *    （`stage-progress-emitter` 直发事件的常见 payload 形态）。
 *
 * 兼容历史 stage 名 `spec_docs`（参见 `parse-spec-docs-observing.ts`）。
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
    pickString(extended.type) ??
    pickString(extended.payload?.type);
  // 当上游尚未补 `type` 字段时（兼容窗口），保留向前兼容：只要 stage 命中
  // spec documents 即视为可投递；Task 2.1 会进一步收口为严格 `content`。
  if (type !== undefined && type !== CONTENT_TYPE) {
    return false;
  }
  return true;
}

/**
 * 从 entry 中提取 documentId；缺失时退化为 `DEFAULT_DOCUMENT_ID`，与设计
 * 文档「filter ... groupBy(e => e.documentId || 'default')」保持一致。
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
 * 从 entry 中提取本次 chunk 文本；当 entry 没有携带 `chunk` 时退回
 * `observationSummary` / `thought`，保证流式骨架在 Task 2.1 落地前不至于
 * 完全空白（仅作为占位，UI 将在 Task 2.1 替换为真正的 Markdown 渲染）。
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
// 标签名派生
// ---------------------------------------------------------------------------

function deriveDocumentTitle(
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

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 流式文档渲染主容器。
 *
 * 对应 spec：`.kiro/specs/autopilot-streaming-doc-renderer/`
 * - 需求 1.1：DocMainArea 占据 StageViewport 主区
 * - 需求 1.5：空态居中提示
 * - 需求 2.1：增量追加新 chunk
 * - 需求 4.1：多份 SpecDocument 时展示文档标签栏（占位 div，Task 5.1 落地）
 */
export const StreamingDocRenderer: FC<StreamingDocRendererProps> = ({
  entries,
  specDocuments,
  locale,
}) => {
  const [state, dispatch] = useReducer(
    streamingDocsReducer,
    INITIAL_REDUCER_STATE
  );

  // 已经分发到 reducer 的 entry 索引，避免 entries 被刷新时重复追加。
  const dispatchedIdsRef = useRef<Set<string>>(new Set());

  // entries → reducer：把所有未处理过的 spec documents content entry 顺序
  // 追加到对应文档。Task 2.1 之后会把这一步替换为更细粒度的 token 解析。
  useEffect(() => {
    const dispatched = dispatchedIdsRef.current;
    for (const entry of entries) {
      if (dispatched.has(entry.id)) continue;
      if (!isSpecDocumentContentEntry(entry)) {
        // 即使不命中 spec documents 阶段，也标记为已处理，避免下次循环再扫一次。
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

  // 已知 documentId 列表：reducer 中的活跃文档 + specDocuments 中已落库的文档。
  const documentIds = useMemo<readonly string[]>(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const id of state.documentIds) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    if (specDocuments) {
      for (const doc of specDocuments) {
        if (!seen.has(doc.id)) {
          seen.add(doc.id);
          order.push(doc.id);
        }
      }
    }
    return order;
  }, [state.documentIds, specDocuments]);

  // 默认 activeDocId：第一个已知文档；首次出现新文档时自动 follow。
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  useEffect(() => {
    if (activeDocId === null && documentIds.length > 0) {
      setActiveDocId(documentIds[0] ?? null);
      return;
    }
    if (
      activeDocId !== null &&
      documentIds.length > 0 &&
      !documentIds.includes(activeDocId)
    ) {
      setActiveDocId(documentIds[0] ?? null);
    }
  }, [activeDocId, documentIds]);

  // documentId → 已记录的滚动位置，切换标签时恢复（Task 5.1 真正落地，
  // 当前先把状态层做出来，给后续 DocTabBar 对接预留容器）。
  const [scrollPositions, setScrollPositions] = useState<
    Readonly<Record<string, number>>
  >({});

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const top = target.scrollTop;
      if (activeDocId === null) return;
      setScrollPositions((prev) => {
        if (prev[activeDocId] === top) return prev;
        return { ...prev, [activeDocId]: top };
      });
    },
    [activeDocId]
  );

  const activeDocState = useMemo<StreamingDocState>(() => {
    if (activeDocId === null) return EMPTY_DOC_STATE;
    return state.documents[activeDocId] ?? EMPTY_DOC_STATE;
  }, [activeDocId, state.documents]);

  // 当前活跃文档的 h1-h3 标题列表，供 DocOutline 渲染。流式过程中每次新
  // chunk 进来，`rawMarkdown` 变化都会触发重算；headings 长度 < 2 时
  // DocOutline 内部直接返回 null，此处不再做额外条件判断。
  const headings = useMemo(
    () => extractHeadings(activeDocState.rawMarkdown),
    [activeDocState.rawMarkdown]
  );

  // 滚动容器 ref：DocTabBar 切换 tab 后需要把滚动位置恢复到上次记录的
  // `scrollPositions[activeDocId]`；DocOutline 点击标题时也通过该 ref
  // 找到对应 heading 元素并平滑滚动。
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 记录"刚切到这个 docId 时还没恢复滚动位置"，用 ref 而不是 state
  // 避免 set 后再次触发 render；useLayoutEffect 在 DOM 更新后立即同步
  // 还原 scrollTop，避免出现一帧的视觉跳动。
  const pendingRestoreRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (activeDocId === null) return;
    // 仅在 activeDocId 切换或 pendingRestoreRef 命中时执行恢复，避免与
    // `handleScroll` 的 setScrollPositions 形成竞争。
    if (pendingRestoreRef.current !== activeDocId) {
      pendingRestoreRef.current = activeDocId;
      const target = scrollPositions[activeDocId] ?? 0;
      const node = scrollRef.current;
      if (node) {
        node.scrollTop = target;
      }
    }
  }, [activeDocId, scrollPositions]);

  // 切换 tab：先记录"切走前"的滚动位置（由 handleScroll 持续维护），
  // 再更新 activeDocId；下一次 useLayoutEffect 会把新 doc 的 scrollTop
  // 还原到 `scrollPositions[newId]`。
  const handleTabClick = useCallback(
    (docId: string) => {
      if (docId === activeDocId) return;
      // 在切换前主动 snapshot 当前滚动位置，覆盖 onScroll 节流的最后一帧
      // 可能尚未提交的情况。
      const node = scrollRef.current;
      if (node && activeDocId !== null) {
        const top = node.scrollTop;
        setScrollPositions((prev) => {
          if (prev[activeDocId] === top) return prev;
          return { ...prev, [activeDocId]: top };
        });
      }
      pendingRestoreRef.current = null;
      setActiveDocId(docId);
    },
    [activeDocId]
  );

  // DocOutline 点击：用稳定 id（与 MarkdownRenderer 的 `buildHeadingId`
  // 保持一致）在当前 scrollRef 子树里找到 heading 节点，平滑滚动到该
  // 位置。若节点暂未渲染（极端情况下 token 还未提交），降级为不做。
  const handleHeadingClick = useCallback((headingId: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`#${CSS.escape(headingId)}`);
    if (!target) return;
    // 使用 `scrollIntoView({ behavior: "smooth", block: "start" })` 而不是
    // 计算 offsetTop，避免在内部布局存在 padding/transform 时定位偏差。
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const isEmpty = activeDocId === null || activeDocState.rawMarkdown.length === 0;
  const emptyHint = locale === "zh-CN" ? "等待文档生成…" : "Waiting for document…";

  const ariaLabel =
    locale === "zh-CN" ? "流式文档渲染区" : "Streaming document area";

  // Task 5.1：多文档时使用 DocTabBar，单文档时省略标签栏。
  const showTabs = documentIds.length > 1;
  const tabItems = useMemo<readonly DocTabBarItem[]>(() => {
    if (!showTabs) return [];
    return documentIds.map((id) => {
      const docState = state.documents[id] ?? EMPTY_DOC_STATE;
      return {
        id,
        title: deriveDocumentTitle(id, specDocuments, locale),
        isStreaming: docState.isStreaming,
      };
    });
  }, [showTabs, documentIds, state.documents, specDocuments, locale]);

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col rounded-lg bg-slate-50"
      data-testid="streaming-doc-renderer"
      role="region"
      aria-label={ariaLabel}
    >
      {showTabs ? (
        <DocTabBar
          documents={tabItems}
          activeDocId={activeDocId}
          onTabClick={handleTabClick}
        />
      ) : null}

      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-y-auto"
        data-testid="streaming-doc-scroll"
        data-active-doc-id={activeDocId ?? ""}
        data-scroll-position={
          activeDocId !== null ? scrollPositions[activeDocId] ?? 0 : 0
        }
        onScroll={handleScroll}
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
            className="mx-auto flex max-w-prose gap-4 px-4 py-4 text-xs leading-relaxed text-slate-700"
            data-testid="streaming-doc-body"
            data-streaming-doc-body
            data-is-streaming={activeDocState.isStreaming ? "true" : "false"}
            data-raw-length={activeDocState.rawMarkdown.length}
          >
            <div className="min-w-0 flex-1">
              {/*
                Task 2.1 已落地：使用 MarkdownRenderer 把累积 rawMarkdown 渲染
                为格式化 HTML；尾部叠加 StreamCursor，让用户在流式过程中看到
                闪烁光标。当 isStreaming=false 时 StreamCursor 自动返回 null。
              */}
              <MarkdownRenderer
                markdown={activeDocState.rawMarkdown}
                isStreaming={activeDocState.isStreaming}
                locale={locale}
              />
              <StreamCursor visible={activeDocState.isStreaming} />
            </div>
            {/*
              Task 4.1：DocOutline 仅在 ≥2 个 h1-h3 标题时渲染（组件内部
              判断）；单文档无标题或只有 1 个标题时占位 aside 不出现，避免
              横向占用宽度。aside 使用 sticky 让大纲在长文档中一直可见。
            */}
            {headings.length >= 2 ? (
              <aside
                className="sticky top-0 hidden w-32 shrink-0 self-start md:block"
                data-testid="streaming-doc-outline-aside"
              >
                <DocOutline
                  headings={headings}
                  onHeadingClick={handleHeadingClick}
                />
              </aside>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default StreamingDocRenderer;

/**
 * 仅供测试导入；正常代码路径不应直接调这些纯函数。
 *
 * Task 7.x 的 SSR / 增量渲染测试需要直接驱动 reducer 与字段提取函数，
 * 这里以 `__testing__` 命名空间暴露最小集合，避免污染公共 API。
 */
export const __testing__ = {
  streamingDocsReducer,
  appendChunkReducer,
  isSpecDocumentContentEntry,
  pickDocumentId,
  pickChunk,
  deriveDocumentTitle,
  INITIAL_REDUCER_STATE,
  EMPTY_DOC_STATE,
};
