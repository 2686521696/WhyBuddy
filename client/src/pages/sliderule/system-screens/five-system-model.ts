/**
 * five-system-model — 五系统模型（LLM 生成）的前端解析与交叉引用解析。
 *
 * 模型形状与 slide-rule-python/services/v5_llm_generate.py 的 _SCHEMA_INSTRUCTION 对齐：
 *   datamodel.entities[].fields[]        — SSOT 实体字段
 *   rbac.roles / permissions / menus     — 角色 · 权限 · 菜单
 *   workflow.nodes[].assigneeRole + transitions[]
 *   page.pages[].fieldBindings / actionPermissions
 *   aigc.capabilities[].inputFields / outputField / roleRefs
 *   appbundle.pageBindings / roleRefs / dataModelRefs
 *
 * 所有交叉引用（assigneeRole→rbac.roles、"entity.field"→datamodel 等）在这里
 * 集中解析，系统屏只负责渲染 resolved/unresolved 状态 —— 未解析引用如实标红，
 * 不静默吞掉（与 v5_model_gate 的 fail-closed 语义一致）。
 *
 * 纯函数模块：无网络、无副作用，便于单测。
 */

// ---------------------------------------------------------------------------
// Types (mirror _SCHEMA_INSTRUCTION)
// ---------------------------------------------------------------------------

export interface FiveSystemField {
  id: string;
  name?: string;
  type?: string;
}

export interface FiveSystemEntity {
  id: string;
  name?: string;
  fields?: FiveSystemField[];
}

export interface RbacMenu {
  id?: string;
  label?: string;
  roleRefs?: string[];
  permissionRefs?: string[];
}

