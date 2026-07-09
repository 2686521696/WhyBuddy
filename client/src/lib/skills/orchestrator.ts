// SlideRule orchestrator — the end-to-end line: 一句话 → 调各 Skill → 串 resolve() →
// 统一 SPEC + 总关联图 + 汇总 gate。
//
// It is GENERIC: it knows nothing about RBAC/Workflow specifics. It only speaks the Skill
// interface. Two phases:
//   1) generate (in registration/dependency order), threading each skill's resolve()
//      surface forward so a later skill can be generated coherently.
//   2) assemble: validate EVERY model against the FULL set of cross-skill surfaces,
//      project each, then stitch the per-skill diagrams + cross-skill edges into one graph.

import {
  normalizeCrossRef,
  type CrossRefEdge,
  type CrossSkill,
  type Finding,
  type Projection,
  type ResolvableSurface,
  type Skill,
  type ValidationReport,
} from "./skill";
import {
  analyzeImpact,
  buildDependencyGraph as buildImpactDependencyGraph,
} from "./impact";
import type { DependencyGraph, ImpactReport, ResourceRef } from "./impact";
import {
  evaluateAppBundleRuntimeClosure,
  APPBUNDLE_RUNTIME_CLOSURE_BLOCKED,
  attachRuntimeClosureSummaryToReleaseArtifact,
  attachClosureEvidenceDigestToPublishManifest,
  type AppBundleRuntimeClosureReport,
} from "./appbundle/appBundleSkill";

export type {
  DependencyGraph,
  ImpactPath,
  ImpactedArtifact,
  ImpactReport,
  ResourceRef,
} from "./impact";

// A registry entry erases the model type but keeps the typed skill internally. Every method
// is only ever called with the model produced by that same skill, so the casts are sound.
interface RegisteredSkill {
  id: string;
  title: string;
  generate(
    intent: string,
    surfaces: Record<string, ResolvableSurface>
  ): Promise<unknown>;
  validate(
    model: unknown,
    surfaces: Record<string, ResolvableSurface>
  ): ValidationReport;
  project(model: unknown): Projection;
  resolve(model: unknown): ResolvableSurface;
  crossRefs(model: unknown): CrossRefEdge[];
  refNodeId(kind: string, value: string): string | null;
}

