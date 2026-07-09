import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROJECT_STORE_STORAGE_KEY,
  deriveProjectSpecCompleteness,
  migrateProjectStoreSnapshot,
  summarizeProjectSpecVersionDiff,
  useProjectStore,
} from "./project-store";
import {
  buildMissionPlanFromRoute,
  buildProjectRoutePlan,
} from "./project-route-planner";
import { buildInitialProjectSpecDraft } from "./project-spec-draft";

function createLocalStorageMock(): Storage {
  let data: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear: vi.fn(() => {
      data = {};
    }),
    getItem: vi.fn((key: string) => data[key] ?? null),
    key: vi.fn((index: number) => Object.keys(data)[index] ?? null),
    removeItem: vi.fn((key: string) => {
      delete data[key];
    }),
    setItem: vi.fn((key: string, value: string) => {
      data[key] = String(value);
    }),
  };
}

describe("project-store", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock(),
    });
    window.localStorage.clear();
    useProjectStore.getState().reset();
  });

  it("creates and selects a project from a goal", () => {
    const project = useProjectStore.getState().createProject({
      goal: "Build a permission management system with RBAC and audit logs.",
    });

    const state = useProjectStore.getState();
    expect(state.currentProjectId).toBe(project.id);
    expect(state.projects).toHaveLength(1);
    expect(project.name).toContain("Build a permission management");
    expect(state.getCurrentProject()?.id).toBe(project.id);
  });

  it("assigns ownerUserId when creating a project with an authenticated owner", () => {
    useProjectStore.getState().setActiveOwnerForTest("user-1");

    const project = useProjectStore.getState().createProject({
      goal: "Build auth",
    });

    expect(project.ownerUserId).toBe("user-1");
    expect(useProjectStore.getState().getVisibleProjects()).toEqual([project]);
  });

  it("keeps current project selection scoped to the active owner", () => {
    useProjectStore.getState().setActiveOwnerForTest("user-1");
    const first = useProjectStore.getState().createProject({ goal: "First" });
    useProjectStore.getState().setActiveOwnerForTest("user-2");
    const second = useProjectStore.getState().createProject({ goal: "Second" });

    expect(first.ownerUserId).toBe("user-1");
    expect(second.ownerUserId).toBe("user-2");
    expect(useProjectStore.getState().currentProjectId).toBe(second.id);
    expect(useProjectStore.getState().getCurrentProject()?.id).toBe(second.id);
    expect(useProjectStore.getState().getVisibleProjects()).toEqual([second]);

    useProjectStore.getState().setActiveOwnerForTest("user-1");

    expect(useProjectStore.getState().currentProjectId).toBe(first.id);
    expect(useProjectStore.getState().getCurrentProject()?.id).toBe(first.id);
    expect(useProjectStore.getState().getVisibleProjects()).toEqual([first]);
  });

  it("binds legacy local projects to the first authenticated owner", () => {
    const legacy = useProjectStore.getState().createProject({
      goal: "Legacy local project",
    });
    expect(legacy.ownerUserId).toBeUndefined();

    useProjectStore.getState().setActiveOwnerForTest("user-1");

    const migratedProject = useProjectStore.getState().projects[0];
    expect(migratedProject).toMatchObject({
      id: legacy.id,
      ownerUserId: "user-1",
    });
    expect(useProjectStore.getState().getCurrentProject()?.id).toBe(legacy.id);
  });

  it("does not select or expose projects owned by a different user", () => {
    useProjectStore.getState().setActiveOwnerForTest("user-1");
    const first = useProjectStore.getState().createProject({ goal: "First" });
    useProjectStore.getState().setActiveOwnerForTest("user-2");
    const second = useProjectStore.getState().createProject({ goal: "Second" });

    useProjectStore.getState().selectProject(first.id);

    expect(useProjectStore.getState().currentProjectId).toBeNull();
    expect(useProjectStore.getState().getProjectBundle(first.id)).toBeNull();
    expect(useProjectStore.getState().getVisibleProjects()).toEqual([second]);
  });

  it("persists and hydrates the current project snapshot", () => {
    const project = useProjectStore.getState().createProject({
      name: "Permission System",
      goal: "Build RBAC.",
    });

    const raw = window.localStorage.getItem(PROJECT_STORE_STORAGE_KEY);
    expect(raw).toContain(project.id);

    useProjectStore.setState({
      ready: false,
      currentProjectId: null,
      projects: [],
      messages: [],
      clarificationQuestions: [],
      specs: [],
      routes: [],
      missions: [],
      artifacts: [],
      evidence: [],
    });

    useProjectStore.getState().ensureReady();

    expect(useProjectStore.getState().currentProjectId).toBe(project.id);
    expect(useProjectStore.getState().projects[0]?.name).toBe(
      "Permission System"
    );
  });

  it("migrates older snapshots without clarification questions", () => {
    const snapshot = migrateProjectStoreSnapshot({
      schemaVersion: 1,
      currentProjectId: "project-1",
      projects: [],
      messages: [],
      specs: [],
      routes: [],
      missions: [],
      artifacts: [],
      evidence: [],
    });

    expect(snapshot.clarificationQuestions).toEqual([]);
  });

  it("stores messages, specs, routes, missions, artifacts and evidence in a project bundle", () => {
    const project = useProjectStore.getState().createProject({
      name: "Permission System",
      goal: "Build RBAC.",
    });
    const message = useProjectStore.getState().addProjectMessage({
      projectId: project.id,
      role: "user",
      content: "Need RBAC and ABAC hybrid permissions.",
    });
    const clarificationQuestion =
      useProjectStore.getState().addProjectClarificationQuestion({
        projectId: project.id,
        text: "Which identity provider must be supported?",
        reason: "Authentication scope changes the implementation route.",
        scope: "tech",
        answerType: "single",
        options: ["Okta", "Azure AD", "Custom SSO"],
        required: true,
        sourceCommandId: "cmd-1",
        sourceQuestionId: "q-identity",
        sourceMessageId: message?.id,
      });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Permission System Spec",
      content: "# Spec",
      sourceMessageIds: message ? [message.id] : [],
      completeness: 0.5,
    });
    const route = useProjectStore.getState().addProjectRoute({
      projectId: project.id,
      specId: spec?.id,
      kind: "recommended",
      title: "Spec-first route",
      summary: "Clarify spec, then execute.",
      selected: true,
    });
    const mission = useProjectStore.getState().linkMissionToProject({
      projectId: project.id,
      missionId: "mission-1",
      specId: spec?.id,
      routeId: route?.id,
    });
    const artifact = useProjectStore.getState().addProjectArtifact({
      projectId: project.id,
      type: "svg",
      title: "Architecture",
      path: "docs/entry-execution-architecture.svg",
      sourceMissionId: mission?.missionId,
      sourceSpecId: spec?.id,
    });
    const evidence = useProjectStore.getState().addProjectEvidence({
      projectId: project.id,
      type: "route",
      title: "Route selected",
      detail: "User selected the spec-first route.",
      sourceMissionId: mission?.missionId,
    });

    const bundle = useProjectStore.getState().getProjectBundle(project.id);
    expect(bundle?.messages).toEqual([message]);
    expect(bundle?.clarificationQuestions).toEqual([clarificationQuestion]);
    expect(bundle?.specs).toEqual([spec]);
    expect(bundle?.routes).toEqual([route]);
    expect(bundle?.missions).toEqual([mission]);
    expect(bundle?.artifacts).toEqual([artifact]);
    expect(bundle?.evidence).toEqual([
      expect.objectContaining({
        projectId: project.id,
        type: "runtime",
        title: "Mission created",
        sourceMissionId: mission?.missionId,
        sourceSpecId: spec?.id,
        sourceRouteId: route?.id,
      }),
      evidence,
    ]);
    expect(bundle?.project.currentSpecId).toBe(spec?.id);
    expect(bundle?.project.currentRouteId).toBe(route?.id);
    expect(bundle?.missions[0]).toMatchObject({
      projectId: project.id,
      specId: spec?.id,
      routeId: route?.id,
    });
  });

  it("records and answers project clarification questions", () => {
    const project = useProjectStore.getState().createProject({
      name: "Permission System",
      goal: "Build RBAC.",
    });

    const question = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "What is the required audit retention window?",
        reason: "Retention changes data modeling and storage requirements.",
        scope: "risk",
        answerType: "text",
        defaultAssumption: "Keep audit logs for 180 days.",
      });

    expect(question).toMatchObject({
      projectId: project.id,
      text: "What is the required audit retention window?",
      required: true,
      defaultAssumption: "Keep audit logs for 180 days.",
    });
    expect(useProjectStore.getState().getCurrentProject()?.status).toBe(
      "clarifying"
    );

    const answered = useProjectStore
      .getState()
      .answerProjectClarificationQuestion({
        projectId: project.id,
        questionId: question!.id,
        answer: "Keep audit logs for 365 days.",
      });

    expect(answered).toMatchObject({
      id: question?.id,
      answer: "Keep audit logs for 365 days.",
    });
    expect(answered?.answeredAt).toBeTruthy();
    expect(answered?.skippedAt).toBeUndefined();
    expect(
      useProjectStore.getState().getProjectClarificationQuestions(project.id)
    ).toHaveLength(1);
  });

  it("marks skipped clarification questions with their default assumption", () => {
    const project = useProjectStore.getState().createProject({
      name: "Permission System",
      goal: "Build RBAC.",
    });
    const question = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "Which frontend framework should be used?",
        scope: "tech",
        answerType: "single",
        options: ["React", "Vue"],
        required: false,
        defaultAssumption: "Use React.",
      });

    const skipped = useProjectStore
      .getState()
      .answerProjectClarificationQuestion({
        projectId: project.id,
        questionId: question!.id,
        skipped: true,
      });

    expect(skipped).toMatchObject({
      id: question?.id,
      answer: "Use React.",
      skippedAt: expect.any(String),
    });
    expect(skipped?.answeredAt).toBeUndefined();
  });

  it("rejects empty answers for clarification questions", () => {
    const project = useProjectStore.getState().createProject({
      name: "Permission System",
      goal: "Build RBAC.",
    });
    const question = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "Who approves production access?",
        scope: "user",
      });

    const answered = useProjectStore
      .getState()
      .answerProjectClarificationQuestion({
        projectId: project.id,
        questionId: question!.id,
        answer: "   ",
      });

    expect(answered).toBeNull();
    expect(
      useProjectStore
        .getState()
        .getProjectClarificationQuestions(project.id)[0]?.answer
    ).toBeUndefined();
  });

  it("rejects skipping required clarification questions without a default assumption", () => {
    const project = useProjectStore.getState().createProject({
      name: "Permission System",
      goal: "Build RBAC.",
    });
    const question = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "Which compliance policy is mandatory?",
        scope: "risk",
        required: true,
      });

    const skipped = useProjectStore
      .getState()
      .answerProjectClarificationQuestion({
        projectId: project.id,
        questionId: question!.id,
        skipped: true,
      });

    const stored = useProjectStore
      .getState()
      .getProjectClarificationQuestions(project.id)[0];
    expect(skipped).toBeNull();
    expect(stored?.answer).toBeUndefined();
    expect(stored?.skippedAt).toBeUndefined();
  });

  it("updates an existing mission link instead of duplicating it", () => {
    const project = useProjectStore.getState().createProject({
      name: "Permission System",
      goal: "Build RBAC.",
    });

    const first = useProjectStore.getState().linkMissionToProject({
      projectId: project.id,
      missionId: "mission-1",
      status: "queued",
    });
    const second = useProjectStore.getState().linkMissionToProject({
      projectId: project.id,
      missionId: "mission-1",
      status: "running",
    });

    expect(first?.id).toBe(second?.id);
    expect(useProjectStore.getState().missions).toHaveLength(1);
    expect(useProjectStore.getState().missions[0]?.status).toBe("running");
  });

  it("creates project spec versions with source coverage and current spec lookup", () => {
    const project = useProjectStore.getState().createProject({
      name: "Spec Center",
      goal: "Create a project-scoped spec center.",
    });
    const message = useProjectStore.getState().addProjectMessage({
      projectId: project.id,
      role: "user",
      content: "The spec center needs versions and evidence.",
    });
    const evidence = useProjectStore.getState().addProjectEvidence({
      projectId: project.id,
      type: "source",
      title: "Clarification answer",
      detail: "User confirmed versioned specs are required.",
    });
    const artifact = useProjectStore.getState().addProjectArtifact({
      projectId: project.id,
      type: "doc",
      title: "Imported requirements",
      contentPreview: "Spec center should track provenance.",
    });

    const firstSpec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Spec Center Draft",
      content: "Track specs by project.",
      sourceMessageIds: message ? [message.id] : [],
      sourceEvidenceIds: evidence ? [evidence.id] : [],
      sourceArtifactIds: artifact ? [artifact.id] : [],
    });
    const secondSpec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Spec Center Draft",
      content: "Track specs by project with version history.",
      sourceMessageIds: message ? [message.id] : [],
      sourceEvidenceIds: evidence ? [evidence.id] : [],
      sourceArtifactIds: artifact ? [artifact.id] : [],
      diffSummary: "Adds version history.",
    });

    expect(firstSpec).toMatchObject({
      version: 1,
      sourceArtifactIds: [artifact?.id],
      completeness: 1,
      completenessDetail: {
        band: "complete",
        sourceCoverage: {
          messages: 1,
          evidence: 1,
          artifacts: 1,
        },
      },
    });
    expect(secondSpec).toMatchObject({
      version: 2,
      supersedesSpecId: firstSpec?.id,
      diffSummary: "Adds version history.",
    });
    const projectSpecs = useProjectStore.getState().getProjectSpecs(project.id);
    expect(projectSpecs.map(spec => spec.version)).toEqual([1, 2]);
    expect(projectSpecs[0]).toMatchObject({
      id: firstSpec?.id,
      status: "superseded",
      supersededBySpecId: secondSpec?.id,
    });
    expect(projectSpecs[1]).toEqual(secondSpec);
    expect(useProjectStore.getState().getCurrentProjectSpec(project.id)).toBe(
      secondSpec
    );

    const diff = summarizeProjectSpecVersionDiff(firstSpec, secondSpec!);
    expect(diff).toMatchObject({
      fromSpecId: firstSpec?.id,
      toSpecId: secondSpec?.id,
      fromVersion: 1,
      toVersion: 2,
      summary: "Adds version history.",
    });
  });

  it("accepts a spec and preserves route references to the accepted version", () => {
    const project = useProjectStore.getState().createProject({
      name: "Spec Center",
      goal: "Create a project-scoped spec center.",
    });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Spec Center Draft",
      content: "Track specs by project.",
    });
    const route = useProjectStore.getState().addProjectRoute({
      projectId: project.id,
      specId: spec?.id,
      kind: "recommended",
      title: "Spec-first route",
      summary: "Accept the spec before execution.",
      selected: true,
    });

    const accepted = useProjectStore
      .getState()
      .acceptProjectSpec(project.id, spec!.id);

    expect(accepted).toMatchObject({
      id: spec?.id,
      status: "accepted",
      acceptedAt: expect.any(String),
    });
    expect(useProjectStore.getState().getCurrentProjectSpec(project.id)?.id).toBe(
      spec?.id
    );
    expect(
      useProjectStore.getState().getProjectBundle(project.id)?.routes[0]?.specId
    ).toBe(route?.specId);
  });

  it("records user confirmation evidence when accepting a spec", () => {
    const project = useProjectStore.getState().createProject({
      name: "Spec Center",
      goal: "Create a project-scoped spec center.",
    });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Spec Center Draft",
      content: "Track specs by project.",
      sourceMessageIds: ["message-1"],
      sourceEvidenceIds: ["evidence-1"],
    });

    const accepted = useProjectStore.getState().acceptProjectSpec(
      project.id,
      spec!.id,
      {
        note: "User confirmed this spec is ready for planning.",
        sourceMessageIds: ["message-confirmation"],
        sourceEvidenceIds: ["evidence-confirmation"],
      }
    );

    expect(accepted).toMatchObject({
      id: spec?.id,
      status: "accepted",
      confirmedBy: "user",
      confirmationNote: "User confirmed this spec is ready for planning.",
      confirmationEvidenceId: expect.any(String),
      sourceMessageIds: ["message-1", "message-confirmation"],
    });
    expect(accepted?.sourceEvidenceIds).toEqual([
      "evidence-1",
      "evidence-confirmation",
      accepted?.confirmationEvidenceId,
    ]);

    const bundle = useProjectStore.getState().getProjectBundle(project.id);
    expect(bundle?.evidence.at(-1)).toMatchObject({
      id: accepted?.confirmationEvidenceId,
      type: "decision",
      title: "Spec accepted",
      detail: "User confirmed this spec is ready for planning.",
    });
    expect(useProjectStore.getState().getCurrentProjectSpec(project.id)).toBe(
      accepted
    );
  });

  it("derives partial completeness when spec source fields are missing", () => {
    expect(
      deriveProjectSpecCompleteness({
        title: "Spec without sources",
        content: "Need more provenance.",
      })
    ).toMatchObject({
      band: "partial",
      missingFields: ["message-source", "evidence-or-artifact-source"],
      sourceCoverage: {
        messages: 0,
        evidence: 0,
        artifacts: 0,
      },
    });
  });

  it("builds an initial spec draft from project goal and clarifications", () => {
    const project = useProjectStore.getState().createProject({
      name: "Spec Center",
      goal: "Create a project-scoped spec center.",
      summary: "Keep specs tied to project context.",
    });
    const message = useProjectStore.getState().addProjectMessage({
      projectId: project.id,
      role: "user",
      content: "Need a spec center with source-aware drafts.",
    });
    const answered = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "Who reviews spec changes?",
        defaultAssumption: "Product owner reviews changes.",
        sourceMessageId: message?.id,
      });
    useProjectStore.getState().answerProjectClarificationQuestion({
      projectId: project.id,
      questionId: answered!.id,
      answer: "Engineering lead reviews changes.",
    });
    useProjectStore.getState().addProjectClarificationQuestion({
      projectId: project.id,
      text: "Which route should be preferred?",
      required: false,
    });

    const draftInput = buildInitialProjectSpecDraft({
      project,
      messages: useProjectStore.getState().messages,
      clarificationQuestions:
        useProjectStore.getState().clarificationQuestions,
    });

    expect(draftInput).toMatchObject({
      projectId: project.id,
      title: "Spec Center Initial Spec",
      status: "draft",
      sourceMessageIds: [message?.id],
    });
    expect(draftInput.content).toContain("Create a project-scoped spec center.");
    expect(draftInput.content).toContain(
      "Who reviews spec changes?: Engineering lead reviews changes."
    );
    expect(draftInput.content).toContain("Which route should be preferred?");
  });

  it("creates and selects an initial project spec draft from store state", () => {
    const project = useProjectStore.getState().createProject({
      name: "Spec Center",
      goal: "Create a project-scoped spec center.",
      summary: "Keep specs tied to project context.",
    });
    const message = useProjectStore.getState().addProjectMessage({
      projectId: project.id,
      role: "user",
      content: "Need a spec center with source-aware drafts.",
    });
    const question = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "Who reviews spec changes?",
        sourceMessageId: message?.id,
      });
    useProjectStore.getState().answerProjectClarificationQuestion({
      projectId: project.id,
      questionId: question!.id,
      answer: "Engineering lead reviews changes.",
    });

    const spec = useProjectStore.getState().createInitialProjectSpecDraft({
      projectId: project.id,
    });

    expect(spec).toMatchObject({
      projectId: project.id,
      version: 1,
      title: "Spec Center Initial Spec",
      status: "draft",
      sourceMessageIds: [message?.id],
    });
    expect(spec?.content).toContain("## Clarifications");
    expect(spec?.content).toContain("Engineering lead reviews changes.");
    expect(useProjectStore.getState().getCurrentProjectSpec(project.id)?.id).toBe(
      spec?.id
    );
    expect(useProjectStore.getState().getCurrentProject()?.status).toBe(
      "spec_ready"
    );
  });

  it("merges multi-round clarification answers and skipped assumptions into spec sources", () => {
    const project = useProjectStore.getState().createProject({
      name: "Clarification Merge",
      goal: "Plan a launch checklist.",
      summary: "Keep launch constraints visible before execution.",
    });
    const otherProject = useProjectStore.getState().createProject({
      name: "Other Project",
      goal: "Should not leak into this spec.",
    });
    const firstMessage = useProjectStore.getState().addProjectMessage({
      projectId: project.id,
      role: "user",
      kind: "clarification",
      content: "Launch must happen before the conference.",
    });
    const secondMessage = useProjectStore.getState().addProjectMessage({
      projectId: project.id,
      role: "user",
      kind: "clarification",
      content: "Rollback is required for payment changes.",
    });
    const ignoredMessage = useProjectStore.getState().addProjectMessage({
      projectId: otherProject.id,
      role: "user",
      kind: "clarification",
      content: "This belongs elsewhere.",
    });
    const timelineQuestion = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "What is the launch deadline?",
        sourceMessageId: firstMessage?.id,
      });
    const rollbackQuestion = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "What rollback expectation should be assumed?",
        required: false,
        defaultAssumption: "Rollback within one hour.",
        sourceMessageId: secondMessage?.id,
      });
    const openQuestion = useProjectStore
      .getState()
      .addProjectClarificationQuestion({
        projectId: project.id,
        text: "Who signs off the final release?",
      });
    useProjectStore.getState().addProjectClarificationQuestion({
      projectId: otherProject.id,
      text: "Which unrelated answer should be ignored?",
      defaultAssumption: "Ignore this.",
      sourceMessageId: ignoredMessage?.id,
    });

    useProjectStore.getState().answerProjectClarificationQuestion({
      projectId: project.id,
      questionId: timelineQuestion!.id,
      answer: "Before May 15.",
    });
    useProjectStore.getState().answerProjectClarificationQuestion({
      projectId: project.id,
      questionId: rollbackQuestion!.id,
      skipped: true,
    });

    const spec = useProjectStore.getState().createInitialProjectSpecDraft({
      projectId: project.id,
      title: "Launch Checklist Draft",
    });

    expect(spec).toMatchObject({
      projectId: project.id,
      title: "Launch Checklist Draft",
      status: "draft",
      sourceMessageIds: [secondMessage?.id, firstMessage?.id],
    });
    expect(spec?.sourceMessageIds).not.toContain(ignoredMessage?.id);
    expect(spec?.content).toContain(
      "What is the launch deadline?: Before May 15."
    );
    expect(spec?.content).toContain(
      "What rollback expectation should be assumed?: Rollback within one hour. (assumption)"
    );
    expect(spec?.content).toContain("Who signs off the final release?");
    expect(spec?.content).not.toContain("Which unrelated answer should be ignored?");
    expect(
      useProjectStore.getState().getProjectClarificationQuestions(project.id)
    ).toHaveLength(3);
    expect(openQuestion?.answer).toBeUndefined();
  });

  it("builds FSD route candidates from the current project spec", () => {
    const project = useProjectStore.getState().createProject({
      name: "Route Planner",
      goal: "Plan execution for a permission system.",
      summary: "Security and audit evidence are important.",
    });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Permission System Spec",
      content: "Implement permission workflows with audit evidence.",
    });

    const plan = buildProjectRoutePlan({
      project,
      currentSpec: spec,
      recentMessages: [],
    });

    expect(plan).toMatchObject({
      projectId: project.id,
      specId: spec?.id,
    });
    expect(plan.candidates.map(candidate => candidate.kind)).toEqual([
      "recommended",
      "fast",
      "deep",
      "conservative",
    ]);
    expect(plan.candidates[0]).toMatchObject({
      title: "Recommended FSD Route",
      specId: spec?.id,
      riskLevel: "medium",
    });
    expect(plan.candidates[0]?.summary).toContain("Permission System Spec");
    expect(plan.candidates[0]?.steps.map(step => step.role)).toEqual([
      "Planner",
      "Coordinator",
      "Executor",
    ]);
  });

  it("generates project routes from the current spec and can select one", () => {
    const project = useProjectStore.getState().createProject({
      name: "Route Planner",
      goal: "Plan execution for a permission system.",
    });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Permission System Spec",
      content: "Implement permission workflows.",
    });

    const routes = useProjectStore.getState().generateProjectRoutePlan({
      projectId: project.id,
      selectKind: "conservative",
    });

    expect(routes).toHaveLength(4);
    expect(routes.map(route => route.kind)).toEqual([
      "recommended",
      "fast",
      "deep",
      "conservative",
    ]);
    expect(routes.every(route => route.specId === spec?.id)).toBe(true);
    expect(routes.find(route => route.kind === "conservative")).toMatchObject({
      selectedAt: expect.any(String),
      riskLevel: "low",
    });
    expect(useProjectStore.getState().getCurrentProject()).toMatchObject({
      id: project.id,
      currentRouteId: routes.find(route => route.kind === "conservative")?.id,
      status: "planning",
    });
  });

  it("replans routes after a spec update and records the previous route source", () => {
    const project = useProjectStore.getState().createProject({
      name: "Route Replan",
      goal: "Plan execution for a permission system.",
    });
    const firstSpec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Permission System Spec",
      content: "Implement permission workflows.",
    });
    const firstRoutes = useProjectStore.getState().generateProjectRoutePlan({
      projectId: project.id,
      selectKind: "fast",
    });
    const firstRoute = firstRoutes.find(route => route.kind === "fast");
    const nextSpec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Permission System Spec v2",
      content: "Implement permission workflows with audit checkpoints.",
      diffSummary: "Adds audit checkpoints.",
    });

    const replannedRoutes = useProjectStore.getState().replanProjectRoutePlan({
      projectId: project.id,
      selectKind: "conservative",
      reason: "Spec changed to require audit checkpoints.",
      sourceSpecId: firstSpec?.id,
      sourceRouteId: firstRoute?.id,
    });

    expect(replannedRoutes).toHaveLength(4);
    expect(replannedRoutes.every(route => route.specId === nextSpec?.id)).toBe(
      true
    );
    const selectedRoute = replannedRoutes.find(
      route => route.kind === "conservative"
    );
    expect(selectedRoute).toMatchObject({
      selectedAt: expect.any(String),
      riskLevel: "low",
    });
    expect(useProjectStore.getState().getCurrentProject()).toMatchObject({
      id: project.id,
      currentSpecId: nextSpec?.id,
      currentRouteId: selectedRoute?.id,
      status: "planning",
    });
    expect(useProjectStore.getState().getProjectBundle(project.id)?.evidence).toEqual([
      expect.objectContaining({
        projectId: project.id,
        type: "route",
        title: "Route replanned",
        detail: "Spec changed to require audit checkpoints.",
        sourceSpecId: firstSpec?.id,
        sourceRouteId: firstRoute?.id,
      }),
    ]);
  });

  it("replans from a failed mission without exposing internal route nodes", () => {
    const project = useProjectStore.getState().createProject({
      name: "Mission Replan",
      goal: "Plan execution for a permission system.",
    });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Permission System Spec",
      content: "Implement permission workflows.",
    });
    const route = useProjectStore.getState().addProjectRoute({
      projectId: project.id,
      specId: spec?.id,
      kind: "recommended",
      title: "Recommended FSD Route",
      summary: "Move the accepted spec into execution.",
      selected: true,
    });
    const mission = useProjectStore.getState().linkMissionToProject({
      projectId: project.id,
      missionId: "mission-failed",
      specId: spec?.id,
      routeId: route?.id,
      status: "running",
    });

    const failed = useProjectStore
      .getState()
      .updateProjectMissionStatus("mission-failed", "failed");
    const replannedRoutes = useProjectStore.getState().replanProjectRoutePlan({
      projectId: project.id,
      sourceMissionId: "mission-failed",
      action: "failed",
      reason: "Mission failed while validating execution.",
    });

    expect(failed).toMatchObject({
      id: mission?.id,
      status: "failed",
    });
    expect(replannedRoutes).toHaveLength(4);
    const selectedRoute = replannedRoutes.find(
      candidate => candidate.kind === route?.kind
    );
    expect(useProjectStore.getState().getCurrentProject()).toMatchObject({
      id: project.id,
      currentRouteId: selectedRoute?.id,
      status: "executing",
    });
    expect(selectedRoute?.id).not.toBe(route?.id);
    expect(useProjectStore.getState().getProjectBundle(project.id)?.evidence).toEqual([
      expect.objectContaining({
        projectId: project.id,
        type: "runtime",
        title: "Mission created",
        sourceMissionId: "mission-failed",
        sourceSpecId: spec?.id,
        sourceRouteId: route?.id,
      }),
      expect.objectContaining({
        projectId: project.id,
        type: "failure",
        title: "Mission failed",
        sourceMissionId: "mission-failed",
        sourceSpecId: spec?.id,
        sourceRouteId: route?.id,
      }),
      expect.objectContaining({
        projectId: project.id,
        type: "route",
        title: "Route replanned after failure",
        detail: "Mission failed while validating execution.",
        sourceMissionId: "mission-failed",
        sourceSpecId: spec?.id,
        sourceRouteId: route?.id,
      }),
    ]);
  });

  it("records route selection evidence with project, spec, route and mission sources", () => {
    const project = useProjectStore.getState().createProject({
      name: "Route Evidence",
      goal: "Choose an execution route for a permission system.",
    });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Permission System Spec",
      content: "Implement permission workflows.",
    });
    const route = useProjectStore.getState().addProjectRoute({
      projectId: project.id,
      specId: spec?.id,
      kind: "deep",
      title: "Deep Design Route",
      summary: "Expand the spec before implementation.",
    });

    const selected = useProjectStore.getState().selectProjectRoute(
      project.id,
      route!.id,
      {
        action: "selected",
        note: "User chose the deep route for extra design review.",
        sourceMissionId: "mission-review",
      }
    );

    expect(selected).toMatchObject({
      id: route?.id,
      selectedAt: expect.any(String),
    });
    expect(useProjectStore.getState().getProjectBundle(project.id)?.evidence).toEqual([
      expect.objectContaining({
        projectId: project.id,
        type: "route",
        title: "Route selected",
        detail: "User chose the deep route for extra design review.",
        sourceMissionId: "mission-review",
        sourceSpecId: spec?.id,
        sourceRouteId: route?.id,
      }),
    ]);
  });

  it("records project evidence for user input, route decisions and mission lifecycle", () => {
    const project = useProjectStore.getState().createProject({
      name: "Evidence Replay",
      goal: "Keep user input, route choices, operator decisions and mission state in one evidence chain.",
    });
    const userMessage = useProjectStore.getState().addProjectMessage({
      projectId: project.id,
      role: "user",
      kind: "chat",
      content: "Build a permission workflow with audit evidence.",
      createEvidence: true,
      evidenceTitle: "Project launch input",
    });
    const clarification = useProjectStore.getState().addProjectEvidence({
      projectId: project.id,
      type: "clarification",
      title: "Project clarification answered",
      detail: "Audit retention is 365 days.",
    });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Evidence Spec",
      content: "Track replay evidence.",
      sourceMessageIds: userMessage ? [userMessage.id] : [],
      sourceEvidenceIds: clarification ? [clarification.id] : [],
    });
    const route = useProjectStore.getState().addProjectRoute({
      projectId: project.id,
      specId: spec?.id,
      kind: "recommended",
      title: "Recommended FSD Route",
      summary: "Execute and record evidence.",
    });

    useProjectStore.getState().selectProjectRoute(project.id, route!.id, {
      action: "selected",
      note: "User chose the recommended project route.",
      sourceMissionId: "mission-evidence",
    });
    useProjectStore.getState().linkMissionToProject({
      projectId: project.id,
      missionId: "mission-evidence",
      specId: spec?.id,
      routeId: route?.id,
      status: "running",
    });
    useProjectStore
      .getState()
      .updateProjectMissionStatus("mission-evidence", "completed");
    useProjectStore.getState().addProjectEvidence({
      projectId: project.id,
      type: "decision",
      title: "Operator action: approve",
      detail: "Operator approved the execution result.",
      sourceMissionId: "mission-evidence",
    });

    expect(
      useProjectStore
        .getState()
        .getProjectBundle(project.id)
        ?.evidence.map(item => item.type)
    ).toEqual([
      "message",
      "clarification",
      "route",
      "runtime",
      "runtime",
      "decision",
    ]);
    expect(useProjectStore.getState().getProjectBundle(project.id)?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message",
          title: "Project launch input",
          detail: "Build a permission workflow with audit evidence.",
        }),
        expect.objectContaining({
          type: "route",
          sourceRouteId: route?.id,
          sourceSpecId: spec?.id,
          sourceMissionId: "mission-evidence",
        }),
        expect.objectContaining({
          type: "runtime",
          title: "Mission completed",
          sourceMissionId: "mission-evidence",
          sourceRouteId: route?.id,
          sourceSpecId: spec?.id,
        }),
        expect.objectContaining({
          type: "decision",
          title: "Operator action: approve",
          sourceMissionId: "mission-evidence",
        }),
      ])
    );
  });

  it("builds a mission plan from a selected route with project, spec and route ids", () => {
    const route = {
      id: "route-1",
      projectId: "project-1",
      specId: "spec-1",
      kind: "recommended" as const,
      title: "Recommended FSD Route",
      summary: "Execute the accepted spec.",
    };

    const plan = buildMissionPlanFromRoute({
      route,
      missionId: "mission-1",
    });

    expect(plan).toMatchObject({
      projectId: "project-1",
      specId: "spec-1",
      routeId: "route-1",
      missionId: "mission-1",
      status: "queued",
      routeKind: "recommended",
      title: "Recommended FSD Route",
    });
  });

  it("creates a linked project mission from the current route plan", () => {
    const project = useProjectStore.getState().createProject({
      name: "Route Planner",
      goal: "Plan execution for a permission system.",
    });
    const spec = useProjectStore.getState().addProjectSpec({
      projectId: project.id,
      title: "Permission System Spec",
      content: "Implement permission workflows.",
    });
    const route = useProjectStore.getState().addProjectRoute({
      projectId: project.id,
      specId: spec?.id,
      kind: "recommended",
      title: "Recommended FSD Route",
      summary: "Move the accepted spec into execution.",
      selected: true,
    });

    const missionPlan = useProjectStore.getState().createMissionPlanFromRoute({
      projectId: project.id,
      missionId: "mission-from-route",
    });

    expect(missionPlan).toMatchObject({
      projectId: project.id,
      specId: spec?.id,
      routeId: route?.id,
      missionId: "mission-from-route",
      status: "queued",
    });
    expect(useProjectStore.getState().getProjectBundle(project.id)?.missions).toEqual([
      missionPlan,
    ]);
    expect(useProjectStore.getState().getCurrentProject()?.status).toBe(
      "executing"
    );
  });
});
