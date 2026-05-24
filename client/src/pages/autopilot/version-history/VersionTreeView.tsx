import { useMemo } from "react";

import type { BlueprintFamilyResponse } from "@shared/blueprint/contracts";

import type { VersionHistoryJob, VersionTreeLayoutNode } from "./types";

import { TreeNode } from "./TreeNode";
import { deriveVersionTreeLayout } from "./derive-tree-layout";
import {
  type FamilyDataState,
  type FetchBlueprintFamily,
  useFamilyData,
} from "./use-family-data";
import {
  type UseSwitchActiveJobOptions,
  useSwitchActiveJob,
} from "./use-switch-active-job";

interface VersionTreeViewProps {
  jobId?: string | null;
  jobs?: VersionHistoryJob[];
  initialData?: BlueprintFamilyResponse | null;
  familyState?: FamilyDataState;
  staticPreview?: boolean;
  fetchFamily?: FetchBlueprintFamily;
  activeJobId: string | null;
  onSelectJob?: (jobId: string) => void;
  applySwitchActive?: UseSwitchActiveJobOptions["apply"];
  coordinator?: UseSwitchActiveJobOptions["coordinator"];
  pageTransition?: UseSwitchActiveJobOptions["pageTransition"];
  onRejected?: UseSwitchActiveJobOptions["onRejected"];
}

function familyFromJobs(jobs: VersionHistoryJob[] | undefined): BlueprintFamilyResponse | null {
  if (!jobs) return null;
  return {
    rootJobId: jobs.find((job) => !job.parentJobId)?.id ?? jobs[0]?.id ?? "",
    jobs,
    replanEvents: [],
  };
}

function renderNode(
  node: VersionTreeLayoutNode,
  activeJobId: string | null,
  onSelectJob: (jobId: string) => void,
  parentJobId?: string,
) {
  return (
    <li
      key={node.job.id}
      data-tree-depth={node.depth}
      data-switch-active="true"
      data-connection={parentJobId ? `${parentJobId}->${node.job.id}` : undefined}
    >
      <TreeNode node={node} activeJobId={activeJobId} onSelectJob={onSelectJob} />
      {node.children.length ? (
        <ul>
          {node.children.map((child) =>
            renderNode(child, activeJobId, onSelectJob, node.job.id),
          )}
        </ul>
      ) : null}
    </li>
  );
}

export function VersionTreeView({
  jobId,
  jobs,
  initialData = null,
  familyState,
  staticPreview = false,
  fetchFamily,
  activeJobId,
  onSelectJob,
  applySwitchActive = async () => {},
  coordinator,
  pageTransition,
  onRejected,
}: VersionTreeViewProps) {
  const legacyData = useMemo(() => familyFromJobs(jobs), [jobs]);
  const hookState = useFamilyData({
    jobId: jobId ?? activeJobId,
    enabled: !jobs,
    disableRemoteFetch: staticPreview || Boolean(jobs),
    initialData: initialData ?? legacyData,
    fetchFamily,
  });
  const resolvedState = familyState ?? hookState;
  const familyData = resolvedState.data ?? initialData ?? legacyData;
  const familyJobs = familyData?.jobs ?? [];
  const switchActive = useSwitchActiveJob({
    jobs: familyJobs,
    activeJobId,
    apply: applySwitchActive,
    coordinator,
    pageTransition,
    onRejected,
  });
  const handleSelectJob = (nextJobId: string) => {
    onSelectJob?.(nextJobId);
    void switchActive(nextJobId);
  };

  if (staticPreview) {
    const layout = deriveVersionTreeLayout(familyJobs);
    return (
      <section data-testid="version-tree-view" data-state="static-preview">
        <p>Static preview does not support live version history.</p>
        {familyJobs.length ? (
          <ul>
            {layout.roots.map((root) => renderNode(root, activeJobId, handleSelectJob))}
          </ul>
        ) : null}
      </section>
    );
  }

  if (resolvedState.status === "error" && !familyData) {
    return (
      <section data-testid="version-tree-view" data-state="error">
        <p>{resolvedState.error?.message ?? "Version history could not be loaded."}</p>
      </section>
    );
  }

  if (!familyData && (resolvedState.loading || resolvedState.status === "loading")) {
    return (
      <section data-testid="version-tree-view" data-state="loading">
        <p>Loading version history...</p>
      </section>
    );
  }

  const layout = deriveVersionTreeLayout(familyJobs);
  const state = familyJobs.length === 0 ? "empty" : familyJobs.length === 1 ? "single" : "ready";

  return (
    <section data-testid="version-tree-view" data-state={state}>
      {familyJobs.length === 0 ? (
        <p>No version history yet.</p>
      ) : (
        <ul>
          {layout.roots.map((root) => renderNode(root, activeJobId, handleSelectJob))}
        </ul>
      )}
    </section>
  );
}
