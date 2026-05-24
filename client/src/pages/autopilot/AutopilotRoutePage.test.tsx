import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectState } = vi.hoisted(() => ({
  projectState: {
    currentProjectId: null as string | null,
    projects: [] as any[],
  },
}));

import AutopilotRoutePage, {
  AutopilotSpecTreeHandoffPanel,
  resolveActiveAutopilotPage,
  resolveAutopilotPageProjection,
  resolveHistoryActiveJobIdForCurrentJob,
  resolveHistoryUrlSelectedJob,
  resolveVisibleWorkflowStepId,
} from "./AutopilotRoutePage";
import { AutopilotRightRail } from "./right-rail";
import { PROJECTS_PATH } from "@/components/navigation-config";
import { useAppStore } from "@/lib/store";

vi.mock("@/components/Scene3D", () => ({
  Scene3D: ({
    performanceProfile,
    projectId,
    mode,
  }: {
    performanceProfile?: string;
    projectId?: string | null;
    mode?: string;
  }) => (
    <div
      data-testid="mock-scene-3d"
      data-performance-profile={performanceProfile}
      data-project-id={projectId ?? ""}
      data-scene-mode={mode ?? ""}
    />
  ),
}));

vi.mock("@/lib/project-store", () => ({
  useProjectStore: (selector: (state: typeof projectState) => unknown) =>
    selector(projectState),
}));

