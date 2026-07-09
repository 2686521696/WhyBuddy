import { latestTrustedReport } from "@shared/blueprint/sliderule-delivery-chain";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

/** Walk dependencyGraph + evidenceRefs upstream from trusted report for lineage highlight. */
export function deriveLineageHighlightNodeIds(state: V5SessionState): string[] {
  const report = latestTrustedReport(state);
  if (!report) return [];

  const artifactIds = new Set<string>([report.id]);
  const queue = [...(report.evidenceRefs || [])];
  const seenArt = new Set<string>([report.id]);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seenArt.has(id)) continue;
    seenArt.add(id);
    artifactIds.add(id);
    const art = (state.artifacts || []).find((a) => a.id === id);
    for (const ref of art?.evidenceRefs || []) {
      if (!seenArt.has(ref)) queue.push(ref);
    }
  }

  for (const edge of state.dependencyGraph || []) {
    if (artifactIds.has(edge.toArtifactId)) {
      artifactIds.add(edge.fromArtifactId);
    }
  }

  const nodeIds = new Set<string>();
  for (const node of state.graph?.nodes || []) {
    const artId = (node as { producedArtifactId?: string }).producedArtifactId;
    if (artId && artifactIds.has(artId)) {
      nodeIds.add(node.id);
    }
  }

  return [...nodeIds];
}

function graphNodeForArtifactDirect(
  state: V5SessionState,
  artifactId: string
): string | undefined {
  const direct = (state.graph?.nodes || []).find(
    (n) => (n as { producedArtifactId?: string }).producedArtifactId === artifactId
  );
  if (direct) return direct.id;

  const art = (state.artifacts || []).find((a) => a.id === artifactId);
  const runId = art?.producedBy?.capabilityRunId;
  if (runId) {
    const byRun = (state.graph?.nodes || []).find(
      (n) => (n as { capabilityRunId?: string }).capabilityRunId === runId
    );
    if (byRun) return byRun.id;
  }
  return undefined;
}

/** Map evidence artifact id → graph node id for report reader jump targets. */
export function graphNodeIdForArtifact(
  state: V5SessionState,
  artifactId: string
): string | undefined {
  const direct = graphNodeForArtifactDirect(state, artifactId);
  if (direct) return direct;

  for (const parentArt of state.artifacts || []) {
    if (!(parentArt.evidenceRefs || []).includes(artifactId)) continue;
    const parentNodeId = graphNodeForArtifactDirect(state, parentArt.id);
    if (parentNodeId) return `${parentNodeId}::ev-${artifactId}`;
  }

  return undefined;
}