export interface WorkflowNode {
  id: string;
  name?: string;
  assigneeRole?: string;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowSection {
  id?: string;
  nodes?: WorkflowNode[];
  transitions?: WorkflowTransition[];
}

export interface PageModelDef {
  id?: string;
  name?: string;
  fieldBindings?: string[];
  actionPermissions?: string[];
}

export interface AigcCapability {
  id?: string;
  name?: string;
  inputFields?: string[];
  outputField?: string;
  roleRefs?: string[];
}

export interface AppBundlePageBinding {
  pageRef?: string;
  workflowRef?: string;
}

export interface AppBundleSection {
  pageBindings?: AppBundlePageBinding[];
  roleRefs?: string[];
  dataModelRefs?: string[];
}

export interface FiveSystemModel {
  datamodel?: { entities?: FiveSystemEntity[] };
  rbac?: { roles?: string[]; permissions?: string[]; menus?: RbacMenu[] };
  workflow?: WorkflowSection;
  page?: { pages?: PageModelDef[] };
  aigc?: { capabilities?: AigcCapability[] };
  appbundle?: AppBundleSection;
}

export type FiveSystemModelKey = keyof FiveSystemModel;

const MODEL_KEYS: FiveSystemModelKey[] = [
  "datamodel",
  "rbac",
  "workflow",
  "page",
  "aigc",
  "appbundle",
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function tryJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Candidate JSON payloads inside a raw string: whole text, fenced blocks, brace substring. */
function jsonCandidates(raw: string): unknown[] {
  const out: unknown[] = [];
  const whole = tryJson(raw.trim());
  if (whole !== null) out.push(whole);

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const parsed = tryJson(m[1].trim());
    if (parsed !== null) out.push(parsed);
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const parsed = tryJson(raw.slice(first, last + 1));
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/** Detect a bare section object (e.g. `{nodes, transitions}` without the "workflow" wrapper). */
function detectBareSection(obj: Record<string, unknown>): FiveSystemModel | null {
  if (Array.isArray(obj.nodes) && Array.isArray(obj.transitions)) {
    return { workflow: obj as WorkflowSection };
  }
  if (Array.isArray(obj.capabilities)) {
    return { aigc: obj as FiveSystemModel["aigc"] & { capabilities: AigcCapability[] } };
  }
  if (Array.isArray(obj.pageBindings) || Array.isArray(obj.dataModelRefs)) {
    return { appbundle: obj as AppBundleSection };
  }
  if (Array.isArray(obj.entities)) {
    return { datamodel: obj as FiveSystemModel["datamodel"] };
  }
  if (Array.isArray(obj.roles) || Array.isArray(obj.permissions)) {
    return { rbac: obj as FiveSystemModel["rbac"] };
  }
  if (Array.isArray(obj.pages)) {
    return { page: obj as FiveSystemModel["page"] };
  }
  return null;
}

/**
 * Parse a raw string that may contain a five-system model (full model JSON,
 * fenced JSON, or a bare single-section JSON). Returns null when nothing
 * structurally recognizable is found — callers must degrade honestly.
 */
export function parseFiveSystemModel(raw: string | null | undefined): FiveSystemModel | null {
  if (!raw || !raw.trim()) return null;
  for (const candidate of jsonCandidates(raw)) {
    if (!isPlainObject(candidate)) continue;
    const sections: FiveSystemModel = {};
    let found = false;
    for (const key of MODEL_KEYS) {
      const section = candidate[key];
      if (isPlainObject(section)) {
        (sections as Record<string, unknown>)[key] = section;
        found = true;
      }
    }
    if (found) return sections;
    const bare = detectBareSection(candidate);
    if (bare) return bare;
  }
  return null;
}

/**
 * Merge model sections parsed from per-skill raw contents (skill_result SSE payloads).
 * First occurrence of each section wins. Null when no content parses.
 */
export function parseFiveSystemModelFromContents(
  contents: Partial<Record<string, string>> | null | undefined
): FiveSystemModel | null {
  if (!contents) return null;
  let merged: FiveSystemModel | null = null;
  for (const value of Object.values(contents)) {
    const parsed = parseFiveSystemModel(value);
    if (!parsed) continue;
    merged = merged ?? {};
    for (const key of MODEL_KEYS) {
      if (parsed[key] && !merged[key]) {
        (merged as Record<string, unknown>)[key] = parsed[key];
      }
    }
  }
  return merged;
}

/**
 * 从持久化的 publishClosure.perSkillEvidence 重建五系统模型（刷新/重载路径）。
 *
 * Python 侧 _build_per_skill_evidence 把 gate 通过的 LLM 模型段作为
 * perSkillEvidence[skill].modelSection 纯载荷持久化（不参与 trust 判定）。
 * 确定性域（采购/请假/工单/入职）没有 LLM 模型 → 字段缺失 → 返回 null，
 * 调用方走既有降级链（SSE mermaid / skillRuntimeGraph / 占位），不伪造。
 */
export function parseFiveSystemModelFromPerSkillEvidence(
  perSkillEvidence:
    | Partial<Record<string, { modelSection?: unknown } | undefined>>
    | null
    | undefined
): FiveSystemModel | null {
  if (!perSkillEvidence) return null;
  let model: FiveSystemModel | null = null;
  for (const key of MODEL_KEYS) {
    const section = perSkillEvidence[key]?.modelSection;
    if (isPlainObject(section)) {
      model = model ?? {};
      (model as Record<string, unknown>)[key] = section;
    }
  }
  return model;
}

/**
 * 段级合并两个模型来源（primary 段优先，缺段由 fallback 补齐）。
 * 两者皆空返回 null —— 保持 fail-closed 语义。
 */
export function mergeFiveSystemModels(
  primary: FiveSystemModel | null | undefined,
  fallback: FiveSystemModel | null | undefined
): FiveSystemModel | null {
  if (!primary && !fallback) return null;
  const merged: FiveSystemModel = {};
  for (const key of MODEL_KEYS) {
    const section = primary?.[key] ?? fallback?.[key];
    if (section) (merged as Record<string, unknown>)[key] = section;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

// ---------------------------------------------------------------------------
// Cross-reference resolution
// ---------------------------------------------------------------------------

export interface RefResolution {
  /** The raw ref string as written in the model. */
  ref: string;
  /** True when the ref resolves to a node defined in the same model. */
  resolved: boolean;
  /** Human-facing label (resolved target name, or the raw ref when unresolved). */
  label: string;
}

/** assigneeRole / roleRefs → rbac.roles */
export function resolveRoleRef(
  role: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(role ?? "").trim();
  const roles = model?.rbac?.roles ?? [];
  return { ref, resolved: ref.length > 0 && roles.includes(ref), label: ref || "—" };
}

/** "entityId.fieldId" → datamodel.entities[].fields[] */
export function resolveFieldRef(
  fieldRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(fieldRef ?? "").trim();
  const dot = ref.indexOf(".");
  if (!ref || dot <= 0) return { ref, resolved: false, label: ref || "—" };
  const entityId = ref.slice(0, dot);
  const fieldId = ref.slice(dot + 1);
  const entity = (model?.datamodel?.entities ?? []).find((e) => e.id === entityId);
  const field = entity?.fields?.find((f) => f.id === fieldId);
  if (!entity || !field) return { ref, resolved: false, label: ref };
  return {
    ref,
    resolved: true,
    label: `${entity.name || entity.id}.${field.name || field.id}`,
  };
}

/** entityId → datamodel.entities[] */
export function resolveEntityRef(
  entityRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(entityRef ?? "").trim();
  const entity = (model?.datamodel?.entities ?? []).find((e) => e.id === ref);
  if (!entity) return { ref, resolved: false, label: ref || "—" };
  return { ref, resolved: true, label: entity.name || entity.id };
}

/** pageRef → page.pages[] */
export function resolvePageRef(
  pageRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(pageRef ?? "").trim();
  const page = (model?.page?.pages ?? []).find((p) => p.id === ref);
  if (!page) return { ref, resolved: false, label: ref || "—" };
  return { ref, resolved: true, label: page.name || page.id || ref };
}

/** workflowRef → workflow.id 或 workflow.nodes[].id */
export function resolveWorkflowRef(
  workflowRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(workflowRef ?? "").trim();
  const wf = model?.workflow;
  if (!ref || !wf) return { ref, resolved: false, label: ref || "—" };
  if (wf.id === ref) return { ref, resolved: true, label: wf.id };
  const node = (wf.nodes ?? []).find((n) => n.id === ref);
  if (node) return { ref, resolved: true, label: node.name || node.id };
  return { ref, resolved: false, label: ref };
}

// ---------------------------------------------------------------------------
// Mermaid builders
// ---------------------------------------------------------------------------

function mermaidId(id: string): string {
  const safe = String(id).replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(safe) ? safe : `n_${safe}`;
}

function mermaidLabel(text: string): string {
  return String(text).replace(/"/g, "'").replace(/[\[\]{}|]/g, " ").trim();
}

/**
 * workflow.nodes + transitions → mermaid flowchart TD。
 * 节点标签带审批人角色（`名称·@角色`），转移条件渲染为边标签。
 * nodes 为空返回 null（调用方降级）。
 */
export function workflowModelToMermaid(
  workflow: WorkflowSection | null | undefined
): string | null {
  const nodes = workflow?.nodes ?? [];
  if (nodes.length === 0) return null;
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    const name = mermaidLabel(node.name || node.id);
    const role = node.assigneeRole ? mermaidLabel(node.assigneeRole) : "";
    const label = role ? `${name}<br/>@${role}` : name;
    lines.push(`  ${mermaidId(node.id)}["${label}"]`);
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const t of workflow?.transitions ?? []) {
    if (!t?.from || !t?.to) continue;
    if (!nodeIds.has(t.from) || !nodeIds.has(t.to)) continue; // dangling — gate should reject; skip honestly
    const cond = t.condition ? `|${mermaidLabel(t.condition)}|` : "";
    lines.push(`  ${mermaidId(t.from)} -->${cond} ${mermaidId(t.to)}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Cross-skill runtime edges (persisted skillRuntimeGraph projection)
// ---------------------------------------------------------------------------

export interface CrossSkillEdge {
  sourceSkill?: string;
  targetSkill?: string;
  state?: string;
  evidenceKey?: string;
}

export interface SkillRuntimeGraphLike {
  edges?: CrossSkillEdge[];
  bySkill?: Record<string, CrossSkillEdge[]>;
}

/** 从持久化的 skillRuntimeGraph 里取某个系统的跨系统边（刷新后仍可用）。 */
export function edgesForSkill(
  graph: SkillRuntimeGraphLike | null | undefined,
  closureKey: string
): CrossSkillEdge[] {
  const bySkill = graph?.bySkill;
  if (bySkill && Array.isArray(bySkill[closureKey])) return bySkill[closureKey];
  const all = graph?.edges ?? [];
  return all.filter((e) => e.sourceSkill === closureKey || e.targetSkill === closureKey);
}

/**
 * 跨系统边 → mermaid flowchart LR。与 Python 侧 _skill_edges_to_mermaid
 * （v5_full_driver.py）同构，供刷新后无 SSE mermaid 时的客户端重建。
 */
export function crossSkillEdgesToMermaid(
  closureKey: string,
  edges: CrossSkillEdge[] | null | undefined
): string {
  const lines = ["flowchart LR"];
  const list = edges ?? [];
  if (list.length === 0) {
    lines.push(`  ${mermaidId(closureKey)}["${mermaidLabel(closureKey)}"]`);
    return lines.join("\n");
  }
  const seen = new Set<string>();
  for (const e of list) {
    const src = e?.sourceSkill;
    const tgt = e?.targetSkill;
    if (!src || !tgt) continue;
    const sig = `${src}->${tgt}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const label = mermaidLabel(e.evidenceKey || e.state || "");
    lines.push(`  ${mermaidId(src)}["${mermaidLabel(src)}"] -->|${label}| ${mermaidId(tgt)}["${mermaidLabel(tgt)}"]`);
  }
  return lines.join("\n");
}
