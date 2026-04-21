import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OfficeTaskCockpit } from "./OfficeTaskCockpit";
import { useAppStore } from "@/lib/store";
import { useNLCommandStore } from "@/lib/nl-command-store";
import { useTasksStore } from "@/lib/tasks-store";
import { useTelemetryStore } from "@/lib/telemetry-store";
import { useWorkflowStore } from "@/lib/workflow-store";

vi.mock("antd", () => {
  function Panel({ children }: { children?: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function Splitter({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) {
    return <div className={className}>{children}</div>;
  }

  Splitter.Panel = Panel;

  return { Splitter };
});

vi.mock("@/components/launch/UnifiedLaunchComposer", () => ({
  UnifiedLaunchComposer: ({
    bare,
    hideHeader,
    hideClarificationPanel,
  }: {
    bare?: boolean;
    hideHeader?: boolean;
    hideClarificationPanel?: boolean;
  }) => (
    <div
      data-testid="unified-launch-composer"
      data-bare={bare ? "true" : "false"}
      data-hide-header={hideHeader ? "true" : "false"}
      data-hide-clarification={hideClarificationPanel ? "true" : "false"}
    >
      mocked composer
    </div>
  ),
}));

vi.mock("@/components/nl-command/ClarificationPanel", () => ({
  ClarificationPanel: () => <div>mocked clarification</div>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value: string;
  }) => <button data-value={value}>{children}</button>,
  TabsContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ExecutorStatusPanel", () => ({
  ExecutorStatusPanel: () => null,
}));

vi.mock("@/components/ExecutorTerminalPanel", () => ({
  ExecutorTerminalPanel: () => null,
}));

vi.mock("@/components/tasks/ArtifactListBlock", () => ({
  ArtifactListBlock: () => null,
}));

vi.mock("@/components/tasks/ArtifactPreviewDialog", () => ({
  ArtifactPreviewDialog: () => null,
}));

vi.mock("@/components/tasks/CreateMissionDialog", () => ({
  CreateMissionDialog: () => null,
}));

vi.mock("@/components/tasks/TasksCockpitDetail", () => ({
  TasksCockpitDetail: () => <div>mocked task detail</div>,
}));

vi.mock("@/components/tasks/TasksQueueRail", () => ({
  TasksQueueRail: () => <div>mocked task queue</div>,
}));

vi.mock("./OfficeAgentInspectorPanel", () => ({
  OfficeAgentInspectorPanel: () => null,
}));

vi.mock("./OfficeWorkflowContextPanels", () => ({
  OfficeMemoryReportsPanel: () => null,
  OfficeWorkflowFlowPanel: () => null,
  OfficeWorkflowHistoryPanel: () => null,
}));

const noopAsync = async () => {};
const noopAsyncNullable = async () => null;
const noopToggle = () => {};

beforeEach(() => {
  useAppStore.setState({
    locale: "zh-CN",
    runtimeMode: "frontend",
    selectedPet: null,
    toggleConfig: noopToggle,
    setRuntimeMode: async () => {},
  });

  useTelemetryStore.setState({
    dashboardOpen: false,
    toggleDashboard: noopToggle,
  });

  useNLCommandStore.setState({
    currentDialog: null,
    currentCommand: null,
  });

  useWorkflowStore.setState({
    workflows: [],
    agents: [],
    currentWorkflow: null,
    currentWorkflowId: null,
    fetchWorkflowDetail: noopAsync,
    fetchWorkflows: noopAsync,
    setCurrentWorkflow: () => {},
  });

  useTasksStore.setState({
    tasks: [],
    detailsById: {},
    selectedTaskId: null,
    loading: false,
    ready: true,
    error: null,
    decisionNotes: {},
    operatorActionLoadingByMissionId: {},
    refresh: noopAsync,
    selectTask: () => {},
    createMission: async () => null,
    submitOperatorAction: noopAsyncNullable,
    setDecisionNote: () => {},
    launchDecision: noopAsyncNullable,
  });
});

describe("OfficeTaskCockpit", () => {
  it("renders a single central launch composer and keeps the launch tab informational", () => {
    const markup = renderToStaticMarkup(<OfficeTaskCockpit />);

    expect(markup).toContain("data-testid=\"unified-launch-composer\"");
    expect(
      markup.match(/data-testid=\"unified-launch-composer\"/g)?.length
    ).toBe(1);
    expect(markup).toContain("data-bare=\"true\"");
    expect(markup).toContain("data-hide-header=\"true\"");
    expect(markup).toContain("主输入框已经回到底部中央控制台");
  });
});
