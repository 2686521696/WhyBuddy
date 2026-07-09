/**
 * `autopilot-spec-documents-workbench-v2` Phase 1 / Task 2 — 顶部状态栏动作按钮 SSR 测试。
 *
 * 沿用本仓既有 `react-dom/server` `renderToStaticMarkup` + `vi.mock` 的测试模式
 * （参见 `AutopilotSpecDocumentsWorkbench.skeleton.test.tsx` 与
 * `client/src/pages/autopilot/right-rail/primitives/__tests__/sub-stage-card.test.tsx`），
 * 不引入 `@testing-library/react` / `jsdom` / `happy-dom`。
 *
 * 覆盖范围：
 * a. 三个动作按钮的稳定 `data-testid` + 默认未禁用渲染；不出现列表容器。
 * b. `generating === "all"` 时三个按钮全部禁用并 `aria-disabled="true"`。
 * c. `exportDisabled === true` 且 `generating === null` 时仅 export 禁用，
 *    review / refresh 仍可用。
 * d. `subtitle` 缺失时渲染稳定 zh-CN 降级文案 `"Spec 文档驾驶舱"`，且不留空白
 *    `<p data-testid="autopilot-workbench-subtitle"></p>` 节点。
 * e. 通过直接调用 FC + 遍历 ReactElement 树触发各按钮的 `onClick`，断言
 *    `onExport` / `onReview` / `onRefresh` 各被调用一次。
 */

import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 与 skeleton 测试保持一致：预先 mock blueprint-realtime-store，避免下游子组件
// 在内部消费它时产生副作用（Phase 1 状态栏组件本身不订阅 store）。
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

