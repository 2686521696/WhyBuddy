import type {
  VersionHistoryJob,
  VersionTreeLayout,
  VersionTreeLayoutNode,
} from "./types";

function branchSortTime(job: VersionHistoryJob): number {
  const raw = job.branchedAt ?? job.createdAt;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function compareJobs(a: VersionHistoryJob, b: VersionHistoryJob): number {
  const byTime = branchSortTime(a) - branchSortTime(b);
  return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
}

function hasParentCycle(
  job: VersionHistoryJob,
  jobsById: Map<string, VersionHistoryJob>
): boolean {
  const seen = new Set<string>();
  let cursor: VersionHistoryJob | undefined = job;

  while (cursor?.parentJobId) {
    if (seen.has(cursor.id)) {
      return true;
    }
    seen.add(cursor.id);
    cursor = jobsById.get(cursor.parentJobId);
  }

  return false;
}

function assignDepth(node: VersionTreeLayoutNode, depth: number): void {
  node.depth = depth;
  for (const child of node.children) {
    assignDepth(child, depth + 1);
  }
}

export function deriveVersionTreeLayout(
  jobs: VersionHistoryJob[]
): VersionTreeLayout {
  const jobsById = new Map<string, VersionHistoryJob>();
  for (const job of jobs) {
    jobsById.set(job.id, job);
  }

  const nodesById: Record<string, VersionTreeLayoutNode> = {};
  for (const job of jobsById.values()) {
    nodesById[job.id] = {
      job,
      depth: 0,
      children: [],
      missingParent: false,
      cycleDetected: false,
    };
  }

  const roots: VersionTreeLayoutNode[] = [];
  const warnings: VersionTreeLayout["warnings"] = [];

  for (const node of Object.values(nodesById)) {
    const { parentJobId } = node.job;
    if (!parentJobId) {
      roots.push(node);
      continue;
    }

    const parent = nodesById[parentJobId];
    if (!parent) {
      node.missingParent = true;
      warnings.push({
        type: "missing-parent",
        jobId: node.job.id,
        parentJobId,
      });
      roots.push(node);
      continue;
    }

    if (hasParentCycle(node.job, jobsById)) {
      node.cycleDetected = true;
      warnings.push({ type: "cycle", jobId: node.job.id, parentJobId });
      roots.push(node);
      continue;
    }

    parent.children.push(node);
  }

  for (const node of Object.values(nodesById)) {
    node.children.sort((a, b) => compareJobs(a.job, b.job));
  }
  roots.sort((a, b) => compareJobs(a.job, b.job));
  for (const root of roots) {
    assignDepth(root, 0);
  }

  return { roots, nodesById, warnings };
}
