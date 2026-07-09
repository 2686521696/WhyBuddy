import { beforeEach, describe, expect, it, vi } from "vitest";

const selectTask = vi.fn();
const createMission = vi.fn();
const submitTaskHubCommand = vi.fn();
const submitTaskHubClarification = vi.fn();
const submitDirective = vi.fn();
const addProjectMessage = vi.fn();
const addProjectEvidence = vi.fn();
const addProjectArtifact = vi.fn();
const addProjectRoute = vi.fn();
const addProjectClarificationQuestion = vi.fn();
const answerProjectClarificationQuestion = vi.fn();
const addProjectSpec = vi.fn();
const linkMissionToProject = vi.fn();
let nlCommandSnapshot: {
  currentDialog: any;
  commandProjectContextById: Record<
    string,
    { projectId: string | null; projectName?: string | null }
  >;
};

vi.mock("./tasks-store", () => ({
  useTasksStore: {
    getState: () => ({
      selectTask,
      createMission,
    }),
  },
}));

vi.mock("./nl-command-store", () => ({
  useNLCommandStore: {
    getState: () => ({
      submitTaskHubCommand,
      submitTaskHubClarification,
      ...nlCommandSnapshot,
    }),
  },
}));

vi.mock("./workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      submitDirective,
    }),
  },
}));

vi.mock("./project-store", () => ({
  useProjectStore: {
    getState: () => ({
      addProjectMessage,
      addProjectEvidence,
      addProjectArtifact,
      addProjectRoute,
      addProjectClarificationQuestion,
      answerProjectClarificationQuestion,
      addProjectSpec,
      linkMissionToProject,
    }),
  },
}));

