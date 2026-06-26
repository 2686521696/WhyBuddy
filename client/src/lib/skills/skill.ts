// A Skill is a runtime-less capability distilled from ONE subsystem of the heavy aPaaS
// (RBAC / Workflow / DataModel / Page / AppBundle). It carries NO database and NO running
// service — only the metamodel (as data) + the consistency gate + the projection.
//
// Every skill exposes four faces:
//   - the model type   : what this capability can express (the metamodel)
//   - validate(model)  : model -> consistency report   (PURE; THIS is the gate)
//   - project(model)   : model -> diagram/graph         (PURE; the architecture picture falls out here)
//   - resolve(model)   : the stable refs other skills may point at (cross-skill referential integrity)
// and one impure seam:
//   - generate(intent) : natural language -> a model instance (LLM-backed, plugged in later)
//
// The reasoning engine (SlideRule) orchestrates the five skills: it calls each skill's
// generate, threads the resolve() surfaces between them so cross-references stay coherent,
// runs every validate as a gate, and stitches the projections into one architecture map.

export type Severity = "error" | "warning";

export interface Finding {
  /** Stable machine code, e.g. "RBAC_REF_MISSING_PERMISSION". Lets the UI/agent react by code, not by string. */
  code: string;
  severity: Severity;
  /** Where in the model the problem is, e.g. "roles[manager].permissionCodes[1]". */
  path: string;
  /** Human-readable explanation. */
  message: string;
}

export interface ValidationReport {
  /** true iff there are zero error-severity findings. Warnings do not fail the gate. */
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
}

/** What a skill exposes for OTHER skills to reference. e.g. { role: ["employee","manager"], permission: [...] }. */
export type ResolvableSurface = Record<string, string[]>;

export interface ValidateContext {
  /** Surfaces resolved by other skills in this run, so cross-skill refs can be checked
   *  (e.g. an RBAC data rule pointing at a DataModel entity). Keyed by skill id. */
  external?: Record<string, ResolvableSurface>;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  kind: string;
}
export interface Projection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Ready-to-render diagram (the "架构图自动掉出来" output). */
  mermaid: string;
}

export interface Skill<TModel> {
  readonly id: string;
  readonly title: string;
  /** The gate. Pure. No IO. */
  validate(model: TModel, ctx?: ValidateContext): ValidationReport;
  /** The projector. Pure. Diagram derived from the model, never hand-drawn. */
  project(model: TModel): Projection;
  /** The cross-skill surface. Pure. */
  resolve(model: TModel): ResolvableSurface;
  /** The only impure seam — NL -> model. LLM-backed; optional in samples. */
  generate?(intent: string, ctx?: ValidateContext): Promise<TModel>;
}

/** One outgoing reference from this skill to another skill (for the combined relation graph). */
export interface CrossRefEdge {
  /** node id in THIS skill's own projection (the source of the dashed line). */
  fromNode: string;
  toSkill: string;
  toKind: string;
  toValue: string;
  label?: string;
}

/** Optional faces a skill implements so the orchestrator can stitch cross-skill edges. */
export interface CrossSkill<TModel> {
  /** Outgoing references to other skills. */
  crossRefs(model: TModel): CrossRefEdge[];
  /** Map (refKind, value) → a node id in THIS skill's projection, so others can point at it. */
  refNodeId(kind: string, value: string): string | null;
}

export function finalizeReport(findings: Finding[]): ValidationReport {
  const errors = findings.filter(f => f.severity === "error");
  const warnings = findings.filter(f => f.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}