function register<T>(
  skill: Skill<T> & Partial<CrossSkill<T>>
): RegisteredSkill {
  return {
    id: skill.id,
    title: skill.title,
    generate: (intent, surfaces) =>
      skill.generate
        ? skill.generate(intent, { external: surfaces })
        : Promise.reject(new Error(`skill ${skill.id} 无 generate 实现`)),
    validate: (model, surfaces) =>
      skill.validate(model as T, { external: surfaces }),
    project: model => skill.project(model as T),
    resolve: model => skill.resolve(model as T),
    crossRefs: model =>
      skill.crossRefs ? skill.crossRefs(model as T).map(normalizeCrossRef) : [],
    refNodeId: (kind, value) =>
      skill.refNodeId ? skill.refNodeId(kind, value) : null,
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
  bySkill: Array<{
    skillId: string;
    title: string;
    ok: boolean;
    errors: Finding[];
    warnings: Finding[];
  }>;
}

/** The unified artifact — one application described across every skill's metamodel. */
export interface ApplicationSpec {
  intent: string;
  generatedAt: string;
  skills: Record<string, unknown>;
}

export interface CrossRuntimeGraphEdge {
  sourceSkill: string;
  targetSkill: string;
  state: string;
  evidenceKey?: string;
  raw: string;
}

export interface CrossRuntimeGraph {
  edges: CrossRuntimeGraphEdge[];
  bySkill: Record<string, CrossRuntimeGraphEdge[]>;
  evidenceBySkill: Record<string, string[]>;
}

export interface OrchestratorResult {
  intent: string;
  /** the gate: true iff every skill's validate passed. */
  ok: boolean;
  spec: ApplicationSpec;
  report: AggregateReport;
  runs: SkillRun[];
  /** runtime evidence graph derived from each skill's resolve().crossSkillRuntimeEdges. */
  crossRuntimeGraph: CrossRuntimeGraph;
  /** the combined relation diagram (per-skill subgraphs + cross-skill dashed edges). */
  mermaid: string;
}

function shapeNode(id: string, label: string, kind: string): string {
  const safe = label.replace(/"/g, "'");
  if (kind === "start" || kind === "end") return `${id}(["${safe}"])`;
  if (kind === "branch") return `${id}{"${safe}"}`;
  return `${id}["${safe}"]`;
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
  assemble(
    intent: string,
    models: Record<string, unknown>
  ): OrchestratorResult {
    const active = this.skills.filter(s => s.id in models);

    // full cross-skill surfaces — every skill sees every other's resolve()
    const surfaces: Record<string, ResolvableSurface> = {};
    for (const skill of active)
      surfaces[skill.id] = skill.resolve(models[skill.id]);

    const runs: SkillRun[] = [];
    const bySkill: AggregateReport["bySkill"] = [];
    let errorTotal = 0;
    let warnTotal = 0;

    for (const skill of active) {
      const model = models[skill.id];
      const report = skill.validate(model, surfaces);
      const projection = skill.project(model);
      runs.push({ skillId: skill.id, title: skill.title, report, projection });
      bySkill.push({
        skillId: skill.id,
        title: skill.title,
        ok: report.ok,
        errors: report.errors,
        warnings: report.warnings,
      });
      errorTotal += report.errors.length;
      warnTotal += report.warnings.length;
    }

    const crossRuntimeGraph = this.buildCrossRuntimeGraphFromSurfaces(
      active.map(skill => skill.id),
      surfaces
    );
    const mermaid = this.combineDiagram(active, models, runs);
    const ok = runs.every(r => r.report.ok);

    return {
      intent,
      ok,
      spec: {
        intent,
        generatedAt: new Date().toISOString(),
        skills: { ...models },
      },
      report: {
        ok,
        totals: { errors: errorTotal, warnings: warnTotal },
        bySkill,
      },
      runs,
      crossRuntimeGraph,
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
    runtimeClosure?: AppBundleRuntimeClosureReport;
    /** AppBundle release artifact evidence with runtime closure summary attached (for publish/runtime closure aggregator). */
    releaseArtifactWithRuntimeClosure?: any;
    /** AppBundle publish manifest with closure evidence digest attached (exposes publish closure evidence digest through publish manifest surface). */
    publishManifestWithClosureDigest?: any;
    /** Unresolved cross-refs (after normalize) remain explicit for contract visibility. */
    unresolvedRefs?: CrossRefEdge[];
  } {
    const result = this.assemble("(publish)", models);
    const blockers: Finding[] = result.runs.flatMap(r => r.report.errors);

    // closure check: resolve every cross-ref against the full set of registered surfaces
    const active = this.skills.filter(s => s.id in models);
    const surfaces = new Map(active.map(s => [s.id, s.resolve(models[s.id])]));
    const unresolvedRefs: CrossRefEdge[] = [];
    for (const skill of active) {
      for (const ref of skill.crossRefs(models[skill.id])) {
        const targetSurface = surfaces.get(ref.toSkill);
        const resolved =
          targetSurface?.[ref.toKind]?.includes(ref.toValue) ?? false;
        if (!resolved) {
          unresolvedRefs.push(ref);
          if ((ref.severity ?? "error") === "error") {
            blockers.push({
              code: "PUBLISH_DANGLING_CROSSREF",
              severity: "error",
              path: `${skill.id}:${ref.fromNode}`,
              message: `跨系统引用未闭合：${skill.id} 经「${ref.label ?? ""}」引用 ${ref.toSkill}.${ref.toKind}="${ref.toValue}"，但目标不存在/未接入`,
            });
          }
        }
      }
    }

    // 117 runtime closure: execute full AppBundle runtime closure check across all six Skills (pure, deterministic).
    // Adds APPBUNDLE_RUNTIME_CLOSURE_BLOCKED for missing runtime evidence (pins, policy, bindings, PDP, task views, AIGC, unresolved).
    let runtimeClosure: AppBundleRuntimeClosureReport | undefined;
    if ("appbundle" in models) {
      runtimeClosure = evaluateAppBundleRuntimeClosure(models);
      if (runtimeClosure.blocked) {
        runtimeClosure.blockers.forEach(b => {
          // avoid duplicate codes if already present
          if (
            !blockers.some(
              bb =>
                bb.code === b.code &&
                bb.path === b.path &&
                bb.message === b.message
            )
          ) {
            blockers.push(b);
          }
        });
      }
    }

    // Attach runtime closure summary to AppBundle release artifact evidence.
    // Executed in publishGate (AppBundle publish aggregator) to ensure release artifact
    // layer carries the summary (positive evidence + fail-closed blocked state).
    // Does not mutate inputs; pure helper; does not affect gate publishable decision.
    let releaseArtifactWithRuntimeClosure: any = undefined;
    if (runtimeClosure && "appbundle" in models) {
      const abModel = (models as any).appbundle;
      if (abModel && abModel.releaseArtifact) {
        releaseArtifactWithRuntimeClosure =
          attachRuntimeClosureSummaryToReleaseArtifact(
            abModel.releaseArtifact,
            runtimeClosure
          );
      }
    }

    // Attach closure evidence digest to AppBundle publish manifest (this task).
    // Pure attachment in publish aggregator to expose digest on the publish manifest surface.
    // Positive: digest present when evidence collected; negative/fail-closed: digest still attached even if blocked.
    let publishManifestWithClosureDigest: any = undefined;
    if (runtimeClosure && "appbundle" in models) {
      const abModel = (models as any).appbundle;
      if (abModel && abModel.publishManifest) {
        publishManifestWithClosureDigest =
          attachClosureEvidenceDigestToPublishManifest(
            abModel.publishManifest,
            runtimeClosure.stableDigest
          );
      }
    }

    return {
      publishable: blockers.length === 0,
      blockers,
      result,
      runtimeClosure,
      releaseArtifactWithRuntimeClosure,
      publishManifestWithClosureDigest,
      unresolvedRefs,
    };
  }

  buildDependencyGraph(models: Record<string, unknown>): DependencyGraph {
    const active = this.skills.filter(s => s.id in models);
    return buildImpactDependencyGraph(active, models);
  }

  impact(models: Record<string, unknown>, target: ResourceRef): ImpactReport {
    return analyzeImpact(this.buildDependencyGraph(models), target);
  }

  buildCrossRuntimeGraph(models: Record<string, unknown>): CrossRuntimeGraph {
    const active = this.skills.filter(s => s.id in models);
    const surfaces: Record<string, ResolvableSurface> = {};
    for (const skill of active)
      surfaces[skill.id] = skill.resolve(models[skill.id]);
    return this.buildCrossRuntimeGraphFromSurfaces(
      active.map(skill => skill.id),
      surfaces
    );
  }

  private buildCrossRuntimeGraphFromSurfaces(
    skillIds: string[],
    surfaces: Record<string, ResolvableSurface>
  ): CrossRuntimeGraph {
    const bySkill: Record<string, CrossRuntimeGraphEdge[]> = {};
    const evidenceBySkill: Record<string, string[]> = {};
    const edges: CrossRuntimeGraphEdge[] = [];

    for (const skillId of skillIds) {
      const surface = surfaces[skillId] ?? {};
      const rawEdges = Array.isArray(surface.crossSkillRuntimeEdges)
        ? surface.crossSkillRuntimeEdges
        : [];
      const evidence = Array.isArray(surface.runtimeEvidence)
        ? surface.runtimeEvidence
        : [];
      evidenceBySkill[skillId] = [...evidence];
      bySkill[skillId] = [];

      rawEdges.forEach((raw, index) => {
        const match = String(raw).match(/^([^:]+?)->([^:]+?):(.+)$/);
        if (!match) return;
        const edge: CrossRuntimeGraphEdge = {
          sourceSkill: match[1],
          targetSkill: match[2],
          state: match[3],
          evidenceKey: evidence[index],
          raw: String(raw),
        };
        bySkill[skillId].push(edge);
        edges.push(edge);
      });
    }

    return { edges, bySkill, evidenceBySkill };
  }

  private combineDiagram(
    active: RegisteredSkill[],
    models: Record<string, unknown>,
    runs: SkillRun[]
  ): string {
    const lines: string[] = ["flowchart LR"];
    const byId = new Map(active.map(s => [s.id, s]));

    // 1) one subgraph per skill, nodes inside
    for (const run of runs) {
      lines.push(`  subgraph ${run.skillId}["${run.title}"]`);
      for (const n of run.projection.nodes)
        lines.push(`    ${shapeNode(n.id, n.label, n.kind)}`);
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
          lines.push(
            `  ${ref.fromNode} -.->|${ref.label ?? ""}| ${targetNode}`
          );
        } else {
          // dependency on a skill that isn't wired in yet — show it honestly as a ghost.
          const ghostId = `ext_${ref.toSkill}_${ref.toValue.replace(/[^a-zA-Z0-9_]/g, "_")}`;
          ghosts.set(ghostId, `${ref.toSkill}:${ref.toValue}<br/>(未接入)`);
          lines.push(`  ${ref.fromNode} -.->|${ref.label ?? ""}| ${ghostId}`);
        }
      }
    }
    for (const [id, label] of ghosts) lines.push(`  ${id}["${label}"]:::ghost`);
    if (ghosts.size)
      lines.push("  classDef ghost stroke-dasharray:4,fill:#f7f7f7,color:#999");

    return lines.join("\n");
  }
}
