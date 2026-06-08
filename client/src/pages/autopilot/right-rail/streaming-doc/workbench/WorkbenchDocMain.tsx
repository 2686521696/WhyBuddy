/**
 * `autopilot-spec-documents-workbench-v2` — 中间文档主区组件。
 *
 * Phase 1 / Task 4：
 * - 顶部渲染 DocType chip（`data-testid="autopilot-workbench-doc-type-chip"`）
 *   与文档标题（`data-testid="autopilot-workbench-doc-title"`）。
 * - 渲染"展开文档"按钮（`data-testid="autopilot-workbench-doc-expand"`），
 *   点击切换内部 `expanded` 状态，并通过 `aria-pressed` 反映状态。
 * - 通过现有 `<MarkdownRenderer>` 渲染 Markdown 正文；保留
 *   `<StreamCursor visible={isStreaming} />`。
 * - 沿用旧实现的滚动位置缓存与 `activeDoc` 切换路径。
 *
 * 设计要点：
 * - 拆分为 hooks-free `WorkbenchDocMainView`（exported，便于 SSR 测试）
 *   与有状态 wrapper `WorkbenchDocMain`（管理 `expanded` + scroll ref）。
 * - 外层 `<section data-testid="autopilot-workbench-doc-main">` 保持
 *   Phase 1 骨架契约不变。
 * - 不修改 `MarkdownRenderer` / `StreamCursor` / streaming reducer /
 *   `getTypeBadge` 签名（Non-Goals 1-4）。
 * - 不引入新的 npm 运行时依赖（R6.2）。
 * - 中文 JSDoc；英文 `data-testid` / prop 名（R6.3 / R6.4）。
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import type { AppLocale } from "@/lib/locale";
import { StaleBadge } from "@/pages/autopilot/stage-edit";
import type {
  BlueprintGenerationArtifact,
  BlueprintSpecDocumentType,
} from "@shared/blueprint/contracts";

import { MarkdownRenderer } from "../MarkdownRenderer";
import { StreamCursor } from "../StreamCursor";
import { getTypeBadge } from "../streaming-state";
import type { ChapterChecklistItem } from "./derive-chapter-checklist";
import type { RelatedRef } from "./derive-related-refs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 当前活跃文档的元数据，由容器层派生后透传。
 */
export interface ActiveDocMeta {
  id: string;
  title: string;
  type: BlueprintSpecDocumentType | undefined;
  nodeTitle: string | undefined;
  isStreaming: boolean;
}

export type WorkbenchStaleArtifactState = {
  staleSince?: string | null;
  invalidatedBy?: BlueprintGenerationArtifact["invalidatedBy"] | null;
};

/**
 * `WorkbenchDocMain` 对外 props。
 *
 * 容器层（`AutopilotSpecDocumentsWorkbench`）负责持有 streaming reducer、
 * 派生 `renderedMarkdown` 与 `activeDocMeta`，并通过本 props 透传。
 */
export interface WorkbenchDocMainProps {
  activeDoc: ActiveDocMeta | null;
  renderedMarkdown: string;
  isStreaming: boolean;
  scrollTop: number;
  onScroll: (scrollTop: number) => void;
  /** 章节清单，由容器层 `deriveChapterChecklist` 派生。 */
  chapterChecklist: ChapterChecklistItem[];
  /** 关联文档引用，由容器层 `deriveRelatedRefs` 派生。 */
  relatedRefs: RelatedRef[];
  /** AI 摘要：优先取 `BlueprintSpecDocument.summary`，缺失时为 null。 */
  aiSummary: string | null;
  staleArtifact?: WorkbenchStaleArtifactState | null;
  /** 切换文档回调，复用与左侧 Spec 树相同的切换路径。 */
  onSelectDocument: (docId: string) => void;
  /** 可选受控展开态；容器保留四区不卸载，仅调整文档阅读密度。 */
  expanded?: boolean;
  /** 展开态变化回调。 */
  onExpandedChange?: (expanded: boolean) => void;
  locale: AppLocale;
}

// ---------------------------------------------------------------------------
// View（hooks-free，便于 SSR 测试）
// ---------------------------------------------------------------------------

/**
 * `WorkbenchDocMainView` 的 props。
 *
 * 与 `WorkbenchDocMainProps` 相比，额外接收 `expanded` / `onToggleExpand`
 * 以及 `scrollRef`，由有状态 wrapper 注入。
 */
