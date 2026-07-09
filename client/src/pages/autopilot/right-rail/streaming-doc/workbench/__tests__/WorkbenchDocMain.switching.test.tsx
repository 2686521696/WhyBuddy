/**
 * `WorkbenchDocMain` SSR 渲染断言。
 *
 * 覆盖：
 * a. Title + DocType chip 在 `activeDoc` 变化时同步更新。
 * b. MarkdownRenderer 接收 `renderedMarkdown`；StreamCursor 在
 *    `isStreaming=false` 时隐藏，`true` 时可见。
 * c. 空态（`activeDoc === null` 或 `renderedMarkdown === ""`）渲染
 *    `data-testid="autopilot-workbench-doc-empty"`。
 * d. 展开按钮：`expanded=false` → `aria-pressed="false"`；
 *    `expanded=true` → `aria-pressed="true"`。
 * e. 外层 `data-testid="autopilot-workbench-doc-main"` 始终存在。
 *
 * 测试模式：`renderToStaticMarkup` + `vi.mock`（R6.5）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock MarkdownRenderer 为简单 stub
vi.mock("../../MarkdownRenderer", () => ({
  MarkdownRenderer: (props: { markdown: string; isStreaming: boolean }) => (
    <div
      data-testid="mock-markdown-renderer"
      data-markdown={props.markdown}
      data-streaming={String(props.isStreaming)}
    />
  ),
}));

// Mock StreamCursor 为简单 stub
vi.mock("../../StreamCursor", () => ({
  StreamCursor: (props: { visible: boolean }) =>
    props.visible ? <span data-testid="mock-stream-cursor" /> : null,
}));

import { WorkbenchDocMainView } from "../WorkbenchDocMain";
import type { WorkbenchDocMainViewProps, ActiveDocMeta } from "../WorkbenchDocMain";
import type { ChapterChecklistItem } from "../derive-chapter-checklist";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<ActiveDocMeta> = {}): ActiveDocMeta {
  return {
    id: "doc-1",
    title: "Test Document",
    type: "requirements",
    nodeTitle: "Node A",
    isStreaming: false,
    ...overrides,
  };
}

function renderView(overrides: Partial<WorkbenchDocMainViewProps> = {}) {
  const defaultProps: WorkbenchDocMainViewProps = {
    activeDoc: makeDoc(),
    renderedMarkdown: "# Hello",
    isStreaming: false,
    expanded: false,
    onToggleExpand: () => {},
    chapterChecklist: [],
    relatedRefs: [],
    aiSummary: null,
    onSelectDocument: () => {},
    locale: "zh-CN",
    ...overrides,
  };
  return renderToStaticMarkup(<WorkbenchDocMainView {...defaultProps} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkbenchDocMain.switching", () => {
  it("(e) outer data-testid always present", () => {
    const markup = renderView();
    expect(markup).toContain('data-testid="autopilot-workbench-doc-main"');
  });

  it("(a) renders title and DocType chip from activeDoc", () => {
    const markup = renderView({
      activeDoc: makeDoc({ title: "My Req Doc", type: "requirements" }),
    });
    expect(markup).toContain('data-testid="autopilot-workbench-doc-type-chip"');
    expect(markup).toContain('data-testid="autopilot-workbench-doc-title"');
    expect(markup).toContain("My Req Doc");
    expect(markup).toContain("需求"); // zh-CN fullLabel for requirements
  });

  it("(a) title and chip update when activeDoc changes", () => {
    const markup1 = renderView({
      activeDoc: makeDoc({ title: "Doc A", type: "design" }),
    });
    expect(markup1).toContain("Doc A");
    expect(markup1).toContain("设计"); // zh-CN fullLabel for design

    const markup2 = renderView({
      activeDoc: makeDoc({ title: "Doc B", type: "tasks" }),
    });
    expect(markup2).toContain("Doc B");
    expect(markup2).toContain("任务"); // zh-CN fullLabel for tasks
    expect(markup2).not.toContain("Doc A");
  });

  it("(b) MarkdownRenderer receives renderedMarkdown", () => {
    const markup = renderView({ renderedMarkdown: "## Section" });
    expect(markup).toContain('data-testid="mock-markdown-renderer"');
    expect(markup).toContain('data-markdown="## Section"');
  });

  it("(b) StreamCursor hidden when isStreaming=false", () => {
    const markup = renderView({ isStreaming: false });
    expect(markup).not.toContain('data-testid="mock-stream-cursor"');
  });

  it("(b) StreamCursor visible when isStreaming=true", () => {
    const markup = renderView({ isStreaming: true });
    expect(markup).toContain('data-testid="mock-stream-cursor"');
  });

  it("(c) empty state when activeDoc is null", () => {
    const markup = renderView({ activeDoc: null, renderedMarkdown: "" });
    expect(markup).toContain('data-testid="autopilot-workbench-doc-empty"');
    expect(markup).not.toContain('data-testid="mock-markdown-renderer"');
  });

  it("(c) empty state when renderedMarkdown is empty and not streaming", () => {
    const markup = renderView({
      activeDoc: makeDoc(),
      renderedMarkdown: "",
      isStreaming: false,
    });
    expect(markup).toContain('data-testid="autopilot-workbench-doc-empty"');
  });

  it("(c) NOT empty when renderedMarkdown is empty but isStreaming=true", () => {
    const markup = renderView({
      activeDoc: makeDoc({ isStreaming: true }),
      renderedMarkdown: "",
      isStreaming: true,
    });
    // When streaming, we show the renderer even if markdown is empty
    expect(markup).toContain('data-testid="mock-markdown-renderer"');
    expect(markup).not.toContain('data-testid="autopilot-workbench-doc-empty"');
  });

  it("(d) expand button: expanded=false → aria-pressed=false", () => {
    const markup = renderView({ expanded: false });
    expect(markup).toContain('data-testid="autopilot-workbench-doc-expand"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("(d) expand button: expanded=true → aria-pressed=true", () => {
    const markup = renderView({ expanded: true });
    expect(markup).toContain('aria-pressed="true"');
  });

  it("(d) expanded=true adds data-expanded attribute", () => {
    const markup = renderView({ expanded: true });
    expect(markup).toContain('data-expanded="true"');
  });

  it("(d) expand button uses state-specific lucide icons", () => {
    const collapsedMarkup = renderView({ expanded: false });
    const expandedMarkup = renderView({ expanded: true });

    expect(collapsedMarkup).toContain("lucide-maximize2");
    expect(expandedMarkup).toContain("lucide-minimize2");
  });

  it("(a) en locale renders English labels", () => {
    const markup = renderView({
      activeDoc: makeDoc({ type: "requirements" }),
      locale: "en-US",
    });
    expect(markup).toContain("Requirements");
  });

  // -------------------------------------------------------------------------
  // Phase 3 / Task 11：AISummary / ChapterChecklist / RelatedRef
  // -------------------------------------------------------------------------

  it("(f) AISummary renders the provided aiSummary string when non-null", () => {
    const markup = renderView({
      aiSummary: "This is a test summary",
      renderedMarkdown: "## Section\nContent here",
    });
    expect(markup).toContain('data-testid="autopilot-workbench-doc-ai-summary"');
    expect(markup).toContain("This is a test summary");
  });

  it("(g) AISummary renders fallback text when aiSummary is null", () => {
    const markup = renderView({
      aiSummary: null,
      renderedMarkdown: "## Section\nContent here",
    });
    expect(markup).toContain('data-testid="autopilot-workbench-doc-ai-summary"');
    expect(markup).toContain("AI 摘要尚未生成");
  });

  it("(g) AISummary renders English fallback text in en locale", () => {
    const markup = renderView({
      aiSummary: null,
      renderedMarkdown: "## Section\nContent here",
      locale: "en-US",
    });
    expect(markup).toContain("AI summary not yet available");
  });

  it("(h) ChapterChecklist renders checkbox items with correct checked state", () => {
    const checklist: ChapterChecklistItem[] = [
      { id: "intro", title: "Introduction", completed: true },
      { id: "details", title: "Details", completed: false },
    ];
    const markup = renderView({
      chapterChecklist: checklist,
      renderedMarkdown: "## Introduction\nSome text\n## Details\n",
    });
    expect(markup).toContain('data-testid="autopilot-workbench-doc-chapter-checklist"');
    expect(markup).toContain("Introduction");
    expect(markup).toContain("Details");
    // checked checkbox for completed item
    expect(markup).toContain("checked");
  });

  it("(i) does not render related document shortcuts below long documents", () => {
    const markup = renderView({
      relatedRefs: [
        {
          documentId: "doc-design-1",
          nodeId: "node-1",
          type: "design",
          title: "Design Doc",
          relation: "sibling-type",
        },
        {
          documentId: "doc-tasks-1",
          nodeId: "node-1",
          type: "tasks",
          title: "Tasks Doc",
          relation: "sibling-type",
        },
      ],
      renderedMarkdown: "## Section\nContent",
    });
    expect(markup).not.toContain('data-testid="autopilot-workbench-doc-related-refs"');
    expect(markup).not.toContain("autopilot-workbench-doc-related-ref-");
    expect(markup).not.toContain("Design Doc (design)");
    expect(markup).not.toContain("Tasks Doc (tasks)");
  });

  it("(j) does not render an empty related document placeholder", () => {
    const markup = renderView({
      relatedRefs: [],
      renderedMarkdown: "## Section\nContent",
    });
    expect(markup).not.toContain('data-testid="autopilot-workbench-doc-related-refs"');
    expect(markup).not.toContain("暂无关联文档");
    expect(markup).not.toContain("No related documents");
    expect(markup).not.toContain("autopilot-workbench-doc-related-ref-");
  });

  it("(k) when in empty state (activeDoc === null), none of the three sections render", () => {
    const markup = renderView({
      activeDoc: null,
      renderedMarkdown: "",
      aiSummary: "Should not appear",
      chapterChecklist: [{ id: "x", title: "X", completed: true }],
      relatedRefs: [
        {
          documentId: "doc-1",
          nodeId: "n-1",
          type: "design",
          title: "D",
          relation: "sibling-type",
        },
      ],
    });
    expect(markup).not.toContain('data-testid="autopilot-workbench-doc-ai-summary"');
    expect(markup).not.toContain('data-testid="autopilot-workbench-doc-chapter-checklist"');
    expect(markup).not.toContain('data-testid="autopilot-workbench-doc-related-refs"');
  });

  it("(l) applies compact body padding and long-content wrap guards inside the scroll area", () => {
    const markup = renderView({
      renderedMarkdown:
        "```json\n{\"veryLongKey\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}\n```",
    });

    expect(markup).toContain('data-testid="autopilot-workbench-doc-scroll"');
    expect(markup).toContain("padding:10px 12px");
    expect(markup).toContain("whitespace-pre-wrap");
    expect(markup).toContain("break-words");
  });

  it("(m) renders a stale badge in the document header for stale active spec documents", () => {
    const markup = renderView({
      activeDoc: makeDoc({ title: "Stale Requirements", type: "requirements" }),
      staleArtifact: {
        staleSince: "2026-05-23T10:00:00.000Z",
        invalidatedBy: {
          stage: "route_generation",
          artifactId: "route-selection-1",
          artifactType: "route_selection",
          reason: "upstream_route_selection_changed",
          triggeredAt: "2026-05-23T10:00:00.000Z",
        },
      },
    } as Partial<WorkbenchDocMainViewProps>);

    expect(markup).toContain('data-testid="autopilot-stale-badge"');
    expect(markup).toContain("已过期");
    expect(markup).toContain("路线");
    expect(markup).toContain("Stale Requirements");
  });
});
