/**
 * autopilot-spec-tree-workbench / Wave 0 Task 4
 *
 * SpecTreeWorkbench SSR 渲染契约测试。
 *
 * 实现口径（与本仓现有 React 组件测试保持一致）：
 *
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`,
 *   `useState` / `useEffect` / `useMemo` 在 `renderToStaticMarkup`
 *   下不会重新触发。因此本文件分两层：
 *
 *   1. 源代码层断言：直接读 `SpecTreeWorkbench.tsx` 文件,确认两个 CTA
 *      testid 与节点行 testid 都在同一文件里出现;
 *   2. SSR 渲染层：只断言「初始无节点选中」时的契约（双 CTA 渲染、节点行
 *      列出、行未展开、状态 chip 出现）。
 *
 * 行展开后的 SpecDocPreviewBlock 渲染、CTA 的 onClick 行为由父组件集成时
 * 通过 manual-verification 覆盖（与 AutopilotRightRail.subtimeline-mount
 * 的策略一致）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

// ─── store mock ───────────────────────────────────────────────────────────

let mockedReasoningEntries: unknown[] = [];
// spec-generation-perceived-performance / Task 4.4：可选 specDocsProgress mock。
// 默认 null（progress 缺失 → SpecTreeProgressLayer 退化 indeterminate）。组件对
// 缺失 slice 做了防御（`if (!specDocsProgress) return null`），既有用例保持不变。
let mockedSpecDocsProgress: {
  batchStatus: string;
  processedCount: number;
  totalCount: number;
} | null = null;

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: any) => unknown) => {
    const state = {
      agentReasoning: { entries: mockedReasoningEntries },
      specDocsProgress: mockedSpecDocsProgress,
    };
    return selector ? selector(state) : state;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;
  return { useBlueprintRealtimeStore };
});

import { SpecTreeWorkbench } from "../SpecTreeWorkbench";

// ─── 工厂 ─────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  title: string,
  type: BlueprintSpecTreeNode["type"] = "route_step"
): BlueprintSpecTreeNode {
  return {
    id,
    title,
    summary: `${title} summary`,
    type,
    status: "draft",
    priority: 1,
    dependencies: [],
    outputs: [],
    children: [],
  } as BlueprintSpecTreeNode;
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
  } as BlueprintSpecTree;
}

function makeDoc(
  nodeId: string,
  type: BlueprintSpecDocumentType,
  status: BlueprintSpecDocumentStatus = "reviewing"
): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}-${type}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId,
    type,
    status,
    title: `${type} title for ${nodeId}`,
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

const fakeJob = {
  id: "job-1",
  events: [],
  artifacts: [],
} as unknown as BlueprintGenerationJob;

// ─── 用例 ─────────────────────────────────────────────────────────────────

describe("SpecTreeWorkbench (SSR contract)", () => {
  beforeEach(() => {
    mockedReasoningEntries = [];
    mockedSpecDocsProgress = null;
  });
  afterEach(() => {
    mockedReasoningEntries = [];
    mockedSpecDocsProgress = null;
  });

  it("specTree 为空 / null 时显示 empty state", () => {
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={null}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-testid="spec-tree-workbench"');
    expect(markup).toContain('data-state="empty"');
    expect(markup).toContain("SPEC 树尚未就绪");
  });

  it("nodes 数组为空时也显示 empty state", () => {
    const tree = makeTree([]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-state="empty"');
  });

  it("nodes 就绪时:渲染顶部双 CTA + 节点行列表(每行带 chip)", () => {
    const tree = makeTree([
      makeNode("n-1", "Auth Module"),
      makeNode("n-2", "Profile"),
    ]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );

    expect(markup).toContain('data-state="idle"');
    // 顶部双 CTA
    expect(markup).toContain('data-testid="spec-tree-workbench-cta-all"');
    expect(markup).toContain('data-testid="spec-tree-workbench-cta-single"');
    expect(markup).toContain("生成整棵树文档");
    expect(markup).toContain("生成当前节点文档");
    // 单节点 CTA 默认 disabled(无选中)
    // 注意:HTML 中 disabled 是布尔属性,可能渲染成 disabled="" 或 disabled
    expect(markup).toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-cta-single"[^>]*disabled/
    );

    // 节点行
    expect(markup).toContain('data-node-id="n-1"');
    expect(markup).toContain('data-node-id="n-2"');
    expect(markup).toContain("Auth Module");
    expect(markup).toContain("Profile");
    // 初始所有行 expanded=false
    expect(markup).not.toContain('data-expanded="true"');

    // 每行 chip 出现(空 docs → 未生成)
    expect(markup).toContain("未生成");
  });

  it("整树 generating='all' 时:主 CTA 显示 generatingLabel 并 disabled", () => {
    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating="all"
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-generating="all"');
    expect(markup).toContain("生成中…");
    // 两个 CTA 都被 disabled
    expect(markup).toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-cta-all"[^>]*disabled/
    );
  });

  it("docs 已存在的节点 chip 显示对应 label + sourceTag", () => {
    const tree = makeTree([makeNode("n-1", "A")]);
    const docs = [
      makeDoc("n-1", "requirements", "reviewing"),
      makeDoc("n-1", "design", "reviewing"),
    ];
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={docs}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain("2/3 reviewing");
    expect(markup).toContain("· llm");
  });

  it("ephemeral generating 信号通过 store 流入并体现在 chip 上", () => {
    mockedReasoningEntries = [
      {
        id: "evt-1",
        jobId: "job-1",
        iteration: 1,
        iterationLabel: "#1",
        phase: "observing",
        timestamp: "2026-05-16T07:00:00.000Z",
        observationSummary: "✓ A — 规格文档已生成",
        observationSuccess: true,
        stageId: "spec_docs",
      },
    ];
    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating="all"
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    // 节点行 chip 应该显示 "生成中"(ephemeral 优先,因为稳定 docs 为空)
    expect(markup).toContain("生成中");
  });

  it("autopilot-spec-document-export Task 6.2: 至少一个节点有文档时渲染整树导出按钮", () => {
    const tree = makeTree([makeNode("n-1", "A"), makeNode("n-2", "B")]);
    const docs = [makeDoc("n-1", "requirements", "reviewing")];
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={docs}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-testid="spec-tree-workbench-export-all"');
    expect(markup).toContain("导出全部 SPEC");
    // 不应是 disabled 状态
    expect(markup).not.toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-export-all"[^>]*disabled[^>]*>/
    );
  });

  it("autopilot-spec-document-export Task 6.2: 全无文档时整树导出按钮 disabled", () => {
    const tree = makeTree([makeNode("n-1", "A"), makeNode("n-2", "B")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-testid="spec-tree-workbench-export-all"');
    expect(markup).toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-export-all"[^>]*disabled/
    );
  });

  it("不传 specDocuments 时回退到 deriveSpecDocumentTreeStats(job, specTree)", () => {
    // 这里造一个 job.artifacts 含 spec doc artifact 的场景：不显式传
    // specDocuments，让组件自己从 job.artifacts 抽 docs。
    const specDocPayload = {
      id: "doc-1",
      jobId: "job-1",
      treeId: "tree-1",
      nodeId: "n-1",
      type: "requirements",
      status: "reviewing",
      title: "Auth req",
      summary: "auth requirements summary",
      content: "",
      format: "markdown",
      createdAt: "2026-05-16T07:00:00.000Z",
      provenance: {
        jobId: "job-1",
        githubUrls: [],
        treeVersion: 1,
        nodeType: "route_step",
        nodeTitle: "A",
        nodeSummary: "A",
        dependencies: [],
        outputs: [],
        generationSource: "llm",
      },
    };
    const jobWithArtifact = {
      id: "job-1",
      events: [],
      artifacts: [
        {
          id: "artifact-1",
          type: "requirements",
          payload: specDocPayload,
        },
      ],
    } as unknown as BlueprintGenerationJob;

    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={jobWithArtifact}
        specTree={tree}
        // specDocuments 故意不传
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    // chip 应该显示 "1/3 reviewing"（从 job.artifacts 提取出来）
    expect(markup).toContain("1/3 reviewing");
    expect(markup).toContain("· llm");
  });
});

// ─── Layer 1：源代码层契约 ────────────────────────────────────────────────

describe("SpecTreeWorkbench (source-level contract)", () => {
  it("源文件包含两个 CTA testid + 节点行 testid + 行展开 testid", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../SpecTreeWorkbench.tsx"),
      "utf8"
    );

    expect(source).toContain('data-testid="spec-tree-workbench-cta-all"');
    expect(source).toContain('data-testid="spec-tree-workbench-cta-single"');
    expect(source).toContain('data-testid="spec-tree-workbench-row"');
    expect(source).toContain('data-testid="spec-tree-workbench-row-expanded"');

    // —— spec-generation-perceived-performance / 4.1–4.3 重构后的状态机绑定 ——
    // CTA disabled 改由派生 phase 驱动（phase === "pending"），不再用旧的
    // `anyGenerating` 局部布尔；single CTA 仍叠加 selectedNodeId === null。
    expect(source).toMatch(
      /disabled=\{ctaDisabledByPhase \|\| selectedNodeId === null\}/
    );
    expect(source).toMatch(/disabled=\{ctaDisabledByPhase\}/);
    expect(source).toMatch(/ctaDisabledByPhase = phase === "pending"/);
    // CTA 改为先同步置入乐观标记的本地 handler，不再直接绑定父级回调。
    expect(source).toMatch(/onClick=\{handleGenerateAllClick\}/);
    expect(source).toMatch(/onClick=\{handleGenerateSingleClick\}/);
    // 旧的静态 data-state="ready" 已被派生 data-state={phase} 取代。
    expect(source).toMatch(/data-state=\{phase\}/);
    expect(source).not.toMatch(/data-state="ready"/);
    // 行点击触发 onClick(node.id)（未变）
    expect(source).toMatch(/onClick=\{\(\) => onClick\(node\.id\)\}/);
  });
});

// ─── spec-generation-perceived-performance / Task 4.4：反馈渲染 ─────────────
//
// 覆盖任务 4.4 的反馈渲染契约（_Requirements: 1.2, 1.3, 1.4, 2.6, 2.7, 2.10,
// 2.11, 5.1, 5.2_）。
//
// 实现口径（与本目录其它子组件测试一致）：本仓库 *未* 集成
// `@testing-library/react` / `jsdom` / `happy-dom`，`useState`/`useEffect`/ref
// 在 `renderToStaticMarkup` 下不会重新触发或保留交互态。因此本块分两层：
//
//   A. SSR 渲染层 —— 凡是「无需先点击即可进入」的派生 phase 都用 SSR 字符串
//      断言：`pending`（经 `generating` prop 即 In_Flight_Lock 触发）与
//      `failure`（经 `generationError` prop 触发）。
//   B. 源代码层 —— 凡是「依赖一次真实点击才能进入」的行为（同步乐观置入即
//      `pending`、`success`/`empty` 终态、重试按钮渲染、以上次 scope 调用
//      `onRetry`），因 SSR 无法驱动 `settledBaselineRef`/`lastGenerationRef`/
//      `optimistic`，改为对组件源码的接线契约做断言。

describe("SpecTreeWorkbench 反馈渲染 (Task 4.4) — SSR 层", () => {
  beforeEach(() => {
    mockedReasoningEntries = [];
    mockedSpecDocsProgress = null;
  });
  afterEach(() => {
    mockedReasoningEntries = [];
    mockedSpecDocsProgress = null;
  });

  // ── pending：进度反馈层 + 双 CTA 同时 disabled（R1.2 / R1.3） ──────────────

  it("generating='all' → 派生 pending：渲染进度反馈层且两个 CTA 同时 disabled", () => {
    const tree = makeTree([makeNode("n-1", "A"), makeNode("n-2", "B")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating="all"
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );

    // 容器派生为 pending
    expect(markup).toContain('data-state="pending"');
    // 进度反馈层出现（区别于单纯按钮文案翻转，R1.2）
    expect(markup).toContain('data-testid="spec-tree-progress-layer"');
    // all 与 single 两个触发器同时 disabled（R1.3）。
    // 注意：className 含 `disabled:bg-slate-400` 工具类 token，故必须精确匹配
    // 真实布尔属性 `disabled=""`（React SSR 渲染形态），而非裸 `disabled`。
    expect(markup).toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-cta-all"[^>]*disabled=""/
    );
    expect(markup).toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-cta-single"[^>]*disabled=""/
    );
  });

  it("generating='single' → 进度反馈层 data-scope='single'", () => {
    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating="single"
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-state="pending"');
    expect(markup).toContain('data-testid="spec-tree-progress-layer"');
    expect(markup).toContain('data-scope="single"');
  });

  it("pending 期间有 socket 进度时 → 进度反馈层呈 determinate 计数", () => {
    mockedSpecDocsProgress = {
      batchStatus: "running",
      processedCount: 2,
      totalCount: 5,
    };
    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating="all"
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-progress-kind="determinate"');
    expect(markup).toContain("2 / 5");
  });

  it("pending 时仍渲染既有节点行列表（进度层覆盖而非清空，R2.11）", () => {
    const tree = makeTree([
      makeNode("n-1", "Auth"),
      makeNode("n-2", "Profile"),
    ]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating="all"
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-testid="spec-tree-workbench-list"');
    expect(markup).toContain('data-node-id="n-1"');
    expect(markup).toContain('data-node-id="n-2"');
  });

  // ── failure：失败反馈 + CTA 恢复 enabled（R2.6 / R2.5） ────────────────────

  it("generationError 存在 → 派生 failure：渲染失败反馈块", () => {
    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        generationError={{ message: "boom" }}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
        onRetry={() => {}}
      />
    );
    expect(markup).toContain('data-state="failure"');
    expect(markup).toContain('data-testid="spec-tree-workbench-failure"');
    expect(markup).toContain("生成失败，请重试");
    // 进度反馈层不应在 failure 下渲染（R2.9：终态关闭进行中信号）
    expect(markup).not.toContain('data-testid="spec-tree-progress-layer"');
  });

  it("failure 态 CTA 恢复 enabled（cta-all 不再 disabled）", () => {
    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        generationError={{ message: "boom" }}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    // cta-all 在 failure（phase !== pending）下不带真实 disabled 属性
    // （className 的 `disabled:bg-slate-400` token 不算，故精确匹配 disabled=""）
    expect(markup).not.toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-cta-all"[^>]*disabled=""/
    );
  });

  it("failure 文案随 locale（zh-CN / en-US）切换", () => {
    const tree = makeTree([makeNode("n-1", "A")]);
    const zh = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        generationError={{ message: "boom" }}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    const en = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="en-US"
        generating={null}
        generationError={{ message: "boom" }}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(zh).toContain("生成失败，请重试");
    expect(zh).not.toContain("Generation failed, please retry");
    expect(en).toContain("Generation failed, please retry");
    expect(en).not.toContain("生成失败，请重试");
  });

  it("failure 态保留既有树/节点内容容器不清空（R2.11）", () => {
    const tree = makeTree([
      makeNode("n-1", "Auth"),
      makeNode("n-2", "Profile"),
    ]);
    const docs = [makeDoc("n-1", "requirements", "reviewing")];
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={docs}
        locale="zh-CN"
        generating={null}
        generationError={{ message: "boom" }}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    // 失败块与既有树内容并存：节点行列表 / 行 / chip 均未被清空
    expect(markup).toContain('data-testid="spec-tree-workbench-failure"');
    expect(markup).toContain('data-testid="spec-tree-workbench-list"');
    expect(markup).toContain('data-node-id="n-1"');
    expect(markup).toContain('data-node-id="n-2"');
    expect(markup).toContain("Auth");
    expect(markup).toContain("Profile");
    // n-1 的稳定 doc chip 仍然渲染（内容未被失败态清空）
    expect(markup).toContain("1/3 reviewing");
  });
});

describe("SpecTreeWorkbench 反馈渲染 (Task 4.4) — 源代码层契约", () => {
  async function readSource(): Promise<string> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    return fs.readFile(
      path.resolve(__dirname, "../SpecTreeWorkbench.tsx"),
      "utf8"
    );
  }

  // ── 点击同步置入乐观标记 → 同一 act 内即 pending（R1.4 / 5.4，免异步等待） ──
  it("CTA 点击 handler 在调用父级回调前同步置入乐观标记（all / single）", async () => {
    const source = await readSource();
    // all：先 setOptimistic({ scope: "all", ... }) 再 onGenerateAll()
    expect(source).toMatch(
      /setOptimistic\(\{ scope: "all", startedAt: performance\.now\(\) \}\);[\s\S]*?onGenerateAll\(\);/
    );
    // single：先 setOptimistic({ scope: "single", ... }) 再 onGenerateNode(...)
    expect(source).toMatch(
      /setOptimistic\(\{ scope: "single", startedAt: performance\.now\(\) \}\);[\s\S]*?onGenerateNode\(selectedNodeId\);/
    );
  });

  // ── 乐观 → 权威单帧交接：phase 离开 pending 即清除乐观标记（R5.4） ─────────
  it("phase 离开 pending 时同帧清除乐观标记（不残留中间帧）", async () => {
    const source = await readSource();
    expect(source).toMatch(/optimistic !== null && phase !== "pending"/);
    expect(source).toMatch(/setOptimistic\(null\)/);
  });

  // ── 失败重试以「上次失败的 scope」调用 onRetry（R2.6 / R2.7） ──────────────
  it("重试入口经 onRetry(lastScope, nodeId) 以上次 scope 重新发起", async () => {
    const source = await readSource();
    // 点击时记忆上次发起范围
    expect(source).toMatch(/lastGenerationRef\.current = \{ scope: "all" \}/);
    expect(source).toMatch(
      /lastGenerationRef\.current = \{ scope: "single", nodeId: selectedNodeId \}/
    );
    // 重试以记忆到的 scope + nodeId 调用父级 onRetry
    expect(source).toMatch(/onRetry\(last\.scope, last\.nodeId\)/);
    // 重试按钮存在且仅在 failure + 有上次 scope + 父级提供 onRetry 时渲染
    expect(source).toContain('data-testid="spec-tree-workbench-retry"');
    expect(source).toMatch(
      /onRetry !== undefined && lastGenerationRef\.current !== null/
    );
  });

  // ── 三态终态文案随 locale（R2.10）：success / empty / failure 均有 zh+en ──
  it("success / empty / failure 三态文案在源码中均含 zh-CN 与 en-US", async () => {
    const source = await readSource();
    // success
    expect(source).toContain("文档已生成");
    expect(source).toContain("Docs generated");
    // empty
    expect(source).toContain("本次生成未返回任何节点文档");
    expect(source).toContain("This generation returned no node documents");
    // failure
    expect(source).toContain("生成失败，请重试");
    expect(source).toContain("Generation failed, please retry");
    // success/empty 分支渲染对应 testid
    expect(source).toContain('data-testid="spec-tree-workbench-success"');
    expect(source).toContain('data-testid="spec-tree-workbench-empty"');
  });

  // ── 终态分支不卸载既有树（节点行 <ul> 在 phase 条件块之外，R2.11） ─────────
  it("节点行列表渲染于 phase 反馈块之外，failure/empty 不清空既有内容", async () => {
    const source = await readSource();
    const listAnchor = source.indexOf('data-testid="spec-tree-workbench-list"');
    const failureAnchor = source.indexOf(
      'data-testid="spec-tree-workbench-failure"'
    );
    const emptyResultAnchor = source.indexOf(
      'data-testid="spec-tree-workbench-empty"'
    );
    expect(listAnchor).toBeGreaterThan(-1);
    expect(failureAnchor).toBeGreaterThan(-1);
    expect(emptyResultAnchor).toBeGreaterThan(-1);
    // 列表锚点位于 failure / empty 反馈块之后，且不被它们包裹（始终渲染）。
    expect(listAnchor).toBeGreaterThan(failureAnchor);
    expect(listAnchor).toBeGreaterThan(emptyResultAnchor);
  });

  // ── 成功路径不直接写业务真相源：组件不维护独立业务并发/数据副本（R5.1） ────
  it("组件不持有 job/specDocuments 业务数据副本，亦不向真相源回写", async () => {
    const source = await readSource();
    // 唯一新增的 useState 是瞬态 UI（optimistic）与超时计时（now）；
    // 不存在持有业务文档/job 的第二份 useState 副本。
    expect(source).toMatch(/useState<OptimisticMark \| null>/);
    expect(source).not.toMatch(/useState<[^>]*BlueprintSpecDocument/);
    expect(source).not.toMatch(/useState<[^>]*BlueprintGenerationJob/);
    // 不旁路真相源：组件内不直接 setLatestJob / 写 store。
    expect(source).not.toContain("setLatestJob");
    expect(source).not.toMatch(/\.setState\(/);
    // specDocsProgress 仅作为只读进度来源消费（不订阅写入）。
    expect(source).toMatch(
      /useBlueprintRealtimeStore\(s => s\.specDocsProgress\)/
    );
  });
});
