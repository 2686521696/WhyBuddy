import type { FC } from "react";

import type { AppLocale } from "@/lib/locale";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationJob,
} from "@shared/blueprint/contracts";

import { ProcessArtifactSplitPanel } from "../../ProcessArtifactSplitPanel";

export interface WorkbenchExecutionPanelProps {
  job: BlueprintGenerationJob | null | undefined;
  locale: AppLocale;
  reasoningEntries: readonly AgentReasoningEntry[];
}

const SPEC_DOC_ARTIFACT_TYPES: readonly string[] = [
  "requirements",
  "design",
  "tasks",
  "spec_document",
  "spec_document_version",
];

export const WorkbenchExecutionPanel: FC<WorkbenchExecutionPanelProps> = ({
  job,
  locale,
  reasoningEntries,
}) => {
  return (
    <div
      data-testid="autopilot-workbench-execution-panel"
      className="h-full min-h-0"
    >
      <ProcessArtifactSplitPanel
        locale={locale}
        job={job}
        reasoningEntries={reasoningEntries}
        artifactTypes={SPEC_DOC_ARTIFACT_TYPES}
        executionTitle={locale === "zh-CN" ? "执行流" : "Execution"}
        artifactTitle={locale === "zh-CN" ? "产物流" : "Artifacts"}
      />
    </div>
  );
};

export default WorkbenchExecutionPanel;