export interface WorkbenchDocMainViewProps {
  activeDoc: ActiveDocMeta | null;
  renderedMarkdown: string;
  isStreaming: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScrollCapture?: (e: React.UIEvent<HTMLDivElement>) => void;
  /** 章节清单，由容器层 `deriveChapterChecklist` 派生。 */
  chapterChecklist: ChapterChecklistItem[];
  /** 关联文档引用，由容器层 `deriveRelatedRefs` 派生。 */
  relatedRefs: RelatedRef[];
  /** AI 摘要：优先取 `BlueprintSpecDocument.summary`，缺失时为 null。 */
  aiSummary: string | null;
  staleArtifact?: WorkbenchStaleArtifactState | null;
  /** 切换文档回调，复用与左侧 Spec 树相同的切换路径。 */
  onSelectDocument: (docId: string) => void;
  locale: AppLocale;
}

/**
 * 中间文档主区纯展示组件（无 hooks）。
 *
 * 渲染结构：
 * - 头部行：DocType chip + 文档标题 + streaming pill + 展开按钮
 * - 正文：MarkdownRenderer + StreamCursor
 * - 空态：当 `activeDoc === null` 或 `renderedMarkdown === ""` 时显示提示
 *
 * 外层 `<section data-testid="autopilot-workbench-doc-main">` 始终存在。
 * 当 `expanded` 为 true 时，附加 `data-expanded="true"`。
 */
