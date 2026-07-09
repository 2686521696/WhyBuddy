/**
 * `autopilot-spec-documents-workbench-v2` Phase 1 / Task 1 — 四区骨架 SSR 测试。
 *
 * 测试策略与本仓既有 right-rail 测试（`AutopilotRightRail.subtimeline-mount.test.tsx`、
 * `RoleStatusStrip.test.tsx`）保持一致：本仓 *未* 集成
 * `@testing-library/react` / `jsdom` / `happy-dom`，因此使用
 * `react-dom/server` 的 `renderToStaticMarkup` + `vi.mock` 的组合，对 SSR 输出
 * 做字符串级断言。
 *
 * 本测试覆盖 requirements R1.1 / R1.2 / R1.4：
 * - 容器组件在桌面默认尺寸下输出包含四个稳定 `data-testid` 的 HTML 字符串：
 *   `autopilot-workbench-status-bar`、`autopilot-workbench-spec-tree`、
 *   `autopilot-workbench-doc-main`、`autopilot-workbench-execution-panel`。
 * - 容器自身的根节点 `autopilot-spec-documents-workbench` 也必须出现在 markup 中。
 *
 * 兼容约束：
 * - 不依赖 `useBlueprintRealtimeStore` 真实订阅（Phase 1 占位组件不订阅 store），
 *   因此可以省略对该 module 的 `vi.mock`；但保留示例化 mock 入口，便于后续
 *   Task 2/3/4/8 在补内容时按 `RoleStatusStrip.test.tsx` 同款模式扩展。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 安全起见，预先把 blueprint-realtime-store 替换为一个最小 mock，避免后续
// 子组件在内部消费它时产生副作用（Phase 1 占位阶段实际尚未消费）。
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

import type { AutopilotSpecDocumentsWorkbenchProps } from "../AutopilotSpecDocumentsWorkbench";
import {
  AutopilotSpecDocumentsWorkbench,
  resolveWorkbenchGridLayout,
} from "../AutopilotSpecDocumentsWorkbench";

function makeProps(
  overrides: Partial<AutopilotSpecDocumentsWorkbenchProps> = {}
): AutopilotSpecDocumentsWorkbenchProps {
  return {
    entries: [],
    specDocuments: [],
    specTree: null,
    locale: "zh-CN",
    onGenerateAll: undefined,
    onGenerateNode: undefined,
    generating: null,
    jobId: undefined,
    job: null,
    ...overrides,
  };
}

describe("AutopilotSpecDocumentsWorkbench skeleton", () => {
  it("renders all four region testids together in SSR markup", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbench {...makeProps()} />
    );

    // 容器自身根节点
    expect(markup).toContain('data-testid="autopilot-spec-documents-workbench"');

    // 四区稳定 data-testid，必须同时出现（R1.1 / R1.2 / R1.4）
    expect(markup).toContain('data-testid="autopilot-workbench-status-bar"');
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree"');
    expect(markup).toContain('data-testid="autopilot-workbench-doc-main"');
    expect(markup).toContain('data-testid="autopilot-workbench-execution-panel"');
  });

  it("preserves four-region order: status before tree, tree before main, main before exec", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbench {...makeProps()} />
    );

    const statusIdx = markup.indexOf(
      'data-testid="autopilot-workbench-status-bar"'
    );
    const treeIdx = markup.indexOf(
      'data-testid="autopilot-workbench-spec-tree"'
    );
    const mainIdx = markup.indexOf(
      'data-testid="autopilot-workbench-doc-main"'
    );
    const execIdx = markup.indexOf(
      'data-testid="autopilot-workbench-execution-panel"'
    );

    expect(statusIdx).toBeGreaterThan(-1);
    expect(treeIdx).toBeGreaterThan(statusIdx);
    expect(mainIdx).toBeGreaterThan(treeIdx);
    expect(execIdx).toBeGreaterThan(mainIdx);
  });

  it("does not render any list container children inside the empty four-region skeleton", () => {
    // Phase 1 / Task 1：四个区域都是占位 <section>，不应出现 <ul> / <ol> 列表容器，
    // 也不应出现 `data-testid="...-list"` 这类列表壳标识，避免与下游空态契约冲突。
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbench {...makeProps()} />
    );

    expect(markup).not.toMatch(/<ul\b/);
    expect(markup).not.toMatch(/<ol\b/);
    expect(markup).not.toMatch(/data-testid="[^"]*-list"/);
  });

  it("keeps the tree/main grid track visible even when no spec documents exist", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbench
        {...makeProps({
          specTree: {
            id: "tree-auth",
            rootNodeId: "auth-root",
            nodes: [
              {
                id: "auth-root",
                title: "Auth Root",
                summary: "Root summary",
                type: "route_step",
                status: "draft",
                priority: 1,
                dependencies: [],
                outputs: [],
                children: [],
              },
            ],
          } as unknown as AutopilotSpecDocumentsWorkbenchProps["specTree"],
          specDocuments: [],
        })}
      />
    );

    expect(markup).toContain("grid-template-rows:auto minmax(0, 1fr) 240px");
  });

  it("uses compact gutters and a narrower tree column so the right rail content does not clip horizontally", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbench {...makeProps()} />
    );

    expect(markup).toContain("p-1.5");
    expect(markup).toContain("grid-template-columns:238px minmax(0, 1fr)");
    expect(markup).toContain("gap:6px");
  });

  it("uses a fixed execution strip height so console content scrolls instead of squeezing the document workspace", () => {
    const layout = resolveWorkbenchGridLayout(false);

    expect(layout.gridTemplateRows).toBe("auto minmax(0, 1fr) 240px");
    expect(layout.gridTemplateAreas).toContain("exec   exec");
  });

  it("expanded document mode keeps the status, spec tree, document main, and execution strip mounted", () => {
    const layout = resolveWorkbenchGridLayout(true);

    expect(layout.gridTemplateColumns).toBe("238px minmax(0, 1fr)");
    expect(layout.gridTemplateRows).toBe("auto minmax(0, 1fr) 240px");
    expect(layout.gridTemplateAreas).toContain("status status");
    expect(layout.gridTemplateAreas).toContain("tree   main");
    expect(layout.gridTemplateAreas).toContain("exec   exec");
  });

  it("accepts the StreamingDocRendererProps-equivalent props without runtime warnings", () => {
    // 模拟 AutopilotRightRail 真实挂载时的 props 形状（非 null specTree / job 等），
    // 确保容器在收到完整 props 时仍只渲染四区骨架，不抛出异常。
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbench
        {...makeProps({
          locale: "en-US",
          generating: "all",
          jobId: "job-test",
          job: { id: "job-test", stage: "spec_docs" } as unknown as
            AutopilotSpecDocumentsWorkbenchProps["job"],
          specTree: { id: "tree", nodes: [] } as unknown as
            AutopilotSpecDocumentsWorkbenchProps["specTree"],
        })}
      />
    );

    expect(markup).toContain('data-testid="autopilot-workbench-status-bar"');
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree"');
    expect(markup).toContain('data-testid="autopilot-workbench-doc-main"');
    expect(markup).toContain('data-testid="autopilot-workbench-execution-panel"');
  });

  it("renders job title/subtitle and an initial active node action when specTree exists before documents are generated", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbench
        {...makeProps({
          locale: "zh-CN",
          onGenerateNode: () => {},
          job: {
            id: "job-auth",
            title: "权限管理系统",
            summary: "SPEC-FIRST 蓝图",
            artifacts: [],
          } as unknown as AutopilotSpecDocumentsWorkbenchProps["job"],
          specTree: {
            id: "tree-auth",
            rootNodeId: "auth-root",
            nodes: [
              {
                id: "auth-root",
                title: "权限管理系统",
                summary: "权限主线",
                type: "route_step",
                status: "draft",
                priority: 1,
                dependencies: [],
                outputs: [],
                children: [],
              },
            ],
          } as unknown as AutopilotSpecDocumentsWorkbenchProps["specTree"],
          specDocuments: [],
        })}
      />
    );

    expect(markup).toContain("权限管理系统");
    expect(markup).toContain("SPEC-FIRST 蓝图");
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-generate-auth-root"'
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-spec-tree-node-auth-root"[^>]*data-active="true"/
    );
  });
});
