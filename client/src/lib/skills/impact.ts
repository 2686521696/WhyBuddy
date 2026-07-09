import type { CrossRefEdge, Projection, ResolvableSurface } from "./skill";

export interface ResourceRef {
  skill: string;
  kind: string;
  value: string;
}

export interface DependencySkill {
  id: string;
  title: string;
  project(model: unknown): Projection;
  resolve(model: unknown): ResolvableSurface;
  crossRefs(model: unknown): CrossRefEdge[];
  refNodeId(kind: string, value: string): string | null;
}

export interface DependencyGraphNode {
  id: string;
  skill: string;
  skillTitle: string;
  node: string;
  label: string;
  kind: string;
  resource?: ResourceRef;
}

export type DependencyGraphEdgeKind = "crossRef" | "owner";

export interface DependencyGraphEdge {
  from: string;
  to: string;
  kind: DependencyGraphEdgeKind;
  label?: string;
}

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  resourceToNode: Record<string, string>;
  mermaid: string;
}

export interface ImpactPathStep {
  skill: string;
  skillTitle: string;
  node: string;
  label: string;
  kind: string;
  via: string;
  depth: number;
}

export interface ImpactPath {
  target: ResourceRef;
  steps: ImpactPathStep[];
}

/** One artifact that would break if a resource is changed or removed. */
export interface ImpactedArtifact {
  skill: string;
  skillTitle: string;
  node: string;
  label: string;
  via: string;
  depth: number;
}

export interface ImpactReport {
  target: ResourceRef;
  safe: boolean;
  impacted: ImpactedArtifact[];
  paths: ImpactPath[];
  graph: DependencyGraph;
}

function resourceKey(ref: ResourceRef): string {
  return `${ref.skill}::${ref.kind}::${ref.value}`;
}

