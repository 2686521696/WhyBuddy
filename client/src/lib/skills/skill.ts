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

/** One outgoing reference from this skill to another skill (for the combined relation graph).
 *  The orchestrator normalizes all fields (trim + defaults) for consistent resolution.
 */
export interface CrossRefEdge {
  /** node id in THIS skill's own projection (the source of the dashed line). */
  fromNode: string;
  toSkill: string;
  toKind: string;
  toValue: string;
  label?: string;
  /** Severity for dangling resolution in gates. "error" (default, blocks publish) | "warning" (soft). */
  severity?: Severity;
}

/** Optional faces a skill implements so the orchestrator can stitch cross-skill edges. */
export interface CrossSkill<TModel> {
  /** Outgoing references to other skills. */
  crossRefs(model: TModel): CrossRefEdge[];
  /** Map (refKind, value) → a node id in THIS skill's projection, so others can point at it. */
  refNodeId(kind: string, value: string): string | null;
}

/** Normalize a (possibly partial) cross-ref so fields are trimmed strings and severity defaults to "error".
 *  This is the visible standardization for the V2 cross-skill reference contract.
 */
export function normalizeCrossRef(edge: Partial<CrossRefEdge>): CrossRefEdge {
  const s = (v: unknown) => (v == null ? "" : String(v).trim());
  const sev = edge.severity === "warning" ? "warning" : "error";
  const label = edge.label != null ? s(edge.label) : undefined;
  return {
    fromNode: s(edge.fromNode),
    toSkill: s(edge.toSkill),
    toKind: s(edge.toKind),
    toValue: s(edge.toValue),
    label: label || undefined,
    severity: sev,
  };
}

export function finalizeReport(findings: Finding[]): ValidationReport {
  const errors = findings.filter(f => f.severity === "error");
  const warnings = findings.filter(f => f.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

// === V2 Finding Code Taxonomy (115) ===
// Stable prefix vocabulary for Finding.code. AgentLoop and orchestrators react to
// the prefix (not prose message) to decide handling. Covers the five legacy skills
// plus KERNEL for orchestrator-level/publish gate codes.
export const FINDING_CODE_PREFIXES = {
  RBAC: "RBAC",
  DATAMODEL: "DM",
  WORKFLOW: "WF",
  PAGE: "PAGE",
  APPBUNDLE: "APPBUNDLE",
  KERNEL: "PUBLISH",
} as const;

export type FindingCodePrefixCategory = keyof typeof FINDING_CODE_PREFIXES;

export const ALLOWED_FINDING_CODE_PREFIXES: readonly string[] =
  Object.values(FINDING_CODE_PREFIXES);

/** Extract the leading prefix (before first "_") for taxonomy classification. */
export function getFindingCodePrefix(code: string): string | null {
  if (typeof code !== "string" || code.length === 0) return null;
  const idx = code.indexOf("_");
  return idx > 0 ? code.slice(0, idx) : code;
}

/** True when the code uses one of the declared prefixes. Used for lightweight contract assertions. */
export function isValidFindingCode(code: string): boolean {
  const p = getFindingCodePrefix(code);
  return p != null && ALLOWED_FINDING_CODE_PREFIXES.includes(p);
}

// === V2 Skill shared contract (113.01) ===
// Every runtime-less Skill declares kernel role, dependency refs, policy,
// publish gates and impact in this vocabulary. All additions are optional
// so V1 Skill impls (rbac, datamodel, workflow, page, appbundle) remain
// source-compatible and do not require edits for basic use.

export type KernelRole =
  | "pdp"           // RBAC = Kernel 1, the PDP host
  | "pdp-host"      // V2 diagram wording for the PDP host
  | "ssot"          // DataModel = Kernel 2, the SSOT host
  | "ssot-host"     // V2 diagram wording for the SSOT host
  | "pep"           // Workflow and Page are PEP execution points that delegate to PDP and bind to SSOT
  | "assembly-root" // AppBundle = Kernel 6, the assembly root that checks closure and pins versions
  | "orchestrator";

export type SkillRuntimeRole = "kernel" | "pep" | "pep-execution" | "assembly" | "delegated";

export interface DependencyRef {
  skill?: string;
  to?: string;
  kind?: string;
  ref?: string;
  value?: string;
  label?: string;
}

export interface VersionPin {
  skill?: string;
  skillId?: string;
  version: string;
  pinnedAt?: string;
}

export interface PolicyDecision {
  effect?: "allow" | "deny";
  decision?: "allow" | "deny";
  reasonCode?: string;
  reason?: string;
  ruleId?: string;
  subject?: string;
  action?: string;
  resource?: string;
  message?: string;
  by?: string;
}

export interface PublishGateReport {
  publishable: boolean;
  blockers: Finding[];
  perSkill?: Record<string, { ok: boolean; errors: number; warnings: number }>;
  unresolvedRefs?: CrossRefEdge[];
}

/** Report of change impact across the skill graph. */
export interface ImpactReport {
  target?: { skill: string; kind: string; value: string };
  safe?: boolean;
  impacted?: Array<{
    skill: string;
    node: string;
    label: string;
    via: string;
    depth: number;
  }>;
  paths?: Array<{
    steps: Array<{
      skill: string;
      node: string;
      label: string;
      via?: string;
      depth: number;
    }>;
  }>;
  affectedSkills?: string[];
  impactGraph?: Projection;
  summary?: string;
}

/** Typed surface a V2 Skill can publish for orchestrator and other skills. */
export interface SkillCapabilitySurface {
  kernelRole?: KernelRole;
  runtimeRole?: SkillRuntimeRole;
  provides?: ResolvableSurface | string[];
  delegatesTo?: DependencyRef[];
  bindsTo?: DependencyRef[];
  versionPins?: VersionPin[];
  policyDecisions?: PolicyDecision[];
  publishGates?: PublishGateReport[];
  impacts?: ImpactReport[];
}

/** SkillDefinition carries optional V2 metadata block (additive, source-compatible). */
export interface SkillDefinition<TModel = any> {
  readonly id: string;
  readonly title: string;
  /** Optional link to the Skill impl surface. */
  skill?: Skill<TModel>;
  /** V2 kernel metadata (optional, additive). */
  runtimeRole?: SkillRuntimeRole;
  kernelRole?: KernelRole;
  provides?: ResolvableSurface | string[];
  delegatesTo?: DependencyRef[];
  bindsTo?: DependencyRef[];
  capability?: SkillCapabilitySurface;
  versionPin?: VersionPin;
}
