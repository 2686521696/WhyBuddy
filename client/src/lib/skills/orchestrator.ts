// SlideRule orchestrator — the end-to-end line: 一句话 → 调各 Skill → 串 resolve() →
// 统一 SPEC + 总关联图 + 汇总 gate。
//
// It is GENERIC: it knows nothing about RBAC/Workflow specifics. It only speaks the Skill
// interface. Two phases:
//   1) generate (in registration/dependency order), threading each skill's resolve()
//      surface forward so a later skill can be generated coherently.
//   2) assemble: validate EVERY model against the FULL set of cross-skill surfaces,
//      project each, then stitch the per-skill diagrams + cross-skill edges into one graph.

import type {
  CrossRefEdge,
  CrossSkill,
  Finding,
  Projection,
  ResolvableSurface,
  Skill,
  ValidationReport,
} from "./skill";

// A registry entry erases the model type but keeps the typed skill internally. Every method
// is only ever called with the model produced by that same skill, so the casts are sound.
interface RegisteredSkill {
  id: string;
  title: string;
  generate(intent: string, surfaces: Record<string, ResolvableSurface>): Promise<unknown>;
  validate(model: unknown, surfaces: Record<string, ResolvableSurface>): ValidationReport;
  project(model: unknown): Projection;
  resolve(model: unknown): ResolvableSurface;
  crossRefs(model: unknown): CrossRefEdge[];
  refNodeId(kind: string, value: string): string | null;
}

function register<T>(skill: Skill<T> & Partial<CrossSkill<T>>): RegisteredSkill {
  return {
    id: skill.id,
    title: skill.title,
    generate: (intent, surfaces) =>
      skill.generate
        ? skill.generate(intent, { external: surfaces })
        : Promise.reject(new Error(`skill ${skill.id} 无 generate 实现`)),
    validate: (model, surfaces) => skill.validate(model as T, { external: surfaces }),
    project: model => skill.project(model as T),
    resolve: model => skill.resolve(model as T),
    crossRefs: model => (skill.crossRefs ? skill.crossRefs(model as T) : []),
    refNodeId: (kind, value) => (skill.refNodeId ? skill.refNodeId(kind, value) : null),
  };
}

export interface SkillRun {
  skillId: string;
  title: string;
  report: ValidationReport;
  projection: Projection;
}

export interface AggregateReport {
  ok: boolean;
  totals: { errors: number; warnings: number };
  bySkill: Array<{ skillId: string; title: string; ok: boolean; errors: Finding[]; warnings: Finding[] }>;
}

/** The unified artifact — one application described across every skill's metamodel. */
export interface ApplicationSpec {
  intent: string;
  generatedAt: string;
  skills: Record<string, unknown>;
}

export interface OrchestratorResult {
  intent: string;
  /** the gate: true iff every skill's validate passed. */
  ok: boolean;
  spec: ApplicationSpec;
  report: AggregateReport;
  runs: SkillRun[];
  /** the combined relation diagram (per-skill subgraphs + cross-skill dashed edges). */
  mermaid: string;
}

