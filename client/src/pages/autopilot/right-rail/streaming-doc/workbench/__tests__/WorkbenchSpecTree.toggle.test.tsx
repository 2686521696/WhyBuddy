/**
 * `autopilot-spec-documents-workbench-v2` Phase 1 / Task 3 — 左侧 Spec 树 SSR 测试。
 *
 * 沿用本仓既有 `react-dom/server` `renderToStaticMarkup` + `vi.mock` 的测试模式
 * （参见 `WorkbenchStatusBar.actions.test.tsx` 与
 * `client/src/pages/autopilot/right-rail/primitives/__tests__/sub-stage-card.test.tsx`），
 * 不引入 `@testing-library/react` / `jsdom` / `happy-dom`。
 *
 * 覆盖范围：
 * a. SSR markup 同时含搜索框、节点 / 文档行 testid，以及由
 *    `deriveSpecTreeChip` 派生的 chip 文案（这里使用一个 `accepted x3` 的
 *    节点，断言 `"3/3 accepted"` 出现）。
 * b. 默认渲染（首屏 expansion 为空、search 为空时）至少展开第一个根节点；
 *    第二个根节点的 toggle aria-expanded 与第一个不同（互不影响）。
 * c. 通过遍历 ReactElement 树触发第二个根节点的 toggle onClick，确认
 *    onClick handler 引用稳定且可被独立调用，不抛异常；同时第一个 / 第二个
 *    根节点的 toggle button 引用应当是不同的 onClick 闭包（独立 handler）。
 * d. `deriveSpecTreeChip` 文案在 markup 中以正确节点顺序出现：第一个
 *    accepted 节点显示 `"3/3 accepted"`，第二个 reviewing 节点显示
 *    `"1/3 reviewing"`。
 * e. 空 specTree（`null` / `nodes: []`）只渲染搜索框 + `*-empty` 占位文案，
 *    不出现 `<ul>` / `<ol>` 列表容器或 `*-list` testid。
 * f. 当 `activeDocId` 落在某个节点的文档上时，节点行 `data-active="true"`，
 *    且 `data-testid="autopilot-workbench-spec-tree-generate-{nodeId}"` 出现；
 *    `activeDocId === null` 时，没有任何 generate 按钮渲染。
 *    通过遍历 ReactElement 树触发 generate 按钮 `onClick`，断言
 *    `onGenerateNode` 被以 nodeId 调用一次。
 */

import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 与仓内既有 right-rail 测试保持一致的 blueprint-realtime-store mock，本组件
// 不直接订阅它，但 SpecTreeChip 的相邻组件 / 工具函数有可能间接访问。
vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: unknown) => unknown) => {
    const snapshot = {
      agentReasoning: { entries: [] as unknown[] },
      rolePhases: {} as Record<string, unknown>,
      agentProgress: {} as Record<string, unknown>,
      capabilityStatuses: [] as unknown[],
    };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

import {
  WorkbenchSpecTree,
  WorkbenchSpecTreeView,
  __testing__ as specTreeTesting,
  type WorkbenchSpecTreeProps,
} from "../WorkbenchSpecTree";
import {
  parseSpecDocsObservingEntries,
  type SpecDocsObservingSnapshot,
} from "../../../parse-spec-docs-observing";

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  title: string,
  parentId?: string,
  childIds: string[] = []
): BlueprintSpecTreeNode {
  return {
    id,
    parentId,
    title,
    summary: `${title} summary`,
    type: "route_step",
    status: "draft",
    priority: 1,
    dependencies: [],
    outputs: [],
    children: childIds,
  } as BlueprintSpecTreeNode;
}

function makeDoc(
  nodeId: string,
  type: BlueprintSpecDocumentType,
  status: BlueprintSpecDocumentStatus = "reviewing",
  title?: string
): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}-${type}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId,
    type,
    status,
    title: title ?? `${type} for ${nodeId}`,
    summary: `${type} summary`,
    content: "",
    format: "markdown",
    createdAt: "2026-05-16T07:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "route_step",
      nodeTitle: nodeId,
      nodeSummary: "summary",
      dependencies: [],
      outputs: [],
      generationSource: "llm",
    },
  } as unknown as BlueprintSpecDocument;
}

function makeTree(nodes: BlueprintSpecTreeNode[]): BlueprintSpecTree {
  return {
    id: "tree-1",
    routeSetId: "rs-1",
    selectionId: "sel-1",
    selectedRouteId: "route-1",
    rootNodeId: nodes[0]?.id ?? "n-0",
    version: 1,
    status: "reviewing",
    createdAt: "2026-05-16T07:00:00.000Z",
    updatedAt: "2026-05-16T07:00:00.000Z",
    alternativeRouteIds: [],
    nodes,
    provenance: {
      jobId: "job-1",
      githubUrls: [],
    },
  } as unknown as BlueprintSpecTree;
}

