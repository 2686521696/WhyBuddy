import type { KeyboardEvent } from "react";

import type { StaleAwareArtifact, VersionTreeLayoutNode } from "./types";

interface TreeNodeProps {
  node: VersionTreeLayoutNode;
  activeJobId: string | null;
  onSelectJob?: (jobId: string) => void;
  onSelect?: (jobId: string) => void;
}

function hasStaleMarker(node: VersionTreeLayoutNode): boolean {
  if (node.job.staleArtifactIds?.length) {
    return true;
  }

  return node.job.artifacts.some((artifact) => {
    const staleArtifact = artifact as StaleAwareArtifact;
    return Boolean(staleArtifact.staleSince || staleArtifact.invalidatedBy);
  });
}

function shortJobId(jobId: string): string {
  return jobId.length > 12 ? `${jobId.slice(0, 8)}...` : jobId;
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    input: "输入",
    clarification: "澄清",
    route_generation: "路线",
    spec_tree: "规格树",
    spec_docs: "规格文档",
    preview: "预览",
    effect_preview: "效果预览",
    prompt_packaging: "提示包",
    runtime_capability: "运行能力",
    engineering_handoff: "工程交接",
    engineering_landing: "工程落地",
  };
  return labels[stage] ?? stage;
}

export function TreeNode({ node, activeJobId, onSelectJob, onSelect }: TreeNodeProps) {
  const isActive = activeJobId === node.job.id;
  const isStale = hasStaleMarker(node);
  const select = onSelectJob ?? onSelect;
  const handleSelect = () => select?.(node.job.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      handleSelect();
    }
  };

  return (
    <button
      type="button"
      data-testid="version-tree-node"
      data-job-id={node.job.id}
      data-depth={node.depth}
      data-active={isActive}
      data-stale={isStale}
      data-missing-parent={node.missingParent}
      data-cycle-detected={node.cycleDetected}
      title={`${node.job.id} / ${node.job.stage} / ${node.job.status}`}
      style={{
        marginLeft: node.depth * 24,
        borderLeftWidth: node.depth > 0 ? 3 : 1,
      }}
      className="w-full border border-[#d1d5db] bg-white px-3 py-2 text-left"
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
    >
      <span className="block text-sm font-semibold">{shortJobId(node.job.id)}</span>
      <span className="block text-xs text-[#4b5563]">
        {stageLabel(node.job.stage)} / {node.job.status}
      </span>
      {isActive ? <span className="text-xs font-semibold">active</span> : null}
      {isStale ? <span className="text-xs font-semibold">stale</span> : null}
      {node.job.parentJobId ? (
        <span className="block text-xs text-[#4b5563]">
          branch from {node.job.branchedFromStage ?? "unknown"} at{" "}
          {node.job.branchedAt ?? node.job.createdAt}
        </span>
      ) : null}
    </button>
  );
}