describe("AutopilotRoutePage", () => {
  beforeEach(() => {
    projectState.currentProjectId = null;
    projectState.projects = [];
    useAppStore.setState({ locale: "zh-CN" });
  });

  it("renders the 3D scene, scene HUD, and sequential workflow in Chinese", () => {
    projectState.currentProjectId = "project-1";
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
      },
    ];

    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    expect(markup).toContain('data-testid="autopilot-route-page"');
    expect(markup).toContain('data-testid="autopilot-topbar"');
    expect(markup).toContain('data-testid="autopilot-visual-stage"');
    expect(markup).toContain('data-testid="autopilot-scene-visual"');
    expect(markup).toContain('data-testid="mock-scene-3d"');
    expect(markup).toContain('data-project-id="project-1"');
    // Wave A：自动驾驶 3D 场景融合 — 蓝图页 Scene3D 必须以 mode="blueprint" 挂载，
    // 让 MissionIsland 在蓝图页隐藏，避免 mission-first 任务岛残影。
    expect(markup).toContain('data-scene-mode="blueprint"');
    expect(markup).not.toContain('data-testid="autopilot-experience-rail"');
    // HUD 浮层已移除(指标卡固定在右栏底部);testid 不再存在于 3D 场景中
    expect(markup).not.toContain('data-testid="autopilot-mission-hud"');
    expect(markup).toContain('data-testid="autopilot-workflow-rail"');
    expect(markup).toContain('data-testid="autopilot-workflow-steps"');
    expect(markup).toContain('data-testid="autopilot-step-input"');
    expect(markup).toContain('data-testid="autopilot-runtime-console"');
    // Spec 3: advanced workbenches fold and inline blueprint progress panel removed.
    expect(markup).not.toContain('data-testid="autopilot-advanced-workbenches"');
    expect(markup).not.toContain('data-testid="blueprint-progress-panel"');
    // 2026-05-19：移除顶部 antd Steps 横向步骤条（"输入 / 编组"）。
    // 默认 input 阶段下右栏 StageHeader / StreamingDocRenderer 不渲染，
    // 故仅断言不再含 ant-steps-horizontal class 即可证明移除生效。
    expect(markup).toContain("Permission System");
    expect(markup).not.toContain("ant-steps-horizontal");
    expect(markup).toContain('data-testid="autopilot-workflow-rail"');
    expect(markup).not.toContain("自动驾驶画布");
    expect(markup).not.toContain(
      'data-testid="autopilot-generate-clarifications-button"'
    );
    expect(markup).not.toContain(
      'data-testid="autopilot-generate-routeset-button"'
    );
    expect(markup).not.toContain("RouteSet generation and selection");
  });

  it("lets a page-level override return from fabric to the route-generation workflow page", () => {
    const flowSteps = [
      {
        id: "input",
        index: 1,
        title: "Input",
        detail: "Route selected",
        status: "done",
        icon: (() => null) as any,
      },
      {
        id: "fabric",
        index: 2,
        title: "Fabric",
        detail: "SPEC ready",
        status: "active",
        icon: (() => null) as any,
      },
    ];

    expect(resolveVisibleWorkflowStepId(flowSteps as any, null)).toBe("fabric");
    expect(resolveVisibleWorkflowStepId(flowSteps as any, "input")).toBe("input");
  });

  it("treats a pinned SPEC-tree review as page 2 even when the backend job is already downstream", () => {
    expect(
      resolveActiveAutopilotPage({
        workflowStageOverride: null,
        hasSelection: true,
        latestJobStage: "runtime_capability",
        effectiveSubStage: "runtime_capability",
      })
    ).toBe(3);

    expect(
      resolveActiveAutopilotPage({
        workflowStageOverride: null,
        hasSelection: true,
        latestJobStage: "runtime_capability",
        effectiveSubStage: "spec_tree",
      })
    ).toBe(2);

    expect(
      resolveActiveAutopilotPage({
        workflowStageOverride: "input",
        hasSelection: true,
        latestJobStage: "runtime_capability",
        effectiveSubStage: "spec_tree",
      })
    ).toBe(1);
  });

  it("projects downstream runtime state back to the input / clarification / route page without leaking later artifacts", () => {
    const runtimeJob = {
      id: "job-runtime",
      request: { mode: "runtime_capability" },
      status: "reviewing",
      stage: "runtime_capability",
      version: "v1",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:01:00.000Z",
      artifacts: [
        { id: "route-set", type: "route_set" },
        { id: "tree", type: "spec_tree" },
        { id: "preview", type: "effect_preview" },
        { id: "capability", type: "capability_registry" },
      ],
      events: [
        { id: "route-event", stage: "route_generation" },
        { id: "runtime-event", stage: "runtime_capability" },
      ],
    } as any;

    const projection = resolveAutopilotPageProjection({
      activeAutopilotPage: 1,
      latestJob: runtimeJob,
      specTree: { id: "tree", nodes: [{ id: "root" }] } as any,
      agentCrew: { id: "crew" } as any,
      capabilities: [{ id: "capability" }] as any,
      capabilityInvocations: [{ id: "invocation" }] as any,
      capabilityEvidence: [{ id: "evidence" }] as any,
      effectPreviews: [{ id: "preview" }] as any,
    });

    expect(projection.visualJob?.stage).toBe("route_generation");
    expect(projection.consoleJob?.stage).toBe("route_generation");
    expect(projection.visualJob?.status).toBe("completed");
    expect(projection.visualJob?.events.map(event => event.id)).toEqual([
      "route-event",
    ]);
    expect(projection.visualJob?.artifacts.map(artifact => artifact.id)).toEqual([
      "route-set",
    ]);
    expect(projection.visualSpecTree).toBeNull();
    expect(projection.visualAgentCrew).toBeNull();
    expect(projection.visualCapabilities).toEqual([]);
    expect(projection.visualCapabilityInvocations).toEqual([]);
    expect(projection.visualCapabilityEvidence).toEqual([]);
    expect(projection.visualEffectPreviews).toEqual([]);
  });

  it("projects a pinned SPEC review to the merged SPEC tree / documents page and hides effect-preview runtime data", () => {
    const runtimeJob = {
      id: "job-runtime",
      request: { mode: "runtime_capability" },
      status: "reviewing",
      stage: "runtime_capability",
      version: "v1",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:01:00.000Z",
      artifacts: [
        { id: "route-set", type: "route_set" },
        { id: "tree", type: "spec_tree" },
        { id: "doc", type: "spec_document_version" },
        { id: "preview", type: "effect_preview" },
        { id: "capability", type: "capability_registry" },
      ],
      events: [
        { id: "spec-event", stage: "spec_tree" },
        { id: "docs-event", stage: "spec_docs" },
        { id: "runtime-event", stage: "runtime_capability" },
      ],
    } as any;
    const specTree = { id: "tree", nodes: [{ id: "root" }] } as any;
    const agentCrew = { id: "crew" } as any;

    const projection = resolveAutopilotPageProjection({
      activeAutopilotPage: 2,
      latestJob: runtimeJob,
      specTree,
      agentCrew,
      capabilities: [{ id: "capability" }] as any,
      capabilityInvocations: [{ id: "invocation" }] as any,
      capabilityEvidence: [{ id: "evidence" }] as any,
      effectPreviews: [{ id: "preview" }] as any,
    });

    expect(projection.visualJob?.stage).toBe("spec_tree");
    expect(projection.consoleJob?.stage).toBe("spec_tree");
    expect(projection.visualJob?.events.map(event => event.id)).toEqual([
      "spec-event",
      "docs-event",
    ]);
    expect(projection.visualJob?.artifacts.map(artifact => artifact.id)).toEqual([
      "tree",
      "doc",
    ]);
    expect(projection.visualSpecTree).toBe(specTree);
    expect(projection.visualAgentCrew).toBe(agentCrew);
    expect(projection.visualCapabilities).toEqual([]);
    expect(projection.visualCapabilityInvocations).toEqual([]);
    expect(projection.visualCapabilityEvidence).toEqual([]);
    expect(projection.visualEffectPreviews).toEqual([]);
  });

  it("wires right-rail workflow back requests into the outer workflow page override", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );

    expect(source).toMatch(/workflowStageOverride/);
    expect(source).toMatch(/resolveVisibleWorkflowStepId\(\s*flowSteps,\s*workflowStageOverride\s*\)/);
    expect(source).toMatch(/const\s+handleNavigateWorkflowStage\s*=\s*useCallback/);
    expect(source).toMatch(/subStageState\.resetPin\(\)/);
    expect(source).toMatch(/onNavigateWorkflowStage=\{handleNavigateWorkflowStage\}/);
  });

  it("wires the route page fabric stage into the merged right rail continuation", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );

    expect(source).toContain("AutopilotRightRail");
    expect(source).toContain("fabricSubStage={fabricSubStage}");
    expect(source).toContain("rightRailView={rightRailView}");
    expect(source).toContain("onForceAdvance={autoAdvance.forceAdvance}");
    expect(source).toContain("onNavigateWorkflowStage={handleNavigateWorkflowStage}");
  });

  it("wires the right-rail history entry into an actual version history panel", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const routeSource = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );
    const railSource = await fs.readFile(
      path.resolve(__dirname, "./right-rail/AutopilotRightRail.tsx"),
      "utf8"
    );

    expect(routeSource).toMatch(/AUTOPILOT_HISTORY_OPEN_EVENT/);
    expect(routeSource).toMatch(/readAutopilotHistoryOpenFromLocation/);
    expect(routeSource).toMatch(/data-testid="autopilot-version-history-panel"/);
    expect(routeSource).toMatch(/<VersionTreeView/);
    expect(routeSource).toMatch(/<ReplanTimelineView/);
    expect(routeSource).toMatch(/<CompareView/);
    expect(routeSource).toMatch(/resolveHistoryUrlSelectedJob/);
    expect(routeSource).toMatch(/appliedHistoryJobIdRef/);
    expect(railSource).toMatch(/autopilot:history-open/);
    expect(railSource).toMatch(/window\.dispatchEvent/);
  });

  it("resolves a deep-linked active history job that differs from the current rail job", () => {
    expect(
      resolveHistoryUrlSelectedJob({
        requestedJobId: "root-job",
        currentJobId: "child-job",
        activeJob: { id: "root-job" } as any,
      })?.id
    ).toBe("root-job");

    expect(
      resolveHistoryUrlSelectedJob({
        requestedJobId: null,
        currentJobId: "child-job",
        activeJob: { id: "root-job" } as any,
      })
    ).toBeNull();
    expect(
      resolveHistoryUrlSelectedJob({
        requestedJobId: "root-job",
        currentJobId: "root-job",
        activeJob: { id: "root-job" } as any,
      })
    ).toBeNull();
    expect(
      resolveHistoryUrlSelectedJob({
        requestedJobId: "missing-job",
        currentJobId: "child-job",
        activeJob: { id: "root-job" } as any,
      })
    ).toBeNull();
  });

  it("keeps history selection synced when the current job changes to a replan branch", () => {
    expect(
      resolveHistoryActiveJobIdForCurrentJob({
        requestedJobId: "branch-job",
        currentJobId: "branch-job",
        activeJobId: "parent-job",
      })
    ).toBe("branch-job");

    expect(
      resolveHistoryActiveJobIdForCurrentJob({
        requestedJobId: null,
        currentJobId: "branch-job",
        activeJobId: "parent-job",
      })
    ).toBe("branch-job");

    expect(
      resolveHistoryActiveJobIdForCurrentJob({
        requestedJobId: "root-job",
        currentJobId: "child-job",
        activeJobId: "root-job",
      })
    ).toBe("root-job");
  });

  it("wires branch replan activation into history active-job synchronization", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const routeSource = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );
    const railSource = await fs.readFile(
      path.resolve(__dirname, "./right-rail/AutopilotRightRail.tsx"),
      "utf8"
    );

    expect(routeSource).toMatch(/handleReplanBranchJobActivated/);
    expect(routeSource).toMatch(/setAutopilotHistoryActiveJob\(job\.id\)/);
    expect(routeSource).toMatch(/onBranchJobActivated=\{handleReplanBranchJobActivated\}/);
    expect(railSource).toMatch(/onBranchJobActivated/);
  });

  it("restores the live latest job snapshot when closing a history-selected job", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const routeSource = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );
    const closeHandler = routeSource.slice(
      routeSource.indexOf("const handleCloseHistoryPanel"),
      routeSource.indexOf("const railStepLabel")
    );

    expect(routeSource).toMatch(/const refreshLatestGenerationSnapshot\s*=\s*useCallback/);
    expect(routeSource).toMatch(/fetchLatestBlueprintGenerationJob\(\{\s*projectId:\s*currentProjectId\s*\?\?\s*undefined,\s*\}\)/);
    expect(routeSource).toMatch(/onHistoryPanelClosed=\{async \(\) => \{\s*await refreshLatestGenerationSnapshot\(\);\s*\}\}/);
    expect(closeHandler).toMatch(/closeAutopilotHistorySearch\(\)/);
    expect(closeHandler).toMatch(/setHistoryPanelOpen\(false\)/);
    expect(closeHandler).toMatch(/void onHistoryPanelClosed\?\.\(\)/);
  });

  it("wires page-level edit mode and transition coordination into the high-conflict shells", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const routeSource = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );
    const railSource = await fs.readFile(
      path.resolve(__dirname, "./right-rail/AutopilotRightRail.tsx"),
      "utf8"
    );

    expect(routeSource).toMatch(/EditModeField/);
    expect(routeSource).toMatch(/patchBlueprintIntake/);
    expect(routeSource).toMatch(/runInlineEditFlow/);
    expect(routeSource).toMatch(/handleSubmitTargetEdit/);
    expect(routeSource).toMatch(/handleSubmitClarificationEdit/);
    expect(routeSource).toMatch(/PageTransitionWrapper/);
    expect(routeSource).toMatch(/usePageTransitionChoreographer/);
    expect(routeSource).toMatch(/useAutopilotCoordination/);
    expect(routeSource).toMatch(/useToastQueue/);
    expect(routeSource).toMatch(/coordinator=\{autopilotCoordinator\}/);
    expect(routeSource).toMatch(/coordinator:\s*autopilotCoordinator/);
    expect(routeSource).toMatch(/refreshJob:\s*\(editResult\)\s*=>/);
    expect(routeSource).toMatch(/onNavigateWorkflowStage\("fabric"\)/);
    expect(routeSource).toMatch(/isViewingCompletedStage=\{Boolean\(selection\)\}/);
    expect(railSource).toMatch(/useStageTransitionAnimator/);
    expect(railSource).toMatch(/stageAnimatorDirection/);
    expect(railSource).toMatch(/direction=\{stageAnimatorDirection \?\? transitionDirection\}/);
    expect(railSource).toMatch(/coordinator:\s*props\.coordinator/);
    expect(railSource).toMatch(/getCoordinationTransitions/);
  });

  it("routes clarification answer edits through the same coordinated inline edit flow", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const routeSource = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );
    const clarificationHandler = routeSource.slice(
      routeSource.indexOf("const handleSubmitClarificationEdit"),
      routeSource.indexOf("const handleCreateIntake")
    );

    expect(clarificationHandler).toMatch(/runInlineEditFlow/);
    expect(clarificationHandler).toMatch(/coordinator:\s*autopilotCoordinator/);
    expect(clarificationHandler).toMatch(/refreshJob:\s*\(editResult\)\s*=>/);
    expect(clarificationHandler).toMatch(/rightRailView\.job\.retry\(\)/);
  });

  it("exposes the top breadcrumb parent as a project-space return link", () => {
    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    expect(markup).toContain('data-testid="autopilot-back-to-project-space"');
    expect(markup).toContain(`href="${PROJECTS_PATH}"`);
    expect(markup).toContain('aria-label="返回项目空间"');
  });

  it("keeps the scene visible behind the operational workspace", () => {
    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    expect(markup).toContain("pointer-events-none absolute inset-0");
    expect(markup).toContain('data-autopilot-stage="input"');
    expect(markup).toContain('data-autopilot-route-state="pending"');
    expect(markup).toContain('data-autopilot-crew-state="pending"');
    expect(markup).toContain('data-testid="autopilot-runtime-console"');
    // 自动驾驶 3D 场景融合 follow-up（2026-05-13 v8 console stack）：
    // AutopilotConsolePanel 从 visual stage 内 absolute 浮层改为独立 stacked
    // section，xl 模式 flex-1 填高。原断言 "absolute bottom-4 left-4 right-4 z-10"
    // / "bg-slate-950/82" 不再适用，改为断言 stack 语义关键 class。
    expect(markup).toContain('data-testid="autopilot-visual-stage"');
    expect(markup).toContain("xl:flex-1 xl:min-h-0");
    expect(markup).toContain("xl:h-full");
    expect(markup).not.toContain("radial-gradient");
    expect(markup).not.toContain("linear-gradient(180deg");
    expect(markup).not.toContain("opacity-35");
  });

  it("renders the autopilot console as a fixed-height full-width bottom panel without mini fold or rounded overlay", () => {
    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    expect(markup).toContain('data-testid="autopilot-runtime-console"');
    expect(markup).toContain("w-full");
    expect(markup).toContain("h-[320px]");
    expect(markup).toContain("shrink-0");
    expect(markup).not.toContain('data-testid="autopilot-runtime-console-mini"');
    expect(markup).not.toContain('data-testid="autopilot-runtime-console-expanded"');
    expect(markup).not.toContain("Expand runtime console");
    expect(markup).not.toContain("Collapse runtime console");
    expect(markup).not.toContain("rounded-[10px]");
    expect(markup).not.toContain("rounded-[12px]");
  });

  it("switches the core chrome to English without mixing the main labels", () => {
    useAppStore.setState({ locale: "en-US" });

    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    expect(markup).not.toContain("Autopilot canvas");
    expect(markup).toContain("Project autopilot");
    // 2026-05-19：antd Steps 横向步骤条已移除（输入/编组 两步）。
    // 默认 input 阶段下右栏的 StageHeader / StreamingDocRenderer 不渲染，
    // 故仅断言不再含 ant-steps-horizontal class 即可证明移除生效。
    expect(markup).not.toContain("ant-steps-horizontal");
    expect(markup).toContain('data-testid="autopilot-workflow-rail"');
    expect(markup).toContain("Autopilot console");
    // Spec 3: advanced workbenches fold copy removed.
    expect(markup).not.toContain("Advanced asset workbenches");
    expect(markup).not.toContain(
      "Expand for SPEC, previews, prompts, capability bridge, and replay"
    );
    expect(markup).toContain("Create intake");
    expect(markup).toContain("Goal");
    expect(markup).not.toContain("鑷姩椹鹃┒鐢诲竷");
  });

  it("no longer renders the advanced workbenches fold (Spec 3 E2)", () => {
    const markup = renderToStaticMarkup(<AutopilotRoutePage />);

    // E2: fold-removal snapshot.
    expect(markup).not.toContain('data-testid="autopilot-advanced-workbenches"');
    expect(markup).not.toContain('data-testid="blueprint-progress-panel"');
    expect(markup).not.toContain("高级资产工作台");
    expect(markup).not.toContain("Advanced asset workbenches");
    expect(markup).not.toContain(
      "展开查看 SPEC、预演、提示词、能力桥和回放"
    );
    expect(markup).not.toContain(
      "Expand for SPEC, previews, prompts, capability bridge, and replay"
    );
  });

  it("does not wire any navigation in the selection -> fabric transition (Spec 3 E1)", async () => {
    // E1: route selection must NOT navigate away from /autopilot. This is a
    // structural property: AutopilotRoutePage must not import useNavigate,
    // window.location.assign, or window.location.replace. With no @testing-library/react
    // available, we assert the property by reading the source file itself.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/useNavigate/);
    expect(source).not.toMatch(/window\.location\.assign/);
    expect(source).not.toMatch(/window\.location\.replace/);
    expect(source).not.toMatch(/window\.location\.href\s*=/);
  });

  it("hydrates the cockpit from the latest backend blueprint job on mount", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );

    expect(source).toMatch(/fetchLatestBlueprintGenerationJob/);
    expect(source).toMatch(/fetchLatestBlueprintGenerationJob\(\{\s*projectId:\s*currentProjectId\s*\?\?\s*undefined,\s*\}\)/);
    expect(source).toMatch(/const applyLatestGenerationSnapshot\s*=\s*useCallback/);
    expect(source).toMatch(/applyLatestGenerationSnapshot\(\s*result\.data\s*\)/);

    const helperStart = source.indexOf("const applyLatestGenerationSnapshot");
    const helperEnd = source.indexOf("useEffect(() => {", helperStart);
    const helperSource = source.slice(helperStart, helperEnd);
    expect(helperSource).toMatch(/setLatestJob\(\s*snapshot\.job\s*\)/);
    expect(helperSource).toMatch(/setRouteSet\(\s*snapshot\.routeSet\s*\?\?\s*null\s*\)/);
    expect(helperSource).toMatch(/setSelection\(\s*snapshot\.selection\s*\?\?\s*null\s*\)/);
    expect(helperSource).toMatch(/setSpecTree\(\s*snapshot\.specTree\s*\?\?\s*null\s*\)/);
    expect(helperSource).toMatch(/setIntake\(\s*snapshot\.intake\s*\)/);
    expect(helperSource).toMatch(/resetLatestGenerationSnapshot\(\)/);
    expect(helperSource).toMatch(/setProjectContext\(\s*snapshot\.projectContext\s*\?\?\s*null\s*\)/);
  });

  it("uses the GitHub Pages static blueprint runtime without remote right-rail fetches", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );

    expect(source).toMatch(/IS_GITHUB_PAGES/);
    expect(source).toMatch(/getGithubPagesBlueprintDemoRuntime/);
    expect(source).toMatch(/fetchLatestGenerationJob/);
    expect(source).toMatch(/createIntake/);
    expect(source).toMatch(/createClarificationSession/);
    expect(source).toMatch(/createGenerationJob/);
    expect(source).toMatch(/selectRoute/);
    expect(source).toMatch(/disableRemoteFetch:\s*IS_GITHUB_PAGES/);
  });

  it("routes GitHub Pages downstream generation through the static runtime", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "./AutopilotRoutePage.tsx"),
      "utf8"
    );

    expect(source).toMatch(/generationActions:\s*pagesBlueprintRuntime/);
    expect(source).toMatch(/generateSpecDocuments:\s*pagesBlueprintRuntime\.generateSpecDocuments/);
    expect(source).toMatch(/generateEffectPreview:\s*pagesBlueprintRuntime\.generateEffectPreviews/);
    expect(source).toMatch(/generatePromptPackages:\s*pagesBlueprintRuntime\.generatePromptPackages/);
    expect(source).toMatch(/generateEngineeringLanding:\s*pagesBlueprintRuntime\.generateEngineeringLanding/);
    expect(source).toMatch(/generateSpecDocuments=\{pagesBlueprintRuntime\?\.generateSpecDocuments\}/);
    expect(source).toMatch(/refreshPagesBlueprintSnapshot/);
  });

  describe("fabric stage right rail (Spec 3 T08)", () => {
    it("mounts <AutopilotRightRail> with data-testid=\"autopilot-right-rail\" under fabric stage", () => {
      const markup = renderToStaticMarkup(
        <AutopilotRightRail
          jobId="job-1"
          currentStage="fabric"
          currentSubStage="agent_crew_fabric"
          job={
            {
              id: "job-1",
              stage: "agent_crew_fabric",
            } as any
          }
          routeSet={null}
          selection={
            {
              id: "sel-1",
              routeTitle: "Primary",
            } as any
          }
          specTree={null}
          agentCrew={null}
          capabilities={[]}
          capabilityInvocations={[]}
          capabilityEvidence={[]}
          effectPreviews={[]}
          locale="zh-CN"
          onSubStageChange={() => {}}
        />
      );

      expect(markup).toContain('data-testid="autopilot-right-rail"');
      expect(markup).toContain('data-autopilot-stage="fabric"');
      expect(markup).toContain('data-autopilot-sub-stage="agent_crew_fabric"');
    });
  });

  it("explains that SPEC tree reviewing is a handoff state, not a stuck run", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecTreeHandoffPanel
        locale="en-US"
        job={
          {
            id: "job-1",
            stage: "spec_tree",
            status: "reviewing",
          } as any
        }
        selection={
          {
            routeTitle: "Primary SPEC asset route",
          } as any
        }
        specTree={
          {
            nodes: [{ id: "root" }, { id: "node-1" }],
          } as any
        }
      />
    );

    expect(markup).toContain('data-testid="autopilot-spec-tree-handoff"');
    expect(markup).toContain(
      "RouteSet selected; SPEC tree draft is waiting for review"
    );
    expect(markup).toContain("not the end");
    expect(markup).toContain("2 node");
    expect(markup).toContain('href="/specs"');
    // Spec 3 T06: CTA demoted from primary button to secondary text link.
    expect(markup).toContain("View in standalone workbench");
    expect(markup).not.toContain("Open deduction workbench");
  });

  it("uses the demoted Chinese text link for SPEC handoff CTA (Spec 3 T06 zh-CN)", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecTreeHandoffPanel
        locale="zh-CN"
        job={
          {
            id: "job-1",
            stage: "spec_tree",
            status: "reviewing",
          } as any
        }
        selection={
          {
            routeTitle: "主 SPEC 资产路线",
          } as any
        }
        specTree={
          {
            nodes: [{ id: "root" }, { id: "node-1" }],
          } as any
        }
      />
    );

    expect(markup).toContain('href="/specs"');
    expect(markup).toContain('data-testid="autopilot-open-specs-link"');
    expect(markup).toContain("在独立工作台查看");
    expect(markup).not.toContain("进入推导工作台");
  });
});