function makeProps(
  overrides: Partial<WorkbenchSpecTreeProps> = {}
): WorkbenchSpecTreeProps {
  // 默认 tree：root1 (accepted x3)、root1.child1、root1.child2、root2 (reviewing x1)
  const root1 = makeNode("root-1", "Auth Domain", undefined, ["child-1a", "child-1b"]);
  const child1a = makeNode("child-1a", "Login Flow", "root-1");
  const child1b = makeNode("child-1b", "Logout Flow", "root-1");
  const root2 = makeNode("root-2", "Profile Domain");
  const tree = makeTree([root1, child1a, child1b, root2]);

  const docs: BlueprintSpecDocument[] = [
    makeDoc("root-1", "requirements", "accepted"),
    makeDoc("root-1", "design", "accepted"),
    makeDoc("root-1", "tasks", "accepted"),
    makeDoc("root-2", "requirements", "reviewing"),
  ];

  return {
    specTree: tree,
    specDocuments: docs,
    reasoningEntries: [] as AgentReasoningEntry[],
    activeDocId: null,
    onSelectDocument: () => {},
    onGenerateNode: () => {},
    generating: null,
    locale: "zh-CN",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ReactElement 树工具：递归查找首个匹配 `data-testid` 的元素
// ---------------------------------------------------------------------------

function findElementByTestId(
  node: ReactNode,
  testId: string
): ReactElement | null {
  if (node === null || node === undefined || node === false || node === true) {
    return null;
  }
  if (typeof node === "string" || typeof node === "number") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByTestId(child, testId);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement;
  const props = element.props as { [key: string]: unknown } | null | undefined;
  if (props && props["data-testid"] === testId) {
    return element;
  }
  if (props && "children" in props) {
    return findElementByTestId(props.children as ReactNode, testId);
  }
  return null;
}

// ---------------------------------------------------------------------------
// View 调用工具
// ---------------------------------------------------------------------------

/**
 * 将 `WorkbenchSpecTreeProps` 投影成无 hooks 的 `WorkbenchSpecTreeView` 元素，
 * 便于通过遍历 ReactElement 树触发 `onClick` 委派测试，不进入 React renderer。
 *
 * View 自身完全无 `useState` / `useMemo` / `useCallback`，因此可以以纯函数方式
 * 直接调用并拿到 ReactElement 树（与 Task 2 `WorkbenchStatusBar.actions.test.tsx`
 * 中的 `invokeStatusBar` 同款模式）。
 */
function invokeTreeView(
  props: WorkbenchSpecTreeProps,
  overrides?: {
    query?: string;
    expandedNodeIds?: ReadonlySet<string>;
    onQueryChange?: (value: string) => void;
    onToggleNode?: (nodeId: string) => void;
  }
): ReactElement | null {
  if (
    props.specTree === null ||
    props.specTree === undefined ||
    props.specTree.nodes.length === 0
  ) {
    return null;
  }
  const { buildTreeIndex, groupDocsByNodeId, resolveCopy } = specTreeTesting;
  const treeIndex = buildTreeIndex(props.specTree);
  const docsByNodeId = groupDocsByNodeId(props.specDocuments);
  const observingSnapshot: SpecDocsObservingSnapshot =
    parseSpecDocsObservingEntries(props.reasoningEntries);
  const copy = resolveCopy(props.locale);

  return (
    WorkbenchSpecTreeView as unknown as (
      p: Parameters<typeof WorkbenchSpecTreeView>[0]
    ) => ReactElement
  )({
    query: overrides?.query ?? "",
    onQueryChange: overrides?.onQueryChange ?? (() => {}),
    expandedNodeIds: overrides?.expandedNodeIds ?? new Set<string>(),
    onToggleNode: overrides?.onToggleNode ?? (() => {}),
    observingSnapshot,
    docsByNodeId,
    nodesById: treeIndex.nodesById,
    childrenByParent: treeIndex.childrenByParent,
    rootNodeIds: treeIndex.rootNodeIds,
    activeDocId: props.activeDocId,
    onSelectDocument: props.onSelectDocument,
    onGenerateNode: props.onGenerateNode,
    generating: props.generating,
    copy,
    locale: props.locale,
  });
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe("WorkbenchSpecTree (Phase 1 / Task 3)", () => {
  it("(a) renders search input + node testids + chip text together in SSR markup", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps()} />
    );

    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree"');
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-search"'
    );
    // 默认 expansion 为空 + search 为空 => 默认展开第一个根节点 root-1，
    // 因此 root-1 / child-1a / child-1b / root-2 节点都应该出现在 markup 中
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-node-root-1"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-node-child-1a"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-node-child-1b"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-node-root-2"'
    );

    // 展开的 root-1 应当渲染其文档行
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-doc-doc-root-1-requirements"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-doc-doc-root-1-design"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-doc-doc-root-1-tasks"'
    );

    // chip 文案：root-1 三份 accepted => "3/3 accepted"
    expect(markup).toContain("3/3 accepted");
    // root-2 仅 1 份 reviewing => "1/3 reviewing"
    expect(markup).toContain("1/3 reviewing");
  });

  it("(b) renders toggles for roots with children or generated documents", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps()} />
    );

    // root-1 有子节点 => toggle 应渲染
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-toggle-root-1"'
    );
    // root-2 没有子节点但有 requirements 文档 => 仍应渲染 toggle，用户才能展开文档行
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-toggle-root-2"'
    );

    // 默认展开第一个根：root-1 toggle 应为 expanded=true (▼ 字符)，且
    // aria-expanded="true"
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-spec-tree-toggle-root-1"[^>]*aria-expanded="true"/
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-spec-tree-toggle-root-2"[^>]*aria-expanded="false"/
    );
  });

  it("(c) toggle onClick handlers are stable functions and can be invoked without throwing", () => {
    const onToggleNode = vi.fn();
    const element = invokeTreeView(makeProps(), { onToggleNode });
    expect(element).not.toBeNull();

    const root1Toggle = findElementByTestId(
      element,
      "autopilot-workbench-spec-tree-toggle-root-1"
    );
    expect(root1Toggle).not.toBeNull();
    expect(root1Toggle!.type).toBe("button");
    const onClick = (root1Toggle!.props as { onClick: () => void }).onClick;
    expect(typeof onClick).toBe("function");
    // 直接调用不应抛错
    expect(() => onClick()).not.toThrow();
    // toggle 仅作用于点击的节点，目标 nodeId 应被透传给 onToggleNode
    expect(onToggleNode).toHaveBeenCalledTimes(1);
    expect(onToggleNode).toHaveBeenCalledWith("root-1");
  });

  it("(d) renders SpecTreeChip output text in node order — root-1 (accepted) before root-2 (reviewing)", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps()} />
    );

    const acceptedIdx = markup.indexOf("3/3 accepted");
    const reviewingIdx = markup.indexOf("1/3 reviewing");
    expect(acceptedIdx).toBeGreaterThan(-1);
    expect(reviewingIdx).toBeGreaterThan(-1);
    expect(acceptedIdx).toBeLessThan(reviewingIdx);
  });

  it("(e) renders only search input + empty hint when specTree is null or nodes is empty — no list containers", () => {
    const nullMarkup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps({ specTree: null })} />
    );
    expect(nullMarkup).toContain(
      'data-testid="autopilot-workbench-spec-tree"'
    );
    expect(nullMarkup).toContain(
      'data-testid="autopilot-workbench-spec-tree-search"'
    );
    expect(nullMarkup).toContain(
      'data-testid="autopilot-workbench-spec-tree-empty"'
    );
    // 不渲染任何节点行 / 文档行 / 列表容器
    expect(nullMarkup).not.toMatch(
      /data-testid="autopilot-workbench-spec-tree-node-/
    );
    expect(nullMarkup).not.toMatch(/<ul\b/);
    expect(nullMarkup).not.toMatch(/<ol\b/);
    expect(nullMarkup).not.toMatch(/data-testid="[^"]*-list"/);

    const emptyTree = makeTree([]);
    const emptyMarkup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps({ specTree: emptyTree })} />
    );
    expect(emptyMarkup).toContain(
      'data-testid="autopilot-workbench-spec-tree-empty"'
    );
    expect(emptyMarkup).not.toMatch(
      /data-testid="autopilot-workbench-spec-tree-node-/
    );
    expect(emptyMarkup).not.toMatch(/<ul\b/);
    expect(emptyMarkup).not.toMatch(/<ol\b/);
  });

  it('(f) renders inline generate button only when activeDocId belongs to the node, and clicking it invokes onGenerateNode with the matching nodeId', () => {
    // activeDocId === null => 不渲染任何 generate 按钮
    const idleMarkup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps({ activeDocId: null })} />
    );
    expect(idleMarkup).not.toMatch(
      /data-testid="autopilot-workbench-spec-tree-generate-/
    );

    // activeDocId 落在 root-1 的某个文档上 => root-1 节点应该 data-active="true"
    // 且渲染 root-1 的 generate 按钮
    const activeDocId = "doc-root-1-requirements";
    const activeMarkup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps({ activeDocId })} />
    );

    expect(activeMarkup).toMatch(
      /data-testid="autopilot-workbench-spec-tree-node-root-1"[^>]*data-active="true"/
    );
    expect(activeMarkup).toContain(
      'data-testid="autopilot-workbench-spec-tree-generate-root-1"'
    );
    // 其他节点的 generate 按钮不应出现
    expect(activeMarkup).not.toContain(
      'data-testid="autopilot-workbench-spec-tree-generate-root-2"'
    );
    expect(activeMarkup).not.toContain(
      'data-testid="autopilot-workbench-spec-tree-generate-child-1a"'
    );

    // 通过遍历 props 树触发 generate 按钮 onClick，断言 onGenerateNode 收到 root-1
    const onGenerateNode = vi.fn();
    const element = invokeTreeView(makeProps({ activeDocId, onGenerateNode }));
    expect(element).not.toBeNull();

    const generateButton = findElementByTestId(
      element,
      "autopilot-workbench-spec-tree-generate-root-1"
    );
    expect(generateButton).not.toBeNull();
    expect(generateButton!.type).toBe("button");
    (generateButton!.props as { onClick: () => void }).onClick();
    expect(onGenerateNode).toHaveBeenCalledTimes(1);
    expect(onGenerateNode).toHaveBeenCalledWith("root-1");
  });

  it("(g) constrains active node controls so chip and generate action cannot overflow the tree column", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSpecTree
        {...makeProps({ activeDocId: "doc-root-1-requirements" })}
      />
    );

    expect(markup).toContain("overflow-x-hidden");
    expect(markup).toContain("max-w-[86px]");
    expect(markup).toContain("max-w-[56px]");
    expect(markup).toContain("data-compact-label");
    expect(markup).not.toContain("Generate node docs");
  });

  it("(h) keeps the default root branch visible when the first manual toggle expands a child node", () => {
    const root1 = makeNode("root-1", "Auth Domain", undefined, ["child-1a"]);
    const child1a = makeNode("child-1a", "Login Flow", "root-1", [
      "grandchild-1",
    ]);
    const grandchild = makeNode("grandchild-1", "Password Reset", "child-1a");
    const root2 = makeNode("root-2", "Profile Domain");
    const tree = makeTree([root1, child1a, grandchild, root2]);

    const element = invokeTreeView(
      makeProps({
        specTree: tree,
        specDocuments: [
          makeDoc("root-1", "requirements", "accepted"),
          makeDoc("child-1a", "requirements", "reviewing"),
          makeDoc("grandchild-1", "requirements", "draft"),
        ],
      }),
      {
        expandedNodeIds: new Set<string>(["child-1a"]),
      }
    );

    const markup = renderToStaticMarkup(element);

    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-node-root-1"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-node-child-1a"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-node-grandchild-1"'
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-spec-tree-toggle-root-1"[^>]*aria-expanded="true"/
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-spec-tree-toggle-child-1a"[^>]*aria-expanded="true"/
    );
  });

  it("(i) renders stale badges on stale spec tree node rows and stale document rows", () => {
    const staleProps: Pick<
      WorkbenchSpecTreeProps,
      "specTreeStale" | "staleDocumentsById"
    > = {
      specTreeStale: {
        staleSince: "2026-05-23T08:00:00.000Z",
        invalidatedBy: {
          stage: "route_generation",
          artifactId: "route-selection-1",
          artifactType: "route_selection",
          reason: "upstream_route_selection_changed",
          triggeredAt: "2026-05-23T08:00:00.000Z",
        },
      },
      staleDocumentsById: new Map([
        [
          "doc-root-1-requirements",
          {
            staleSince: "2026-05-23T09:00:00.000Z",
            invalidatedBy: {
              stage: "clarification",
              artifactId: "clarification-1",
              artifactType: "clarification_session",
              reason: "upstream_clarification_changed",
              triggeredAt: "2026-05-23T09:00:00.000Z",
            },
          },
        ],
      ]),
    };

    const markup = renderToStaticMarkup(
      <WorkbenchSpecTree
        {...makeProps({
          activeDocId: "doc-root-1-requirements",
          locale: "en-US",
        })}
        {...staleProps}
      />
    );

    const badges = markup.match(/data-testid="autopilot-stale-badge"/g) ?? [];
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain("Stale because route_generation changed");
    expect(markup).toContain("Stale because clarification changed");
  });

  it("(j) expands document-only leaf nodes so design and tasks rows can be selected", () => {
    const element = invokeTreeView(makeProps(), {
      expandedNodeIds: new Set<string>(["root-2"]),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-toggle-root-2"'
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-spec-tree-toggle-root-2"[^>]*aria-expanded="true"/
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-doc-doc-root-2-requirements"'
    );
  });
});