function nodeKey(skillId: string, nodeId: string): string {
  return `${skillId}::${nodeId}`;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isOwnerEdge(kind: string): boolean {
  return ["binding", "contains", "menu", "publishGate", "runtimeSnapshot", "workflow"].includes(kind);
}

function addEdge(edges: Map<string, DependencyGraphEdge>, edge: DependencyGraphEdge): void {
  edges.set(`${edge.from}->${edge.to}:${edge.kind}:${edge.label ?? ""}`, edge);
}

function toMermaid(nodes: DependencyGraphNode[], edges: DependencyGraphEdge[]): string {
  const lines = ["flowchart LR"];
  for (const node of nodes) lines.push(`  ${node.id.replace(/::/g, "__")}["${node.label.replace(/"/g, "'")}"]`);
  for (const edge of edges) {
    const from = edge.from.replace(/::/g, "__");
    const to = edge.to.replace(/::/g, "__");
    const label = edge.label ? `|${edge.label}|` : "";
    lines.push(`  ${from} -->${label} ${to}`);
  }
  return lines.join("\n");
}

export function buildDependencyGraph(
  skills: DependencySkill[],
  models: Record<string, unknown>,
): DependencyGraph {
  const active = skills.filter(skill => skill.id in models);
  const byId = new Map(active.map(skill => [skill.id, skill]));
  const nodeByKey = new Map<string, DependencyGraphNode>();
  const resourceToNode = new Map<string, string>();
  const edges = new Map<string, DependencyGraphEdge>();

  for (const skill of active) {
    const projection = skill.project(models[skill.id]);
    for (const node of projection.nodes) {
      nodeByKey.set(nodeKey(skill.id, node.id), {
        id: nodeKey(skill.id, node.id),
        skill: skill.id,
        skillTitle: skill.title,
        node: node.id,
        label: node.label,
        kind: node.kind,
      });
    }

    const surface = skill.resolve(models[skill.id]);
    for (const [kind, values] of Object.entries(surface)) {
      if (!isStringList(values)) continue;
      for (const value of values) {
        const projectionNode = skill.refNodeId(kind, value);
        if (!projectionNode) continue;
        const key = nodeKey(skill.id, projectionNode);
        const graphNode = nodeByKey.get(key);
        if (!graphNode) continue;
        const ref = { skill: skill.id, kind, value };
        graphNode.resource = ref;
        resourceToNode.set(resourceKey(ref), key);
      }
    }

    for (const edge of projection.edges) {
      if (!isOwnerEdge(edge.kind)) continue;
      const child = nodeKey(skill.id, edge.to);
      const owner = nodeKey(skill.id, edge.from);
      if (!nodeByKey.has(child) || !nodeByKey.has(owner)) continue;
      addEdge(edges, { from: child, to: owner, kind: "owner", label: edge.label ?? edge.kind });
    }

    const workflowRoots = projection.nodes.filter(node => node.kind === "workflow");
    if (skill.id === "workflow" && workflowRoots.length === 1) {
      const owner = nodeKey(skill.id, workflowRoots[0].id);
      for (const node of projection.nodes) {
        const child = nodeKey(skill.id, node.id);
        if (child === owner) continue;
        addEdge(edges, { from: child, to: owner, kind: "owner", label: "workflow" });
      }
    }
  }

  for (const skill of active) {
    for (const ref of skill.crossRefs(models[skill.id])) {
      const source = nodeKey(skill.id, ref.fromNode);
      const targetSkill = byId.get(ref.toSkill);
      const targetNode = targetSkill?.refNodeId(ref.toKind, ref.toValue);
      if (!targetNode) continue;

      const target = nodeKey(ref.toSkill, targetNode);
      if (!nodeByKey.has(source) || !nodeByKey.has(target)) continue;
      addEdge(edges, { from: target, to: source, kind: "crossRef", label: ref.label });
      if (
        skill.id === "rbac" &&
        ref.toSkill === "datamodel" &&
        (ref.label === "field" || ref.label === "row")
      ) {
        addEdge(edges, { from: source, to: target, kind: "crossRef", label: `${ref.label} policy scope` });
      }
    }
  }

  const nodes = [...nodeByKey.values()];
  const edgeList = [...edges.values()];
  return {
    nodes,
    edges: edgeList,
    resourceToNode: Object.fromEntries(resourceToNode),
    mermaid: toMermaid(nodes, edgeList),
  };
}

export function analyzeImpact(graph: DependencyGraph, target: ResourceRef, maxDepth = 8): ImpactReport {
  const targetNode = graph.resourceToNode[resourceKey(target)];
  if (!targetNode) return { target, safe: true, impacted: [], paths: [], graph };

  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, DependencyGraphEdge[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const toStep = (nodeId: string, depth: number, via = ""): ImpactPathStep => {
    const node = nodeById.get(nodeId);
    return {
      skill: node?.skill ?? "",
      skillTitle: node?.skillTitle ?? "",
      node: node?.node ?? nodeId,
      label: node?.label ?? nodeId,
      kind: node?.kind ?? "",
      via,
      depth,
    };
  };

  const paths: ImpactPath[] = [];
  const queue: Array<{ node: string; steps: ImpactPathStep[]; seen: Set<string> }> = [
    { node: targetNode, steps: [toStep(targetNode, 0)], seen: new Set([targetNode]) },
  ];

  while (queue.length) {
    const item = queue.shift()!;
    if (item.steps.length - 1 >= maxDepth) continue;

    for (const edge of outgoing.get(item.node) ?? []) {
      if (item.seen.has(edge.to)) continue;
      const nextSteps = [...item.steps, toStep(edge.to, item.steps.length, edge.label ?? edge.kind)];
      paths.push({ target, steps: nextSteps });
      queue.push({
        node: edge.to,
        steps: nextSteps,
        seen: new Set([...item.seen, edge.to]),
      });
    }
  }

  const impactedByNode = new Map<string, ImpactedArtifact>();
  for (const path of paths) {
    const last = path.steps[path.steps.length - 1];
    const existing = impactedByNode.get(`${last.skill}::${last.node}`);
    if (existing && existing.depth <= last.depth) continue;
    impactedByNode.set(`${last.skill}::${last.node}`, {
      skill: last.skill,
      skillTitle: last.skillTitle,
      node: last.node,
      label: last.label,
      via: last.via,
      depth: last.depth,
    });
  }

  const impacted = [...impactedByNode.values()].sort((a, b) => a.depth - b.depth || a.node.localeCompare(b.node));
  return { target, safe: impacted.length === 0, impacted, paths, graph };
}

export function impact(
  skills: DependencySkill[],
  models: Record<string, unknown>,
  target: ResourceRef,
): ImpactReport {
  return analyzeImpact(buildDependencyGraph(skills, models), target);
}