export const WorkbenchDocMainView: FC<WorkbenchDocMainViewProps> = ({
  activeDoc,
  renderedMarkdown,
  isStreaming,
  expanded,
  onToggleExpand,
  scrollRef,
  onScrollCapture,
  chapterChecklist,
  aiSummary,
  staleArtifact,
  locale,
}) => {
  const isZh = locale === "zh-CN";

  // 空态判定
  const isEmpty = activeDoc === null || (!renderedMarkdown && !isStreaming);

  // 是否渲染下方三个区块（仅在有文档且有内容时渲染）
  const showExtras = !isEmpty && renderedMarkdown.length > 0;
  const ExpandIcon = expanded ? Minimize2 : Maximize2;

  return (
    <section
      data-testid="autopilot-workbench-doc-main"
      data-expanded={expanded ? "true" : undefined}
      role="region"
      aria-label="autopilot workbench doc main"
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: 0,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* 头部行 */}
      <header
        className="flex shrink-0 items-center gap-1.5 border-b border-slate-200 bg-slate-50/80 px-2.5 py-1.5"
        style={{
          minWidth: 0,
        }}
      >
        {activeDoc?.type && (
          <span
            data-testid="autopilot-workbench-doc-type-chip"
            className={getTypeBadge(activeDoc.type, locale).className}
            style={{
              fontSize: "11px",
              padding: "1px 6px",
              borderRadius: "4px",
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {getTypeBadge(activeDoc.type, locale).fullLabel}
          </span>
        )}

        <span
          data-testid="autopilot-workbench-doc-title"
            style={{
              flex: 1,
              fontSize: "14px",
              fontWeight: 600,
              color: "#0f172a",
              overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {activeDoc?.title ?? (isZh ? "未选择文档" : "No document selected")}
        </span>

        <StaleBadge
          staleSince={staleArtifact?.staleSince}
          invalidatedBy={staleArtifact?.invalidatedBy}
          locale={locale}
        />

        {isStreaming && (
          <span
            data-testid="autopilot-workbench-doc-streaming-pill"
            style={{
              fontSize: "10px",
              padding: "1px 5px",
              borderRadius: "3px",
              background: "#e0e7ff",
              color: "#4338ca",
              whiteSpace: "nowrap",
            }}
          >
            {isZh ? "生成中" : "Generating"}
          </span>
        )}

        <button
          type="button"
          data-testid="autopilot-workbench-doc-expand"
          aria-pressed={expanded}
          aria-label={
            expanded
              ? isZh
                ? "收起文档"
                : "Collapse document"
              : isZh
                ? "展开文档"
                : "Expand document"
          }
          onClick={onToggleExpand}
          className={
            expanded
              ? "inline-flex h-7 max-w-[86px] shrink-0 items-center gap-1 rounded-md bg-slate-900 px-1.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-slate-700"
              : "inline-flex h-7 max-w-[86px] shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          }
        >
          <ExpandIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {expanded
              ? isZh
                ? "收起"
                : "Collapse"
              : isZh
                ? "展开"
                : "Expand"}
          </span>
        </button>
      </header>

      {/* 正文滚动区 */}
      {isEmpty ? (
        <div
          data-testid="autopilot-workbench-doc-empty"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            fontSize: "12px",
          }}
        >
          {isZh
            ? "请在左侧 Spec 树中选择一个节点以查看文档"
            : "Select a node from the Spec tree to view its document"}
        </div>
      ) : (
        <div
          data-testid="autopilot-workbench-doc-scroll"
          ref={scrollRef}
          onScroll={onScrollCapture}
          className="min-w-0 max-w-full [&_*]:min-w-0 [&_code]:break-words [&_pre]:break-words [&_pre]:whitespace-pre-wrap"
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: expanded ? "16px 20px" : "10px 12px",
            minWidth: 0,
            maxWidth: "100%",
            boxSizing: "border-box",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          <MarkdownRenderer
            markdown={renderedMarkdown}
            isStreaming={isStreaming}
            locale={locale}
          />
          <StreamCursor visible={isStreaming} />

          {/* Phase 3：AISummary / ChapterChecklist / RelatedRef */}
          {showExtras && (
            <>
              {/* AISummary 区块 */}
              <div
                data-testid="autopilot-workbench-doc-ai-summary"
                style={{
                  marginTop: "16px",
                  padding: "8px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  background: "#f8fafc",
                }}
              >
                <p style={{ fontSize: "12px", color: aiSummary ? "#1e293b" : "#94a3b8" }}>
                  {aiSummary
                    ? aiSummary
                    : isZh
                      ? "AI 摘要尚未生成"
                      : "AI summary not yet available"}
                </p>
              </div>

              {/* ChapterChecklist 区块 */}
              <div
                data-testid="autopilot-workbench-doc-chapter-checklist"
                style={{
                  marginTop: "12px",
                  padding: "8px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                }}
              >
                {chapterChecklist.length === 0 ? (
                  <p style={{ fontSize: "12px", color: "#94a3b8" }}>
                    {isZh ? "暂无章节" : "No chapters"}
                  </p>
                ) : (
                  chapterChecklist.map((item) => (
                    <label
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12px",
                        padding: "2px 0",
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled
                        checked={item.completed}
                        readOnly
                      />
                      {item.title}
                    </label>
                  ))
                )}
              </div>

            </>
          )}
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// 有状态 Wrapper
// ---------------------------------------------------------------------------

/**
 * 中间文档主区有状态 wrapper。
 *
 * 管理：
 * - `expanded` 状态（展开 / 收起按钮）
 * - scroll ref + `useLayoutEffect` 用于 `activeDoc` 切换时恢复滚动位置
 */
export const WorkbenchDocMain: FC<WorkbenchDocMainProps> = ({
  activeDoc,
  renderedMarkdown,
  isStreaming,
  scrollTop,
  onScroll,
  chapterChecklist,
  relatedRefs,
  aiSummary,
  staleArtifact,
  onSelectDocument,
  expanded: controlledExpanded,
  onExpandedChange,
  locale,
}) => {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const expanded = controlledExpanded ?? uncontrolledExpanded;

  const handleToggleExpand = useCallback(() => {
    const next = !expanded;
    if (controlledExpanded === undefined) {
      setUncontrolledExpanded(next);
    }
    onExpandedChange?.(next);
  }, [controlledExpanded, expanded, onExpandedChange]);

  // 滚动位置恢复：当 activeDoc 切换时，容器层通过 scrollTop prop 传入
  // 上次缓存的位置，这里在 layout 阶段恢复。
  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollTop;
    }
  }, [activeDoc?.id, scrollTop]);

  // 滚动事件上报给容器层缓存
  const handleScrollCapture = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      onScroll((e.target as HTMLDivElement).scrollTop);
    },
    [onScroll]
  );

  return (
    <WorkbenchDocMainView
      activeDoc={activeDoc}
      renderedMarkdown={renderedMarkdown}
      isStreaming={isStreaming}
      expanded={expanded}
      onToggleExpand={handleToggleExpand}
      scrollRef={scrollRef}
      onScrollCapture={handleScrollCapture}
      chapterChecklist={chapterChecklist}
      relatedRefs={relatedRefs}
      aiSummary={aiSummary}
      staleArtifact={staleArtifact}
      onSelectDocument={onSelectDocument}
      locale={locale}
    />
  );
};

export default WorkbenchDocMain;