describe("unified-launch-coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nlCommandSnapshot = {
      currentDialog: null,
      commandProjectContextById: {},
    };
    addProjectRoute.mockReturnValue({
      id: "route-1",
      summary: "route summary",
    });
    addProjectMessage.mockImplementation(input => ({
      id: `${input.role}-message-1`,
      ...input,
    }));
    addProjectEvidence.mockImplementation(input => ({
      id: `${input.type}-evidence-1`,
      ...input,
    }));
  });

  it("focuses the mission after a mission-path launch succeeds", async () => {
    submitTaskHubCommand.mockResolvedValue({
      commandId: "cmd-1",
      commandText: "整理支付模块任务",
      missionId: "mission-1",
      relatedMissionIds: ["mission-1"],
      autoSelectedMissionId: "mission-1",
      status: "created",
      createdAt: Date.now(),
    });

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "本周内重构支付模块，要求零停机和可回滚，并给出验收标准与交付结果。",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(result).toMatchObject({
      route: "mission",
      missionId: "mission-1",
      status: "created",
    });
    expect(selectTask).toHaveBeenCalledWith("mission-1");
    expect(submitTaskHubCommand).toHaveBeenCalledTimes(1);
  });

  it("records project message, evidence and mission link for project-scoped launches", async () => {
    submitTaskHubCommand.mockResolvedValue({
      commandId: "cmd-project",
      commandText: "整理权限系统任务",
      missionId: "mission-project",
      relatedMissionIds: ["mission-project"],
      autoSelectedMissionId: "mission-project",
      status: "created",
      createdAt: Date.now(),
      projectId: "project-1",
    });

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    await submitUnifiedLaunch({
      text: "本周内整理权限管理系统 spec，要求包含 RBAC、审计、验收标准和交付结果。",
      runtimeMode: "advanced",
      attachments: [],
      projectId: "project-1",
      projectName: "权限管理系统",
    });

    expect(submitTaskHubCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        projectName: "权限管理系统",
      })
    );
    expect(addProjectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        role: "user",
        kind: "chat",
      })
    );
    expect(addProjectRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        kind: "recommended",
      })
    );
    expect(linkMissionToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        missionId: "mission-project",
      })
    );
    expect(addProjectEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        sourceMissionId: "mission-project",
      })
    );
    expect(addProjectEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        type: "route",
        title: "Launch route evaluated",
      })
    );
  });

  it("records project artifacts for project-scoped attachment launches", async () => {
    submitDirective.mockResolvedValue({
      workflowId: "wf-project-attachments",
      missionId: "mission-project-attachments",
      deduped: false,
    });

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    await submitUnifiedLaunch({
      text: "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，最后输出交付结果和时间安排。",
      runtimeMode: "advanced",
      projectId: "project-1",
      projectName: "Permission System",
      attachments: [
        {
          id: "attachment-1",
          name: "brief.md",
          mimeType: "text/markdown",
          size: 128,
          content: "# brief",
          excerpt: "# brief",
          excerptStatus: "parsed",
        },
      ],
    });

    expect(addProjectArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        type: "doc",
        title: "brief.md",
        contentPreview: "# brief",
      })
    );
    expect(addProjectRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        kind: "deep",
      })
    );
  });

  it("uses the selected fast or standard route to submit through the mission path", async () => {
    submitTaskHubCommand.mockResolvedValue({
      commandId: "cmd-standard-route",
      commandText: "整理支付模块任务",
      missionId: "mission-standard-route",
      relatedMissionIds: ["mission-standard-route"],
      autoSelectedMissionId: "mission-standard-route",
      status: "created",
      createdAt: Date.now(),
    });

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "本周内重构支付模块，要求零停机和可回滚，并给出验收标准与交付结果。",
      runtimeMode: "advanced",
      attachments: [],
      selectedRouteId: "standard-route",
    });

    expect(result).toMatchObject({
      route: "mission",
      missionId: "mission-standard-route",
      status: "created",
    });
    expect(submitTaskHubCommand).toHaveBeenCalledTimes(1);
    expect(submitDirective).not.toHaveBeenCalled();
  });

  it("focuses the mission after a workflow-path launch returns missionId", async () => {
    submitDirective.mockResolvedValue({
      workflowId: "wf-1",
      missionId: "mission-2",
      deduped: false,
    });

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，最后输出交付结果和时间安排。",
      runtimeMode: "advanced",
      attachments: [
        {
          id: "attachment-1",
          name: "brief.md",
          mimeType: "text/markdown",
          size: 128,
          content: "# brief",
          excerpt: "# brief",
          excerptStatus: "parsed",
        },
      ],
    });

    expect(result).toMatchObject({
      route: "workflow",
      workflowId: "wf-1",
      missionId: "mission-2",
    });
    expect(selectTask).toHaveBeenCalledWith("mission-2");
    expect(submitDirective).toHaveBeenCalledTimes(1);
  });

  it("uses the selected deep route to submit through the workflow path", async () => {
    submitDirective.mockResolvedValue({
      workflowId: "wf-deep-route",
      missionId: "mission-deep-route",
      deduped: false,
    });

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "本周内重构支付模块，要求零停机和可回滚，并给出验收标准与交付结果。",
      runtimeMode: "advanced",
      attachments: [],
      selectedRouteId: "deep-route",
    });

    expect(result).toMatchObject({
      route: "workflow",
      workflowId: "wf-deep-route",
      missionId: "mission-deep-route",
    });
    expect(submitDirective).toHaveBeenCalledTimes(1);
    expect(submitTaskHubCommand).not.toHaveBeenCalled();
  });

  it("keeps focus stable in deduped workflow launches", async () => {
    submitDirective.mockResolvedValue({
      workflowId: "wf-deduped",
      missionId: "mission-deduped",
      deduped: true,
    });

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，最后输出交付结果和时间安排。",
      runtimeMode: "advanced",
      attachments: [
        {
          id: "attachment-1",
          name: "brief.md",
          mimeType: "text/markdown",
          size: 128,
          content: "# brief",
          excerpt: "# brief",
          excerptStatus: "parsed",
        },
      ],
    });

    expect(result).toMatchObject({
      route: "workflow",
      workflowId: "wf-deduped",
      missionId: "mission-deduped",
      deduped: true,
    });
    expect(selectTask).toHaveBeenCalledWith("mission-deduped");
  });

  it("does not submit launch requests before runtime upgrade is completed", async () => {
    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "打开浏览器检查生产页面，抓日志并给出回滚方案、验收标准和本周时间安排。",
      runtimeMode: "frontend",
      attachments: [],
    });

    expect(result).toMatchObject({
      route: "upgrade-required",
      upgraded: false,
    });
    expect(submitTaskHubCommand).not.toHaveBeenCalled();
    expect(submitDirective).not.toHaveBeenCalled();
    expect(selectTask).not.toHaveBeenCalled();
  });

  it("records project failure evidence when mission launch throws", async () => {
    submitTaskHubCommand.mockRejectedValue(new Error("mission failed"));

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");

    await expect(
      submitUnifiedLaunch({
        text: "本周内整理权限系统，要求验收标准、回滚方案和交付结果。",
        runtimeMode: "advanced",
        attachments: [],
        projectId: "project-1",
      })
    ).rejects.toThrow("mission failed");

    expect(addProjectEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        type: "failure",
        title: "Mission launch failed",
        detail: "mission failed",
      })
    );
  });

  it("does not allow unavailable route selections to bypass clarification", async () => {
    nlCommandSnapshot = {
      currentDialog: {
        commandId: "cmd-clarify",
        questions: [
          {
            questionId: "goal",
            text: "请补充交付目标？",
            type: "single_choice",
            options: ["Spec first", "Execute now"],
            context: "Route selection depends on the project goal.",
          },
        ],
        answers: [],
      },
      commandProjectContextById: {
        "cmd-clarify": {
          projectId: "project-clarify",
          projectName: "Clarify Project",
        },
      },
    };
    submitTaskHubCommand.mockResolvedValue({
      commandId: "cmd-clarify",
      commandText: "帮我推进这个任务",
      missionId: null,
      relatedMissionIds: [],
      autoSelectedMissionId: null,
      status: "needs_clarification",
      createdAt: Date.now(),
      projectId: "project-clarify",
    });

    const { submitUnifiedLaunch } = await import("./unified-launch-coordinator");
    const result = await submitUnifiedLaunch({
      text: "帮我推进这个任务",
      runtimeMode: "advanced",
      attachments: [],
      projectId: "project-clarify",
      selectedRouteId: "deep-route",
    });

    expect(result).toMatchObject({
      route: "mission",
      missionId: null,
      status: "needs_clarification",
    });
    expect(submitTaskHubCommand).toHaveBeenCalledTimes(1);
    expect(submitDirective).not.toHaveBeenCalled();
    expect(addProjectClarificationQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-clarify",
        reason: "Route selection depends on the project goal.",
        answerType: "single",
        options: ["Spec first", "Execute now"],
        required: true,
        sourceCommandId: "cmd-clarify",
        sourceQuestionId: "goal",
      })
    );
    expect(addProjectClarificationQuestion.mock.calls[0]?.[0]).toHaveProperty(
      "sourceMessageId"
    );
    expect(addProjectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-clarify",
        role: "assistant",
        kind: "clarification",
        content: "请补充交付目标？",
      })
    );
  });

  it("records the project clarification answer and evidence before resolving creation", async () => {
    nlCommandSnapshot = {
      currentDialog: null,
      commandProjectContextById: {
        "cmd-clarify-1": {
          projectId: "project-clarified",
          projectName: "Clarified Project",
        },
      },
    };
    submitTaskHubClarification.mockResolvedValue({
      commandId: "cmd-clarify-1",
      commandText: "整理支付模块任务",
      missionId: "mission-clarified",
      relatedMissionIds: ["mission-clarified"],
      autoSelectedMissionId: "mission-clarified",
      status: "created",
      createdAt: Date.now(),
    });

    const { submitUnifiedClarification } = await import(
      "./unified-launch-coordinator"
    );
    const result = await submitUnifiedClarification({
      commandId: "cmd-clarify-1",
      answer: {
        questionId: "timeline",
        text: "本周内完成，并提供验收标准与回滚方案。",
        timestamp: Date.now(),
      },
    });

    expect(result).toMatchObject({
      route: "mission",
      missionId: "mission-clarified",
      status: "created",
    });
    expect(addProjectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-clarified",
        role: "user",
        kind: "clarification",
      })
    );
    expect(answerProjectClarificationQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-clarified",
        questionId: "timeline",
        answer: expect.any(String),
      })
    );
    expect(addProjectEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-clarified",
        type: "clarification",
        title: "Project clarification answered",
        detail: expect.stringContaining("Question: timeline"),
      })
    );
    expect(addProjectSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-clarified",
        title: "Clarification draft",
        status: "draft",
        sourceMessageIds: ["user-message-1"],
        sourceEvidenceIds: ["clarification-evidence-1"],
        content: expect.stringContaining("Question: timeline"),
      })
    );
    expect(submitTaskHubClarification).toHaveBeenCalledTimes(1);
    expect(selectTask).toHaveBeenCalledWith("mission-clarified");
  });
});