import {
  WorkbenchStatusBar,
  type WorkbenchStatusBarProps,
} from "../WorkbenchStatusBar";

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<WorkbenchStatusBarProps> = {}
): WorkbenchStatusBarProps {
  return {
    title: "测试蓝图",
    subtitle: "测试副标题",
    generating: null,
    onExport: () => {},
    onReview: () => {},
    onRefresh: () => {},
    exportDisabled: false,
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
  // ReactElement
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

// 直接调用 FC（无 hooks-internal-context）：WorkbenchStatusBar 仅使用 props，
// 没有受 React runtime 影响的 hook，因此可以以纯函数方式调用并拿到 ReactElement。
function invokeStatusBar(props: WorkbenchStatusBarProps): ReactElement {
  return (WorkbenchStatusBar as unknown as (
    p: WorkbenchStatusBarProps
  ) => ReactElement)(props);
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("WorkbenchStatusBar — action buttons (Phase 1 / Task 2)", () => {
  it("(a) renders all three action buttons with stable testids and no list containers when generating === null and exportDisabled === false", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps()} />
    );

    expect(markup).toContain('data-testid="autopilot-workbench-status-bar"');
    expect(markup).toContain('data-testid="autopilot-workbench-action-export"');
    expect(markup).toContain('data-testid="autopilot-workbench-action-review"');
    expect(markup).toContain('data-testid="autopilot-workbench-action-refresh"');

    // 默认非禁用：disabled 与 aria-disabled="true" 都不应出现
    expect(markup).not.toMatch(/disabled(=""|>)/);
    expect(markup).not.toContain('aria-disabled="true"');

    // 不渲染列表容器
    expect(markup).not.toMatch(/<ul\b/);
    expect(markup).not.toMatch(/<ol\b/);
    expect(markup).not.toMatch(/data-testid="[^"]*-list"/);
  });

  it('(b) disables all three buttons with aria-disabled="true" when generating === "all"', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps({ generating: "all" })} />
    );

    // 三个 disabled 属性都应渲染：renderToStaticMarkup 输出 `disabled=""`
    const disabledMatches = markup.match(/disabled=""/g) ?? [];
    expect(disabledMatches.length).toBe(3);

    // 三个 aria-disabled="true" 都应渲染
    const ariaDisabledMatches = markup.match(/aria-disabled="true"/g) ?? [];
    expect(ariaDisabledMatches.length).toBe(3);
  });

  it("(c) disables only the export button when exportDisabled === true and generating === null", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar
        {...makeProps({ generating: null, exportDisabled: true })}
      />
    );

    // 只有 export 按钮应当 disabled
    const disabledMatches = markup.match(/disabled=""/g) ?? [];
    expect(disabledMatches.length).toBe(1);

    // 只有一处 aria-disabled="true"
    const ariaDisabledTrue = markup.match(/aria-disabled="true"/g) ?? [];
    expect(ariaDisabledTrue.length).toBe(1);

    // 该 disabled 必须落在 export 按钮上：基于属性顺序——button 元素先输出
    // type / data-testid，然后是 onClick（SSR 不会序列化），随后是 disabled。
    // 所以 export 按钮的标签片段应同时含 export testid 与 disabled。
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-action-export"[^>]*disabled=""/
    );
    // review / refresh 按钮则不应同时携带 disabled。
    expect(markup).not.toMatch(
      /data-testid="autopilot-workbench-action-review"[^>]*disabled=""/
    );
    expect(markup).not.toMatch(
      /data-testid="autopilot-workbench-action-refresh"[^>]*disabled=""/
    );
  });

  it("(d) falls back to a stable zh-CN subtitle and never emits an empty <p data-testid=\"autopilot-workbench-subtitle\"></p> node", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar
        {...makeProps({ subtitle: undefined, locale: "zh-CN" })}
      />
    );

    expect(markup).toContain('data-testid="autopilot-workbench-subtitle"');
    expect(markup).toContain("Spec 文档驾驶舱");
    // 不允许出现空的 `<p data-testid="autopilot-workbench-subtitle"></p>`：
    // SSR 输出可能是 `<p data-testid="autopilot-workbench-subtitle"></p>` 这种字面量。
    expect(markup).not.toMatch(
      /<p[^>]*data-testid="autopilot-workbench-subtitle"[^>]*><\/p>/
    );

    // 同时验证 subtitle 是空字符串时也走降级文案。
    const markupEmptyString = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps({ subtitle: "", locale: "zh-CN" })} />
    );
    expect(markupEmptyString).toContain("Spec 文档驾驶舱");
    expect(markupEmptyString).not.toMatch(
      /<p[^>]*data-testid="autopilot-workbench-subtitle"[^>]*><\/p>/
    );
  });

  it("(e) delegates onClick to onExport / onReview / onRefresh exactly once each", () => {
    const onExport = vi.fn();
    const onReview = vi.fn();
    const onRefresh = vi.fn();

    const element = invokeStatusBar(
      makeProps({ onExport, onReview, onRefresh })
    );

    const exportButton = findElementByTestId(
      element,
      "autopilot-workbench-action-export"
    );
    const reviewButton = findElementByTestId(
      element,
      "autopilot-workbench-action-review"
    );
    const refreshButton = findElementByTestId(
      element,
      "autopilot-workbench-action-refresh"
    );

    expect(exportButton).not.toBeNull();
    expect(reviewButton).not.toBeNull();
    expect(refreshButton).not.toBeNull();
    expect(exportButton!.type).toBe("button");
    expect(reviewButton!.type).toBe("button");
    expect(refreshButton!.type).toBe("button");

    (exportButton!.props as { onClick: () => void }).onClick();
    (reviewButton!.props as { onClick: () => void }).onClick();
    (refreshButton!.props as { onClick: () => void }).onClick();

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("(f) renders one generation entry point when onGenerateAll is provided", () => {
    const onGenerateAll = vi.fn();
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...makeProps({ onGenerateAll })} />
    );

    expect(markup).toContain(
      'data-testid="autopilot-workbench-action-generate-all"'
    );
    expect(markup).not.toContain(
      'data-testid="autopilot-workbench-action-refresh"'
    );
  });
});
