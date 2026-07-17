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

/**
 * enum 字段取值声明（加厚 schema 一期）：tone 是颜色语义——
 * success 正向/完成 · processing 进行中 · warning 等待/注意 ·
 * danger 风险/失败 · default 中性。渲染层据此出徽标/筛选/看板列。
 */
export interface FieldOption {
  id: string;
  label?: string;
  tone?: string;
}

export interface FiveSystemField {
  id: string;
  name?: string;
  type?: string;
  /** enum 字段的取值声明；非 enum 字段出现会被门禁标红 */
  options?: FieldOption[];
  /** 展示格式：number → money|percent|progress|score|rating；string → masked */
  format?: string;
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
  /** 阶段标签（生成侧泳道分组，如 申请/审核/执行；可选） */
  phase?: string;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowSection {
  id?: string;
  name?: string;
  nodes?: WorkflowNode[];
  transitions?: WorkflowTransition[];
  /** 附加业务链路（资金/治理/补偿等）；顶层 nodes/transitions 是主链路（核心对象生命周期） */
  chains?: WorkflowChain[];
}

export interface WorkflowChain {
  id?: string;
  name?: string;
  /** 链路类型：money 资金 / lifecycle 生命周期 / governance 治理 / recovery 补偿 */
  kind?: string;
  nodes?: WorkflowNode[];
  transitions?: WorkflowTransition[];
}

/**
 * 库无关图表声明（schema 丰富一期）：声明"可视化什么"，不声明用哪个图表库——
 * dimension 是分组字段，metric 是 "count" 或 "sum:<entity.field>"，
 * 渲染层（运行应用）负责映射到具体图表基建（当前为 ECharts）。
 */
export interface PageChartSpec {
  id?: string;
  name?: string;
  type?: "bar" | "line" | "pie" | string;
  dimension?: string;
  metric?: string;
}

/**
 * KPI 统计卡声明（加厚 schema 一期）：entity 圈定 count 的行来源，
 * metric 支持 count / sum:<e.f> / avg:<e.f>（sum·avg 必须指向 number 字段），
 * format 决定渲染（number 裸数字 / money ¥ / percent %）。
 */
export interface PageStatSpec {
  id?: string;
  name?: string;
  entity?: string;
  metric?: string;
  format?: string;
}

export interface PageModelDef {
  id?: string;
  name?: string;
  /** 页面范式（加厚 schema 二期）：workbench(缺省)|kanban|calendar|dashboard */
  kind?: string;
  /** kanban 的看板列字段（"entity.field"，必须是本页主实体的 enum 字段） */
  statusField?: string;
  /** calendar 的日期字段（"entity.field"，必须是本页主实体的 date 字段） */
  dateField?: string;
  /** calendar 的事件着色字段（可选，enum 字段） */
  colorBy?: string;
  fieldBindings?: string[];
  actionPermissions?: string[];
  stats?: PageStatSpec[];
  charts?: PageChartSpec[];
}

export interface AigcCapability {
  id?: string;
  name?: string;
  inputFields?: string[];
  outputField?: string;
  roleRefs?: string[];
}

/**
 * AIGC 能力编排（一期，线性管线）：steps 为能力 id 执行序。
 * 衔接语义（门禁硬校验）：上一步能力的 outputField 必须出现在下一步的
 * inputFields——编排经数据模型字段接线，不是松散的节点连线。
 */
export interface AigcPipeline {
  id?: string;
  name?: string;
  steps?: string[];
}

export interface AppBundlePageBinding {
  pageRef?: string;
  workflowRef?: string;
}

export interface ModelInvariant {
  id?: string;
  /** 一句话陈述性约束（如「支付状态只能由服务端验签回调修改」） */
  statement?: string;
  /** 该不变式约束到的系统段名 */
  systems?: string[];
  /** 落地引用：实体/字段/角色/权限/流程节点 id（门禁校验必须可解析） */
  refs?: string[];
}

/** 门禁前确定性修复留痕（v5_model_repair：近邻改写 + 悬挂不变式剔除） */
export interface InvariantNotes {
  repaired?: Array<{ invariantId?: string; from?: string; to?: string }>;
  dropped?: Array<{
    invariantId?: string;
    statement?: string;
    unresolvedRefs?: string[];
  }>;
}

/** 展示层声明修复留痕（E37：page.charts/stats 的近邻改写与枚举违规剔除） */
export interface PresentationNotes {
  repaired?: Array<{ pageId?: string; path?: string; from?: string; to?: string }>;
  droppedCharts?: Array<{ pageId?: string; chartId?: string; reason?: string }>;
  droppedStats?: Array<{ pageId?: string; statId?: string; reason?: string }>;
  clearedFormats?: Array<{ pageId?: string; statId?: string; format?: string }>;
}

export interface AppBundleSection {
  pageBindings?: AppBundlePageBinding[];
  roleRefs?: string[];
  dataModelRefs?: string[];
  /** 系统不变式（总装约束层，改进②） */
  invariants?: ModelInvariant[];
  /** 不变式引用修复/剔除留痕（AppBundle 屏如实展示） */
  invariantNotes?: InvariantNotes;
  /** 展示层声明修复/剔除留痕（E37，AppBundle 屏如实展示） */
  presentationNotes?: PresentationNotes;
}

export interface FiveSystemModel {
  datamodel?: { entities?: FiveSystemEntity[] };
  rbac?: { roles?: string[]; permissions?: string[]; menus?: RbacMenu[] };
  workflow?: WorkflowSection;
  page?: { pages?: PageModelDef[] };
  aigc?: { capabilities?: AigcCapability[]; pipelines?: AigcPipeline[] };
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
function detectBareSection(
  obj: Record<string, unknown>
): FiveSystemModel | null {
  if (Array.isArray(obj.nodes) && Array.isArray(obj.transitions)) {
    return { workflow: obj as WorkflowSection };
  }
  if (Array.isArray(obj.capabilities)) {
    return {
      aigc: obj as FiveSystemModel["aigc"] & { capabilities: AigcCapability[] },
    };
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
export function parseFiveSystemModel(
  raw: string | null | undefined
): FiveSystemModel | null {
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
 * 容错解析"正在流式生成、尚未收尾"的 JSON：截到最后一个语法安全位置
 * （完整的值/闭合括号后），剪掉悬空的 key / 逗号 / 未闭合字符串，再按
 * 括号栈补齐收尾符后 JSON.parse。返回 null 表示当前前缀还拼不出对象。
 *
 * 只用于推演过程的实时预览（右侧舞台"应用长出来"）——不参与 gate/trust，
 * 最终真实模型仍以闭环证据为准。
 */
export function repairPartialJson(raw: string): unknown | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const text = raw.slice(start);

  // 字符串感知的前向扫描：括号栈 + 是否停在未闭合字符串里（及其起点）。
  const scan = (
    upto: string
  ): { stack: string[]; inStr: boolean; strStart: number } => {
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    let strStart = -1;
    for (let i = 0; i < upto.length; i++) {
      const ch = upto[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        strStart = i;
      } else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    return { stack, inStr, strStart };
  };

  // 候选截断点：完整值结束处（闭合引号/闭合括号/数字与字面量尾字符）。
  const cuts: number[] = [];
  {
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') {
          inStr = false;
          cuts.push(i + 1);
        }
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "}" || ch === "]") cuts.push(i + 1);
      else if (/[0-9el]/.test(ch)) cuts.push(i + 1); // 数字 / true/false/null 尾字符近似
    }
  }
  cuts.push(text.length);

  // 从最靠后的候选点往回试（最多 ~40 个）：剪悬空结构 → 补括号 → parse。
  const tried = new Set<string>();
  for (let c = cuts.length - 1; c >= 0 && c >= cuts.length - 40; c--) {
    let t = text.slice(0, cuts[c]);
    // 停在字符串中间：连同开引号一起剪掉（是否在字符串内以扫描态为准，
    // 不能用正则猜——闭合字符串后面跟 }] 时正则会误伤）。
    const st = scan(t);
    if (st.inStr && st.strStart >= 0) t = t.slice(0, st.strStart);
    // 悬空的 "key": / 尾逗号冒号空白剪到稳定
    for (let pass = 0; pass < 4; pass++) {
      const before = t;
      t = t
        .replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, "") // 悬空 key:
        .replace(/[,:\s]+$/, ""); // 尾逗号/冒号/空白
      if (t === before) break;
    }
    if (!t || tried.has(t)) continue;
    tried.add(t);
    const closers = scan(t)
      .stack.reverse()
      .map(b => (b === "{" ? "}" : "]"))
      .join("");
    try {
      return JSON.parse(t + closers);
    } catch {
      /* 该截断点拼不成，回退更早的候选点 */
    }
  }
  return null;
}

/**
 * 从流式生成中的原始 LLM 输出解析"部分五系统模型"（实时预览用）。
 * 已流完的段如实返回；没流到的段缺失。拼不出任何段返回 null。
 */
export function parsePartialFiveSystemModel(
  raw: string | null | undefined
): FiveSystemModel | null {
  if (!raw || !raw.trim()) return null;
  const candidate = repairPartialJson(raw);
  if (!isPlainObject(candidate)) return null;
  const sections: FiveSystemModel = {};
  let found = false;
  for (const key of MODEL_KEYS) {
    const section = candidate[key];
    if (isPlainObject(section)) {
      (sections as Record<string, unknown>)[key] = section;
      found = true;
    }
  }
  return found ? sections : null;
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
// Evidence source (honest path labeling)
// ---------------------------------------------------------------------------

export interface EvidenceSourceInfo {
  kind: "llm" | "builtin";
  label: string;
}

/**
 * 证据来源识别：Python 侧 _build_per_skill_evidence 的产物 id 前缀是路径事实——
 *   llm-linkage-*     → 真实 LLM 五系统生成（novel intent）
 *   runtime-linkage-* → 内置演示域（采购/请假/工单/入职，确定性 fixture，不调 LLM）
 * 识别不了时返回 null（不猜、不冒充）。
 */
export function evidenceSourceOf(
  evidence: { artifactId?: string; evidenceRef?: string } | null | undefined
): EvidenceSourceInfo | null {
  const id = String(evidence?.artifactId || evidence?.evidenceRef || "");
  if (id.startsWith("llm-linkage-")) return { kind: "llm", label: "LLM 生成" };
  if (id.startsWith("runtime-linkage-"))
    return { kind: "builtin", label: "内置演示域" };
  return null;
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
  return {
    ref,
    resolved: ref.length > 0 && roles.includes(ref),
    label: ref || "—",
  };
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
  const entity = (model?.datamodel?.entities ?? []).find(
    e => e.id === entityId
  );
  const field = entity?.fields?.find(f => f.id === fieldId);
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
  const entity = (model?.datamodel?.entities ?? []).find(e => e.id === ref);
  if (!entity) return { ref, resolved: false, label: ref || "—" };
  return { ref, resolved: true, label: entity.name || entity.id };
}

/** pageRef → page.pages[] */
export function resolvePageRef(
  pageRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(pageRef ?? "").trim();
  const page = (model?.page?.pages ?? []).find(p => p.id === ref);
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
  const node = (wf.nodes ?? []).find(n => n.id === ref);
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
  return String(text)
    .replace(/"/g, "'")
    .replace(/[\[\]{}|]/g, " ")
    .trim();
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
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const t of workflow?.transitions ?? []) {
    if (!t?.from || !t?.to) continue;
    if (!nodeIds.has(t.from) || !nodeIds.has(t.to)) continue; // dangling — gate should reject; skip honestly
    const cond = t.condition ? `|${mermaidLabel(t.condition)}|` : "";
    lines.push(`  ${mermaidId(t.from)} -->${cond} ${mermaidId(t.to)}`);
  }
  return lines.join("\n");
}

/**
 * datamodel.entities → mermaid erDiagram。刷新/重载路径的真实数据源
 * （modelSection 持久化在 perSkillEvidence，SSE mermaid 已丢失时用它重建）。
 * entities 为空返回 null（调用方降级，不伪造）。
 */
/**
 * ref 字段 → 目标实体推断（"user_ref"/"chart_ref" 这类命名约定）。
 * 去掉 _ref/_id 后缀得到词干，在实体 id 里找唯一匹配：精确 → 前/后缀 →
 * 包含；多个候选（歧义）或零候选时返回 null——宁可不画线，不画错线。
 */
export function guessRefEntityId(
  fieldId: string,
  entityIds: Iterable<string>
): string | null {
  const base = fieldId.replace(/_ref$/, "").replace(/_id$/, "");
  if (!base) return null;
  const ids = [...entityIds];
  if (ids.includes(base)) return base;
  const affix = ids.filter(
    id => id.startsWith(`${base}_`) || id.endsWith(`_${base}`)
  );
  if (affix.length === 1) return affix[0];
  if (affix.length > 1) return null;
  const contains = ids.filter(id => id.includes(base));
  return contains.length === 1 ? contains[0] : null;
}

// --- ER 图数据（G6 渲染路径；与 datamodelToMermaid 同一套关联推断） --------

export interface ErGraphField {
  id: string;
  name: string;
  type: string;
  /** ref 字段解析出的目标实体 id（唯一匹配才给，歧义为 null） */
  refTarget: string | null;
}

export interface ErGraphNode {
  id: string;
  name: string;
  fields: ErGraphField[];
}

export interface ErGraphEdge {
  /** 持 ref 的实体（"多"侧） */
  source: string;
  /** 被引用实体（"一"侧） */
  target: string;
  /** ref 字段名 */
  label: string;
}

export function deriveErGraphData(
  datamodel: FiveSystemModel["datamodel"] | null | undefined
): { nodes: ErGraphNode[]; edges: ErGraphEdge[] } | null {
  const entities = datamodel?.entities ?? [];
  if (entities.length === 0) return null;
  const entityIds = entities.map(e => e.id);
  const nodes: ErGraphNode[] = [];
  const edges: ErGraphEdge[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    const fields: ErGraphField[] = [];
    for (const field of entity.fields ?? []) {
      const isRef =
        String(field.type || "").toLowerCase() === "ref" ||
        /_ref$/.test(field.id);
      const target = isRef ? guessRefEntityId(field.id, entityIds) : null;
      const refTarget = target && target !== entity.id ? target : null;
      fields.push({
        id: field.id,
        name: field.name || field.id,
        type: String(field.type || "string"),
        refTarget,
      });
      if (refTarget) {
        const key = `${entity.id}->${refTarget}:${field.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ source: entity.id, target: refTarget, label: field.id });
        }
      }
    }
    nodes.push({ id: entity.id, name: entity.name || entity.id, fields });
  }
  return { nodes, edges };
}

// --- 五系统联动图数据（AppBundle 屏「联动图」视图） -------------------------

export type LinkageSystem = "datamodel" | "page" | "workflow" | "rbac" | "aigc";

export interface LinkageItem {
  /** 全局唯一：`${system}:${id}` */
  key: string;
  system: LinkageSystem;
  id: string;
  name: string;
}

export interface LinkageEdge {
  from: string;
  to: string;
  /** 语义类型（决定颜色与图例归类） */
  kind:
    | "page-entity"
    | "page-workflow"
    | "node-role"
    | "aigc-entity"
    | "aigc-role";
}

export interface LinkageGroup {
  system: LinkageSystem;
  label: string;
  items: LinkageItem[];
}

/**
 * 五系统联动图：每个系统一组成员节点（全部展开，不截断——组内多列
 * 排布由渲染器负责），跨系统引用连线。只画模型里真实存在且解析得到的
 * 引用（悬空引用不入图——各屏已负责标红）。少于 2 个非空组返回 null。
 */
export function deriveSystemLinkageGraph(
  model: FiveSystemModel | null | undefined
): { groups: LinkageGroup[]; edges: LinkageEdge[] } | null {
  if (!model) return null;
  const entities = model.datamodel?.entities ?? [];
  const pages = model.page?.pages ?? [];
  const wfNodes = model.workflow?.nodes ?? [];
  const roles = model.rbac?.roles ?? [];
  const caps = model.aigc?.capabilities ?? [];

  const key = (system: LinkageSystem, id: string) => `${system}:${id}`;
  const mkGroup = (
    system: LinkageSystem,
    label: string,
    all: Array<{ id: string; name: string }>
  ): LinkageGroup => ({
    system,
    label,
    items: all.map(x => ({
      key: key(system, x.id),
      system,
      id: x.id,
      name: x.name,
    })),
  });

  const groups: LinkageGroup[] = [
    mkGroup(
      "datamodel",
      "数据中台 · DataModel",
      entities.map(e => ({ id: e.id, name: e.name || e.id }))
    ),
    mkGroup(
      "page",
      "页面设计器 · Page",
      pages.map((p, i) => ({
        id: p.id || `page-${i}`,
        name: p.name || p.id || `page-${i}`,
      }))
    ),
    mkGroup(
      "workflow",
      "工作流 · Workflow",
      wfNodes.map(n => ({ id: n.id, name: n.name || n.id }))
    ),
    mkGroup(
      "rbac",
      "权限 · RBAC",
      roles.map(r => ({ id: r, name: r }))
    ),
    mkGroup(
      "aigc",
      "AIGC 中台",
      caps.map((c, i) => ({
        id: c.id || `cap-${i}`,
        name: c.name || c.id || `cap-${i}`,
      }))
    ),
  ].filter(g => g.items.length > 0);
  if (groups.length < 2) return null;

  const present = new Set(groups.flatMap(g => g.items.map(i => i.key)));
  const edges: LinkageEdge[] = [];
  const seen = new Set<string>();
  const push = (from: string, to: string, kind: LinkageEdge["kind"]) => {
    if (!present.has(from) || !present.has(to)) return; // 悬空成员不画线
    const sig = `${from}->${to}:${kind}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    edges.push({ from, to, kind });
  };

  const entityIds = entities.map(e => e.id);
  for (const [i, p] of pages.entries()) {
    const pid = p.id || `page-${i}`;
    const dominant = (() => {
      const counts = new Map<string, number>();
      for (const b of p.fieldBindings ?? []) {
        const dot = b.indexOf(".");
        if (dot > 0)
          counts.set(b.slice(0, dot), (counts.get(b.slice(0, dot)) ?? 0) + 1);
      }
      let best: string | null = null;
      let n = 0;
      for (const [id, c] of counts)
        if (c > n && entityIds.includes(id)) {
          best = id;
          n = c;
        }
      return best;
    })();
    if (dominant)
      push(key("page", pid), key("datamodel", dominant), "page-entity");
  }
  for (const b of model.appbundle?.pageBindings ?? []) {
    if (b.pageRef && b.workflowRef && wfNodes.length > 0) {
      // workflowRef 指整条流程：连到流程起点节点（无入边）
      const hasInbound = new Set(
        (model.workflow?.transitions ?? []).map(t => t.to)
      );
      const start = wfNodes.find(n => !hasInbound.has(n.id)) ?? wfNodes[0];
      push(key("page", b.pageRef), key("workflow", start.id), "page-workflow");
    }
  }
  for (const n of wfNodes) {
    if (n.assigneeRole && roles.includes(n.assigneeRole)) {
      push(key("workflow", n.id), key("rbac", n.assigneeRole), "node-role");
    }
  }
  for (const [i, c] of caps.entries()) {
    const cid = c.id || `cap-${i}`;
    const out = c.outputField ?? "";
    const dot = out.indexOf(".");
    if (dot > 0 && entityIds.includes(out.slice(0, dot))) {
      push(
        key("aigc", cid),
        key("datamodel", out.slice(0, dot)),
        "aigc-entity"
      );
    }
    for (const r of c.roleRefs ?? []) {
      if (roles.includes(r))
        push(key("aigc", cid), key("rbac", r), "aigc-role");
    }
  }

  return { groups, edges };
}

// --- 流程图数据（G6 渲染路径） ---------------------------------------------

export interface WfGraphNode {
  id: string;
  name: string;
  /** assigneeRole 原文（未声明为 null） */
  role: string | null;
  /** 角色是否在 rbac.roles 里声明（未声明如实标红） */
  roleResolved: boolean;
  /** 无入边 = 流程起点（与 live-runtime.startNodeId 同一判定） */
  isStart: boolean;
  /** 无出边 = 终点（approve 到此即 completed） */
  isTerminal: boolean;
  /** 阶段标签（泳道分组依据；未声明为 null） */
  phase: string | null;
}

export interface WfGraphEdge {
  from: string;
  to: string;
  condition: string | null;
}

export function deriveWorkflowGraphData(
  model: FiveSystemModel | null | undefined
): { nodes: WfGraphNode[]; edges: WfGraphEdge[] } | null {
  const wfNodes = model?.workflow?.nodes ?? [];
  if (wfNodes.length === 0) return null;
  const transitions = model?.workflow?.transitions ?? [];
  const hasInbound = new Set(transitions.map(t => t.to));
  const hasOutbound = new Set(transitions.map(t => t.from));
  const declaredRoles = new Set(model?.rbac?.roles ?? []);
  return {
    nodes: wfNodes.map(n => ({
      id: n.id,
      name: n.name || n.id,
      role: n.assigneeRole || null,
      roleResolved: !n.assigneeRole || declaredRoles.has(n.assigneeRole),
      isStart: !hasInbound.has(n.id),
      isTerminal: !hasOutbound.has(n.id),
      phase: (n.phase ?? "").trim() || null,
    })),
    edges: transitions.map(t => ({
      from: t.from,
      to: t.to,
      condition: t.condition || null,
    })),
  };
}

/**
 * 阶段泳道分组：全部节点都声明了 phase 且存在 ≥2 个不同阶段才启用
 * （部分缺失宁可回退平铺布局，不猜阶段归属）。阶段顺序按节点列表首现序。
 */
export function derivePhaseLanes(
  nodes: WfGraphNode[]
): Array<{ phase: string; nodeIds: string[] }> | null {
  if (nodes.length === 0 || nodes.some(n => !n.phase)) return null;
  const lanes: Array<{ phase: string; nodeIds: string[] }> = [];
  const byPhase = new Map<string, string[]>();
  for (const n of nodes) {
    const phase = n.phase as string;
    let ids = byPhase.get(phase);
    if (!ids) {
      ids = [];
      byPhase.set(phase, ids);
      lanes.push({ phase, nodeIds: ids });
    }
    ids.push(n.id);
  }
  return lanes.length >= 2 ? lanes : null;
}

// --- 五系统整体架构图（Mermaid flowchart，AppBundle 屏「架构图」视图） -------

const LINKAGE_EDGE_LABEL: Record<LinkageEdge["kind"], string> = {
  "page-entity": "字段绑定",
  "page-workflow": "发起流程",
  "node-role": "审批人",
  "aigc-entity": "写回字段",
  "aigc-role": "可用角色",
};

/**
 * 五系统整体架构图：Mermaid flowchart —— 每个系统一个 subgraph 分组
 * （全部成员展开成网格），跨系统引用**捆扎成组间边**（语义标签 + 条数）。
 * 成员级逐条连线留给交互图；架构图管"哪个系统引用哪个系统、引用多重"
 * ——39 条成员边画进 dagre 会把整图摊到 4000+px 宽，捆扎后才是架构图。
 * 数据与 deriveSystemLinkageGraph 完全同源（悬空引用不入图）；
 * 少于 2 个非空系统段返回 null。
 */
export function linkageToMermaid(
  model: FiveSystemModel | null | undefined
): string | null {
  const data = deriveSystemLinkageGraph(model);
  if (!data) return null;

  // key → mermaid 安全 id（中文/符号净化后可能撞车，撞车追加后缀保唯一）
  const idMap = new Map<string, string>();
  const used = new Set<string>();
  const nid = (key: string): string => {
    let v = idMap.get(key);
    if (v) return v;
    v = mermaidId(key.replace(":", "__"));
    while (used.has(v)) v = `${v}_x`;
    used.add(v);
    idMap.set(key, v);
    return v;
  };

  // 整体 TB：系统组按引用方向垂直分层。组内不给布局自由发挥——大组会被
  // 摊成一整行（实测 6 角色的组被拉到 5000+px 宽）；用隐形链（~~~）把成员
  // 折成约 4 列的网格，组块保持紧凑，整图宽高比贴合看板画面。
  const lines = ["flowchart TB"];
  lines.push("  classDef datamodel fill:#e6f4ff,stroke:#91caff,color:#0958d9");
  lines.push("  classDef page fill:#e6fffb,stroke:#87e8de,color:#08979c");
  lines.push("  classDef workflow fill:#f9f0ff,stroke:#d3adf7,color:#531dab");
  lines.push("  classDef rbac fill:#fff7e6,stroke:#ffd591,color:#d46b08");
  lines.push("  classDef aigc fill:#fff0f6,stroke:#ffadd2,color:#c41d7f");
  for (const g of data.groups) {
    lines.push(`  subgraph sg_${g.system}["${mermaidLabel(g.label)}"]`);
    // TB 下无边成员同秩横排；>4 个时按隐形链竖排折列（每列 rows 个）
    lines.push("    direction TB");
    for (const item of g.items) {
      lines.push(`    ${nid(item.key)}["${mermaidLabel(item.name)}"]`);
    }
    const rows = g.items.length > 4 ? Math.ceil(g.items.length / 4) : 1;
    if (rows > 1) {
      for (let k = 0; k * rows < g.items.length; k++) {
        const chain = g.items.slice(k * rows, k * rows + rows);
        if (chain.length > 1) {
          lines.push(`    ${chain.map(i => nid(i.key)).join(" ~~~ ")}`);
        }
      }
    }
    lines.push("  end");
    lines.push(`  class ${g.items.map(i => nid(i.key)).join(",")} ${g.system}`);
  }
  // 组间捆扎边：同 (来源系统, 目标系统, 语义) 聚合为一条，标注条数
  const bundled = new Map<string, number>();
  for (const e of data.edges) {
    const fromSys = e.from.slice(0, e.from.indexOf(":"));
    const toSys = e.to.slice(0, e.to.indexOf(":"));
    const sig = `${fromSys}|${toSys}|${e.kind}`;
    bundled.set(sig, (bundled.get(sig) ?? 0) + 1);
  }
  for (const [sig, count] of bundled) {
    const [fromSys, toSys, kind] = sig.split("|");
    const label = LINKAGE_EDGE_LABEL[kind as LinkageEdge["kind"]];
    lines.push(
      `  sg_${fromSys} -->|"${mermaidLabel(label)} ×${count}"| sg_${toSys}`
    );
  }
  return lines.join("\n");
}

export function datamodelToMermaid(
  datamodel: FiveSystemModel["datamodel"] | null | undefined
): string | null {
  const entities = datamodel?.entities ?? [];
  if (entities.length === 0) return null;
  const entityIds = entities.map(e => e.id);
  const lines = ["erDiagram"];
  for (const entity of entities) {
    lines.push(`  ${mermaidId(entity.id)} {`);
    for (const field of entity.fields ?? []) {
      const type = mermaidId(String(field.type || "string")) || "string";
      const name = mermaidId(field.id);
      lines.push(`    ${type} ${name}${field.id === "id" ? " PK" : ""}`);
    }
    lines.push("  }");
  }
  // 关联边：ref 类型或 *_ref 命名的字段 → 目标实体（持 ref 的一侧是"多"）
  const seen = new Set<string>();
  for (const entity of entities) {
    for (const field of entity.fields ?? []) {
      const isRef =
        String(field.type || "").toLowerCase() === "ref" ||
        /_ref$/.test(field.id);
      if (!isRef) continue;
      const target = guessRefEntityId(field.id, entityIds);
      if (!target || target === entity.id) continue;
      const key = `${entity.id}->${target}:${field.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(
        `  ${mermaidId(target)} ||--o{ ${mermaidId(entity.id)} : "${mermaidId(field.id)}"`
      );
    }
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
  return all.filter(
    e => e.sourceSkill === closureKey || e.targetSkill === closureKey
  );
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
    lines.push(
      `  ${mermaidId(src)}["${mermaidLabel(src)}"] -->|${label}| ${mermaidId(tgt)}["${mermaidLabel(tgt)}"]`
    );
  }
  return lines.join("\n");
}

/**
 * 闭环后的对话总结（零 LLM 模板，方案 A）：全部事实来自五系统模型与
 * 闭环证据，替换机械状态行——像 TRAE 那样"执行完说人话"，但不多花
 * 一次 LLM 调用；LLM 增强总结（方案 B）落地后本函数退为兜底。
 */
export function summarizeClosureForChat(
  model: FiveSystemModel | null,
  opts: {
    goalText?: string;
    blocked: boolean;
    evidencePresentCount: number;
    skillCount: number;
    versionPinsChecked?: boolean;
  }
): string {
  const {
    goalText,
    blocked,
    evidencePresentCount,
    skillCount,
    versionPinsChecked,
  } = opts;
  const topic = (goalText || "").trim().slice(0, 24);
  if (blocked || !model) {
    const head = topic ? `「${topic}」的推演还未收口` : "本轮推演还未收口";
    return `${head}：${evidencePresentCount}/${skillCount} 个系统证据可用。补齐缺口后再推一轮即可闭环。`;
  }
  const entities = model.datamodel?.entities ?? [];
  const fieldCount = entities.reduce((n, e) => n + (e.fields?.length ?? 0), 0);
  const nodes = model.workflow?.nodes ?? [];
  const transitions = model.workflow?.transitions ?? [];
  const phaseCount = new Set(nodes.map(n => n.phase).filter(Boolean)).size;
  const roles = model.rbac?.roles ?? [];
  const perms = model.rbac?.permissions ?? [];
  const pages = model.page?.pages ?? [];
  const bindingCount = pages.reduce(
    (n, p) => n + (p.fieldBindings?.length ?? 0),
    0
  );
  const caps = model.aigc?.capabilities ?? [];
  const wfBindings = (model.appbundle?.pageBindings ?? []).filter(
    b => b.pageRef && b.workflowRef
  ).length;

  const parts: string[] = [];
  if (entities.length)
    parts.push(`数据模型 ${entities.length} 实体 · ${fieldCount} 字段`);
  if (nodes.length) {
    parts.push(
      `工作流 ${nodes.length} 节点 · ${transitions.length} 转移${phaseCount > 1 ? ` · ${phaseCount} 阶段` : ""}`
    );
  }
  if (roles.length)
    parts.push(`角色权限 ${roles.length} 角色 · ${perms.length} 权限`);
  if (pages.length)
    parts.push(`页面 ${pages.length} 页 · ${bindingCount} 处字段绑定`);
  if (caps.length) parts.push(`AI 能力 ${caps.length} 项可写回`);

  const lines: string[] = [
    `已为${topic ? `「${topic}」` : "本话题"}搭出可运行的应用闭环（证据 ${evidencePresentCount}/${skillCount}，版本${versionPinsChecked ? "已钉扎" : "待钉扎"}）：`,
  ];
  if (parts.length) {
    lines.push(
      parts.join("；") +
        (wfBindings ? `；页面↔流程绑定 ${wfBindings} 处。` : "。")
    );
  }
  lines.push(
    "右侧应用已在运行：可录入数据、提交审批、切换角色、试 AI 写回；开「游标」能透视每个界面背后的声明。"
  );
  return lines.join("\n");
}