function shapeNode(id: string, label: string, kind: string): string {
  const safe = label.replace(/"/g, "'");
  if (kind === "start" || kind === "end") return `${id}(["${safe}"])`;
  if (kind === "branch") return `${id}{"${safe}"}`;
  return `${id}["${safe}"]`;
}

/** A resource another skill may reference, e.g. { skill:"rbac", kind:"role", value:"manager" }. */
export interface ResourceRef {
  skill: string;
  kind: string;
  value: string;
}

/** One artifact that would break if a resource is changed/removed. */
export interface ImpactedArtifact {
  skill: string;
  skillTitle: string;
  /** projection node id of the dependent artifact */
  node: string;
  /** human label of the dependent artifact */
  label: string;
  /** the reference kind that links it to the target, e.g. "审批人" / "数据" */
  via: string;
  /** hops from the changed resource (1 = direct dependent) */
  depth: number;
}

export interface ImpactReport {
  target: ResourceRef;
  /** true iff nothing depends on the target — safe to change/remove */
  safe: boolean;
  impacted: ImpactedArtifact[];
}

function refKey(r: ResourceRef): string {
  return `${r.skill}::${r.kind}::${r.value}`;
}

export class Orchestrator {
  private readonly skills: RegisteredSkill[] = [];

  /** Register a skill. Order matters for generation (dependencies first). */
  use<T>(skill: Skill<T> & Partial<CrossSkill<T>>): this {
    this.skills.push(register(skill));
    return this;
  }

  /** Full run: generate every skill's model from the intent, then assemble. */
  async run(intent: string): Promise<OrchestratorResult> {
    const models: Record<string, unknown> = {};
    const surfacesSoFar: Record<string, ResolvableSurface> = {};
    for (const skill of this.skills) {
      const model = await skill.generate(intent, surfacesSoFar);
      models[skill.id] = model;
      surfacesSoFar[skill.id] = skill.resolve(model);
    }
    return this.assemble(intent, models);
  }

  /** Pure assembly from already-built models — validate (full cross-surfaces), project, combine. */
  assemble(intent: string, models: Record<string, unknown>): OrchestratorResult {
    const active = this.skills.filter(s => s.id in models);

    // full cross-skill surfaces — every skill sees every other's resolve()
    const surfaces: Record<string, ResolvableSurface> = {};
    for (const skill of active) surfaces[skill.id] = skill.resolve(models[skill.id]);

    const runs: SkillRun[] = [];
    const bySkill: AggregateReport["bySkill"] = [];
    let errorTotal = 0;
    let warnTotal = 0;

    for (const skill of active) {
      const model = models[skill.id];
      const report = skill.validate(model, surfaces);
      const projection = skill.project(model);
      runs.push({ skillId: skill.id, title: skill.title, report, projection });
      bySkill.push({ skillId: skill.id, title: skill.title, ok: report.ok, errors: report.errors, warnings: report.warnings });
      errorTotal += report.errors.length;
      warnTotal += report.warnings.length;
    }

    const mermaid = this.combineDiagram(active, models, runs);
    const ok = runs.every(r => r.report.ok);

    return {
      intent,
      ok,
      spec: { intent, generatedAt: new Date().toISOString(), skills: { ...models } },
      report: { ok, totals: { errors: errorTotal, warnings: warnTotal }, bySkill },
      runs,
      mermaid,
    };
  }

  /**
   * Publish gate — the executable version of the App-Center composition root (kernel ⑥,
   * review finding P1-5). An application is publishable iff:
   *   (a) every skill's own gate passes (no errors), AND
   *   (b) the cross-system reference closure is complete — every declared cross-ref
   *       resolves to a real resource in some registered skill (no "未接入" dangling deps).
   */
  publishGate(models: Record<string, unknown>): {
    publishable: boolean;
    blockers: Finding[];
    result: OrchestratorResult;
  } {
    const result = this.assemble("(publish)", models);
    const blockers: Finding[] = result.runs.flatMap(r => r.report.errors);

    // closure check: resolve every cross-ref against the full set of registered surfaces
    const active = this.skills.filter(s => s.id in models);
    const surfaces = new Map(active.map(s => [s.id, s.resolve(models[s.id])]));
    for (const skill of active) {
      for (const ref of skill.crossRefs(models[skill.id])) {
        const targetSurface = surfaces.get(ref.toSkill);
        const resolved = targetSurface?.[ref.toKind]?.includes(ref.toValue) ?? false;
        if (!resolved)
          blockers.push({
            code: "PUBLISH_DANGLING_CROSSREF",
            severity: "error",
            path: `${skill.id}:${ref.fromNode}`,
            message: `跨系统引用未闭合：${skill.id} 经「${ref.label ?? ""}」引用 ${ref.toSkill}.${ref.toKind}="${ref.toValue}"，但目标不存在/未接入`,
          });
      }
    }

    return { publishable: blockers.length === 0, blockers, result };
  }

  /**
   * Cross-system impact analysis — the executable version of the "global invalidation /
   * dependency graph" the reference architectures are MISSING (review finding P0-2).
   *
   * Given a resource (e.g. rbac role "manager"), reverse-traverse every skill's declared
   * cross-references to find every downstream artifact that would break if it is changed or
   * removed — across system boundaries, transitively. This is what a role rename in RBAC
   * needs in order to invalidate the workflow node and page that reference it.
   */
  impact(models: Record<string, unknown>, target: ResourceRef): ImpactReport {
    const active = this.skills.filter(s => s.id in models);

    // 1) projections give human labels for nodes
    const projById = new Map(active.map(s => [s.id, s.project(models[s.id])]));
    const labelOf = (skillId: string, node: string): string =>
      projById.get(skillId)?.nodes.find(n => n.id === node)?.label ?? node;

    // 2) addressable map: which (skill, node) IS itself a referenceable resource, so impact
    //    can continue transitively (a broken artifact may be depended on by yet another).
    const nodeToResource = new Map<string, ResourceRef>(); // key `${skill}::${node}` -> resource
    for (const skill of active) {
      const surface = skill.resolve(models[skill.id]);
      for (const [kind, values] of Object.entries(surface)) {
        for (const value of values) {
          const node = skill.refNodeId(kind, value);
          if (node) nodeToResource.set(`${skill.id}::${node}`, { skill: skill.id, kind, value });
        }
      }
    }

    // 3) reverse index: resource -> the artifacts that reference it
    const dependents = new Map<string, Array<{ skill: string; node: string; via: string }>>();
    for (const skill of active) {
      for (const ref of skill.crossRefs(models[skill.id])) {
        const key = refKey({ skill: ref.toSkill, kind: ref.toKind, value: ref.toValue });
        const list = dependents.get(key) ?? [];
        list.push({ skill: skill.id, node: ref.fromNode, via: ref.label ?? "" });
        dependents.set(key, list);
      }
    }

    // 4) BFS over the reverse index
    const impacted: ImpactedArtifact[] = [];
    const seen = new Set<string>();
    let frontier: Array<{ ref: ResourceRef; depth: number }> = [{ ref: target, depth: 0 }];
    while (frontier.length) {
      const next: Array<{ ref: ResourceRef; depth: number }> = [];
      for (const { ref, depth } of frontier) {
        for (const dep of dependents.get(refKey(ref)) ?? []) {
          const nodeKey = `${dep.skill}::${dep.node}`;
          if (seen.has(nodeKey)) continue;
          seen.add(nodeKey);
          const skillTitle = active.find(s => s.id === dep.skill)?.title ?? dep.skill;
          impacted.push({
            skill: dep.skill,
            skillTitle,
            node: dep.node,
            label: labelOf(dep.skill, dep.node),
            via: dep.via,
            depth: depth + 1,
          });
          // if this broken artifact is itself a referenceable resource, cascade
          const asResource = nodeToResource.get(nodeKey);
          if (asResource) next.push({ ref: asResource, depth: depth + 1 });
        }
      }
      frontier = next;
    }

    return { target, safe: impacted.length === 0, impacted };
  }

  private combineDiagram(
    active: RegisteredSkill[],
    models: Record<string, unknown>,
    runs: SkillRun[],
  ): string {
    const lines: string[] = ["flowchart LR"];
    const byId = new Map(active.map(s => [s.id, s]));

    // 1) one subgraph per skill, nodes inside
    for (const run of runs) {
      lines.push(`  subgraph ${run.skillId}["${run.title}"]`);
      for (const n of run.projection.nodes) lines.push(`    ${shapeNode(n.id, n.label, n.kind)}`);
      lines.push("  end");
    }

    // 2) internal edges (after subgraphs so mermaid keeps them inside the right groups)
    for (const run of runs) {
      for (const e of run.projection.edges) {
        if (e.kind === "cross") continue; // skip a skill's own external-ref edges; handled below
        lines.push(`  ${e.from} -->${e.label ? `|${e.label}|` : ""} ${e.to}`);
      }
    }

    // 3) cross-skill edges — resolve each ref to a node id in the TARGET skill's projection
    const ghosts = new Map<string, string>();
    for (const skill of active) {
      for (const ref of skill.crossRefs(models[skill.id])) {
        const target = byId.get(ref.toSkill);
        const targetNode = target?.refNodeId(ref.toKind, ref.toValue) ?? null;
        if (targetNode) {
          lines.push(`  ${ref.fromNode} -.->|${ref.label ?? ""}| ${targetNode}`);
        } else {
          // dependency on a skill that isn't wired in yet — show it honestly as a ghost.
          const ghostId = `ext_${ref.toSkill}_${ref.toValue.replace(/[^a-zA-Z0-9_]/g, "_")}`;
          ghosts.set(ghostId, `${ref.toSkill}:${ref.toValue}<br/>(未接入)`);
          lines.push(`  ${ref.fromNode} -.->|${ref.label ?? ""}| ${ghostId}`);
        }
      }
    }
    for (const [id, label] of ghosts) lines.push(`  ${id}["${label}"]:::ghost`);
    if (ghosts.size) lines.push("  classDef ghost stroke-dasharray:4,fill:#f7f7f7,color:#999");

    return lines.join("\n");
  }
}
