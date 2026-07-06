import {
  finalizeReport,
  type CrossRefEdge,
  type CrossSkill,
  type Finding,
  type Projection,
  type ResolvableSurface,
  type Skill,
  type ValidateContext,
} from "../skill";
import type {
  AigcCapability,
  AigcCapabilityKind,
  AigcInvocationPlan,
  AigcModel,
  AigcRuntimeContext,
  OutputSchemaField,
  OutputSchemaFieldType,
  ToolCallBudget,
} from "./aigcModel";
import { AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID } from "./aigcModel";
export { AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID };

const capabilityKinds: AigcCapabilityKind[] = [
  "summary",
  "classification",
  "extraction",
  "recommendation",
  "tool_orchestration",
];

const outputFieldTypes: OutputSchemaFieldType[] = ["string", "number", "boolean", "enum", "object", "array"];

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function nodeId(kind: string, id: string): string {
  return `aigc_${kind}_${sanitizeId(id)}`;
}

function capabilityNodeId(id: string): string {
  return nodeId("cap", id);
}

function pushFinding(
  findings: Finding[],
  code: string,
  severity: Finding["severity"],
  path: string,
  message: string,
): void {
  findings.push({ code, severity, path, message });
}

function stringSet(values: Array<{ id: string }> | undefined): Set<string> {
  return new Set((values ?? []).map(item => item.id));
}

function hasRawSecret(provider: Record<string, unknown>): boolean {
  return ["apiKey", "secret", "rawKey"].some(key => {
    const value = provider[key];
    return typeof value === "string" && value.length > 0;
  });
}

function fieldMetadata(surface: ResolvableSurface | undefined, ref: string): any | null {
  const fields = (surface as any)?.fields;
  if (!Array.isArray(fields)) return null;
  return fields.find((field: any) => field?.ref === ref) ?? null;
}

function validateRoleRef(
  findings: Finding[],
  roles: string[] | undefined,
  ref: string,
  path: string,
): void {
  if (roles === undefined) {
    pushFinding(findings, "AIGC_ROLE_UNRESOLVED", "warning", path, `RBAC role surface was not provided for ${ref}.`);
  } else if (!roles.includes(ref)) {
    pushFinding(findings, "AIGC_ROLE_MISSING", "error", path, `AIGC references missing RBAC role: ${ref}.`);
  }
}

function validatePermissionRef(
  findings: Finding[],
  permissions: string[] | undefined,
  ref: string,
  path: string,
): void {
  if (permissions === undefined) {
    pushFinding(findings, "AIGC_PERMISSION_UNRESOLVED", "warning", path, `RBAC permission surface was not provided for ${ref}.`);
  } else if (!permissions.includes(ref)) {
    pushFinding(findings, "AIGC_PERMISSION_MISSING", "error", path, `AIGC references missing RBAC permission: ${ref}.`);
  }
}

function validateFieldRef(
  findings: Finding[],
  datamodel: ResolvableSurface | undefined,
  ref: string,
  path: string,
  missingCode: "AIGC_INPUT_FIELD_MISSING" | "AIGC_OUTPUT_FIELD_MISSING",
): void {
  const fields = datamodel?.field;
  if (fields === undefined) {
    pushFinding(findings, "AIGC_FIELD_UNRESOLVED", "warning", path, `DataModel field surface was not provided for ${ref}.`);
    return;
  }
  if (!fields.includes(ref)) {
    pushFinding(findings, missingCode, "error", path, `AIGC references missing DataModel SSOT field: ${ref}.`);
    return;
  }

  const metadata = fieldMetadata(datamodel, ref);
  if (metadata?.lifecycle === "deprecated") {
    pushFinding(findings, "AIGC_FIELD_DEPRECATED", "warning", path, `AIGC references deprecated DataModel field: ${ref}.`);
  } else if (metadata?.lifecycle === "removed") {
    pushFinding(findings, "AIGC_FIELD_REMOVED", "error", path, `AIGC references removed DataModel field: ${ref}.`);
  }
}

function capabilityRefs(model: AigcModel): {
  roleRefs: string[];
  permissionRefs: string[];
  inputFieldRefs: string[];
  outputFieldRefs: string[];
} {
  return {
    roleRefs: unique([
      ...model.capabilities.flatMap(cap => cap.allowedRoleRefs ?? []),
      ...model.retrievalPolicies.flatMap(policy => policy.allowedRoleRefs),
    ]),
    permissionRefs: unique([
      ...model.capabilities.flatMap(cap => cap.permissionRefs ?? []),
      ...model.retrievalPolicies.flatMap(policy => policy.permissionRefs),
      ...model.toolConfigs.flatMap(tool => tool.permissionRefs),
      ...model.toolPolicies.flatMap(policy => policy.permissionRefs),
    ]),
    inputFieldRefs: unique([
      ...model.capabilities.flatMap(cap => cap.inputFieldRefs ?? []),
      ...model.knowledgeSources.flatMap(source => source.fieldRefs ?? []),
      ...model.citationPolicies.flatMap(policy => policy.sourceFieldRefs ?? []),
    ]),
    outputFieldRefs: unique([
      ...model.capabilities.flatMap(cap => cap.outputFieldRefs ?? []),
      ...model.outputSchemas.flatMap(schema => schema.fields.flatMap(field => (field.writebackFieldRef ? [field.writebackFieldRef] : []))),
    ]),
  };
}

function isValidFieldValue(value: unknown, field: OutputSchemaField): boolean {
  if (value === undefined || value === null) return false;
  switch (field.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && Array.isArray(field.enumValues) && field.enumValues.includes(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

/** Pure runtime validator for AIGC capability outputs against declared schema and citation/evidence policy.
 *  Returns ValidationReport; on invalid uses AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID.
 *  RAG-backed (knowledgeSourceRefs present or citationRequired) must carry citationEvidence.
 */
export function validateAigcRuntimeOutput(
  model: AigcModel,
  capabilityId: string,
  output: unknown
): ReturnType<Skill<AigcModel>["validate"]> {
  const findings: Finding[] = [];

  const capability = model.capabilities.find((c) => c.id === capabilityId);
  if (!capability) {
    pushFinding(findings, AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID, "error", "capabilityId", `Capability ${capabilityId} not found in model.`);
    return finalizeReport(findings);
  }

  const schema = model.outputSchemas.find((s) => s.id === capability.outputSchemaRef);
  if (!schema || !Array.isArray(schema.fields) || schema.fields.length === 0) {
    pushFinding(findings, AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID, "error", "outputSchema", `Output schema not found or empty for capability ${capabilityId}.`);
    return finalizeReport(findings);
  }

  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    pushFinding(findings, AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID, "error", "output", "AIGC output must be a plain object.");
    return finalizeReport(findings);
  }

  const out = output as Record<string, unknown>;

  for (const field of schema.fields) {
    const val = out[field.key];
    const hasKey = Object.prototype.hasOwnProperty.call(out, field.key);
    if (field.required && (val === undefined || val === null)) {
      pushFinding(findings, AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID, "error", `output.${field.key}`, `Missing required output field: ${field.key}`);
      continue;
    }
    if (hasKey && val != null && !isValidFieldValue(val, field)) {
      pushFinding(findings, AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID, "error", `output.${field.key}`, `Output field ${field.key} has invalid type or value for declared ${field.type}.`);
    }
  }

  // citationEvidence requirement for RAG-backed capabilities
  const isRagBacked = (capability.knowledgeSourceRefs ?? []).length > 0;
  const citationPolicy = capability.citationPolicyRef
    ? model.citationPolicies.find((p) => p.id === capability.citationPolicyRef)
    : null;
  const citationRequired = isRagBacked || !!(citationPolicy && citationPolicy.citationRequired);
  if (citationRequired) {
    const ev = (out as any).citationEvidence;
    if (!Array.isArray(ev) || ev.length === 0) {
      pushFinding(findings, AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID, "error", "output.citationEvidence", "RAG-backed capability requires non-empty citationEvidence array in output.");
    }
  }

  return finalizeReport(findings);
}

export const aigcSkill: Skill<AigcModel> & CrossSkill<AigcModel> = {
  id: "aigc",
  title: "AIGC Center",

  validate(model: AigcModel, ctx?: ValidateContext): ReturnType<Skill<AigcModel>["validate"]> {
    const findings: Finding[] = [];
    const providerIds = stringSet(model.providers);
    const promptIds = stringSet(model.promptTemplates);
    const outputSchemaIds = stringSet(model.outputSchemas);
    const knowledgeSourceIds = stringSet(model.knowledgeSources);
    const retrievalPolicyIds = stringSet(model.retrievalPolicies);
    const citationPolicyIds = stringSet(model.citationPolicies);
    const toolConfigIds = stringSet(model.toolConfigs);
    const toolPolicyIds = stringSet(model.toolPolicies);
    const rbac = ctx?.external?.rbac;
    const datamodel = ctx?.external?.datamodel;

    if (model.pep !== "pep") {
      pushFinding(findings, "AIGC_PEP_BYPASS", "error", "pep", "AIGC must declare itself as a PEP execution point.");
    }

    for (const duplicate of findDuplicates(model.capabilities.map(cap => cap.id))) {
      pushFinding(findings, "AIGC_DUP_CAP_ID", "error", "capabilities", `Duplicate AIGC capability id: ${duplicate}.`);
    }

    model.capabilities.forEach((capability, index) => {
      const path = `capabilities[${index}]`;
      if (!capabilityKinds.includes(capability.kind)) {
        pushFinding(findings, "AIGC_INVALID_KIND", "error", `${path}.kind`, `Invalid AIGC capability kind: ${capability.kind}.`);
      }
      if (capability.allowWithoutPdp) {
        pushFinding(findings, "AIGC_PEP_BYPASS", "error", `${path}.allowWithoutPdp`, "AIGC cannot make local-only authorization decisions.");
      }
      if (!capability.providerRef || !providerIds.has(capability.providerRef)) {
        pushFinding(findings, "AIGC_PROVIDER_MISSING", "error", `${path}.providerRef`, `Missing provider route: ${capability.providerRef ?? ""}.`);
      }
      if (!capability.promptRef || !promptIds.has(capability.promptRef)) {
        pushFinding(findings, "AIGC_PROMPT_MISSING", "error", `${path}.promptRef`, `Missing prompt template: ${capability.promptRef ?? ""}.`);
      }
      if (!capability.outputSchemaRef || !outputSchemaIds.has(capability.outputSchemaRef)) {
        pushFinding(findings, "AIGC_OUTPUT_SCHEMA_MISSING", "error", `${path}.outputSchemaRef`, `Missing output schema: ${capability.outputSchemaRef ?? ""}.`);
      }
      (capability.knowledgeSourceRefs ?? []).forEach((ref, refIndex) => {
        if (!knowledgeSourceIds.has(ref)) {
          pushFinding(findings, "AIGC_RAG_SOURCE_MISSING", "error", `${path}.knowledgeSourceRefs[${refIndex}]`, `Missing RAG knowledge source: ${ref}.`);
        }
      });
      if (capability.knowledgeSourceRefs?.length && (!capability.retrievalPolicyRef || !retrievalPolicyIds.has(capability.retrievalPolicyRef))) {
        pushFinding(findings, "AIGC_RETRIEVAL_POLICY_MISSING", "error", `${path}.retrievalPolicyRef`, `Missing retrieval policy: ${capability.retrievalPolicyRef ?? ""}.`);
      }
      const citationPolicy = capability.citationPolicyRef
        ? model.citationPolicies.find(policy => policy.id === capability.citationPolicyRef)
        : null;
      if (capability.knowledgeSourceRefs?.length && (!citationPolicy || !citationPolicy.citationRequired)) {
        pushFinding(findings, "AIGC_CITATION_REQUIRED", "error", `${path}.citationPolicyRef`, "RAG-backed AIGC capabilities must declare a citation-required policy.");
      } else if (capability.citationPolicyRef && !citationPolicyIds.has(capability.citationPolicyRef)) {
        pushFinding(findings, "AIGC_CITATION_REQUIRED", "error", `${path}.citationPolicyRef`, `Missing citation policy: ${capability.citationPolicyRef}.`);
      }
      (capability.toolRefs ?? []).forEach((ref, refIndex) => {
        if (!toolConfigIds.has(ref)) {
          pushFinding(findings, "AIGC_TOOL_MISSING", "error", `${path}.toolRefs[${refIndex}]`, `Missing tool config: ${ref}.`);
        }
      });
      if (capability.toolRefs?.length && (!capability.toolPolicyRef || !toolPolicyIds.has(capability.toolPolicyRef))) {
        pushFinding(findings, "AIGC_TOOL_POLICY_MISSING", "error", `${path}.toolPolicyRef`, `Missing tool policy: ${capability.toolPolicyRef ?? ""}.`);
      }
      (capability.allowedRoleRefs ?? []).forEach((ref, refIndex) =>
        validateRoleRef(findings, rbac?.role, ref, `${path}.allowedRoleRefs[${refIndex}]`),
      );
      (capability.permissionRefs ?? []).forEach((ref, refIndex) =>
        validatePermissionRef(findings, rbac?.permission, ref, `${path}.permissionRefs[${refIndex}]`),
      );
      (capability.inputFieldRefs ?? []).forEach((ref, refIndex) =>
        validateFieldRef(findings, datamodel, ref, `${path}.inputFieldRefs[${refIndex}]`, "AIGC_INPUT_FIELD_MISSING"),
      );
      (capability.outputFieldRefs ?? []).forEach((ref, refIndex) =>
        validateFieldRef(findings, datamodel, ref, `${path}.outputFieldRefs[${refIndex}]`, "AIGC_OUTPUT_FIELD_MISSING"),
      );
    });

    model.providers.forEach((provider, index) => {
      if (!provider.modelRef) {
        pushFinding(findings, "AIGC_MODEL_MISSING", "error", `providers[${index}].modelRef`, `Provider ${provider.id} is missing modelRef.`);
      }
      if (!Number.isFinite(provider.tokenBudget) || provider.tokenBudget <= 0) {
        pushFinding(findings, "AIGC_TOKEN_BUDGET_INVALID", "error", `providers[${index}].tokenBudget`, `Provider ${provider.id} has invalid token budget.`);
      }
      if (hasRawSecret(provider as unknown as Record<string, unknown>)) {
        pushFinding(findings, "AIGC_RAW_SECRET", "error", `providers[${index}]`, `Provider ${provider.id} contains a raw secret.`);
      }
      if (!provider.keyRef && !provider.secretRef) {
        pushFinding(findings, "AIGC_PROVIDER_MISSING", "error", `providers[${index}].keyRef`, `Provider ${provider.id} must use keyRef or secretRef.`);
      }
    });

    model.promptTemplates.forEach((prompt, index) => {
      if (!prompt.version) {
        pushFinding(findings, "AIGC_PROMPT_VERSION_MISSING", "error", `promptTemplates[${index}].version`, `Prompt ${prompt.id} must be versioned.`);
      }
    });

    model.outputSchemas.forEach((schema, schemaIndex) => {
      if (!schema.version || schema.fields.length === 0) {
        pushFinding(findings, "AIGC_OUTPUT_SCHEMA_INVALID", "error", `outputSchemas[${schemaIndex}]`, `Output schema ${schema.id} must be versioned and non-empty.`);
      }
      schema.fields.forEach((field, fieldIndex) => {
        if (!field.key || !outputFieldTypes.includes(field.type)) {
          pushFinding(findings, "AIGC_OUTPUT_SCHEMA_INVALID", "error", `outputSchemas[${schemaIndex}].fields[${fieldIndex}]`, `Invalid output schema field.`);
        }
        if (field.type === "enum" && (!field.enumValues || field.enumValues.length === 0)) {
          pushFinding(findings, "AIGC_OUTPUT_SCHEMA_INVALID", "error", `outputSchemas[${schemaIndex}].fields[${fieldIndex}].enumValues`, `Enum output field must declare values.`);
        }
        if (field.writebackFieldRef) {
          validateFieldRef(
            findings,
            datamodel,
            field.writebackFieldRef,
            `outputSchemas[${schemaIndex}].fields[${fieldIndex}].writebackFieldRef`,
            "AIGC_OUTPUT_FIELD_MISSING",
          );
        }
      });
    });

    model.knowledgeSources.forEach((source, sourceIndex) => {
      (source.fieldRefs ?? []).forEach((ref, refIndex) =>
        validateFieldRef(findings, datamodel, ref, `knowledgeSources[${sourceIndex}].fieldRefs[${refIndex}]`, "AIGC_INPUT_FIELD_MISSING"),
      );
    });

    model.retrievalPolicies.forEach((policy, index) => {
      if (policy.localDecision || (policy.allowedRoleRefs.length === 0 && policy.permissionRefs.length === 0)) {
        pushFinding(findings, "AIGC_RETRIEVAL_PEP_BYPASS", "error", `retrievalPolicies[${index}]`, `Retrieval policy ${policy.id} must delegate authorization to RBAC.`);
      }
      policy.allowedRoleRefs.forEach((ref, refIndex) =>
        validateRoleRef(findings, rbac?.role, ref, `retrievalPolicies[${index}].allowedRoleRefs[${refIndex}]`),
      );
      policy.permissionRefs.forEach((ref, refIndex) =>
        validatePermissionRef(findings, rbac?.permission, ref, `retrievalPolicies[${index}].permissionRefs[${refIndex}]`),
      );
    });

    model.citationPolicies.forEach((policy, index) => {
      (policy.sourceFieldRefs ?? []).forEach((ref, refIndex) =>
        validateFieldRef(findings, datamodel, ref, `citationPolicies[${index}].sourceFieldRefs[${refIndex}]`, "AIGC_INPUT_FIELD_MISSING"),
      );
    });

    model.toolConfigs.forEach((tool, index) => {
      if (tool.permissionRefs.length === 0) {
        pushFinding(findings, "AIGC_TOOL_PERMISSION_MISSING", "error", `toolConfigs[${index}].permissionRefs`, `Tool config ${tool.id} must declare RBAC permission refs.`);
      }
      tool.permissionRefs.forEach((ref, refIndex) =>
        validatePermissionRef(findings, rbac?.permission, ref, `toolConfigs[${index}].permissionRefs[${refIndex}]`),
      );
      if (!tool.budgetPolicyRef || !toolPolicyIds.has(tool.budgetPolicyRef)) {
        pushFinding(findings, "AIGC_TOOL_POLICY_MISSING", "error", `toolConfigs[${index}].budgetPolicyRef`, `Tool config ${tool.id} references missing tool policy.`);
      }
    });

    model.toolPolicies.forEach((policy, index) => {
      if (policy.maxCalls <= 0 || policy.timeoutMs <= 0) {
        pushFinding(findings, "AIGC_TOOL_BUDGET_INVALID", "error", `toolPolicies[${index}]`, `Tool policy ${policy.id} has invalid maxCalls or timeout.`);
      }
      if (policy.permissionRefs.length === 0) {
        pushFinding(findings, "AIGC_TOOL_PERMISSION_MISSING", "error", `toolPolicies[${index}].permissionRefs`, `Tool policy ${policy.id} must declare RBAC permission refs.`);
      }
      policy.permissionRefs.forEach((ref, refIndex) =>
        validatePermissionRef(findings, rbac?.permission, ref, `toolPolicies[${index}].permissionRefs[${refIndex}]`),
      );
    });

    return finalizeReport(findings);
  },

  project(model: AigcModel): Projection {
    const nodes: Projection["nodes"] = [
      { id: nodeId("root", model.id), label: model.name, kind: "aigc" },
      ...model.capabilities.map(cap => ({ id: capabilityNodeId(cap.id), label: cap.id, kind: "capability" })),
      ...model.providers.map(provider => ({ id: nodeId("provider", provider.id), label: provider.id, kind: "provider" })),
      ...model.promptTemplates.map(prompt => ({ id: nodeId("prompt", prompt.id), label: prompt.id, kind: "prompt" })),
      ...model.outputSchemas.map(schema => ({ id: nodeId("schema", schema.id), label: schema.id, kind: "outputSchema" })),
      ...model.knowledgeSources.map(source => ({ id: nodeId("knowledge", source.id), label: source.id, kind: "knowledgeSource" })),
      ...model.retrievalPolicies.map(policy => ({ id: nodeId("retrieval", policy.id), label: policy.id, kind: "retrievalPolicy" })),
      ...model.citationPolicies.map(policy => ({ id: nodeId("citation", policy.id), label: policy.id, kind: "citationPolicy" })),
      ...model.toolConfigs.map(tool => ({ id: nodeId("tool", tool.id), label: tool.id, kind: "tool" })),
      ...model.toolPolicies.map(policy => ({ id: nodeId("toolPolicy", policy.id), label: policy.id, kind: "toolPolicy" })),
    ];

    const edges: Projection["edges"] = [];
    model.capabilities.forEach(cap => {
      edges.push({ from: nodeId("root", model.id), to: capabilityNodeId(cap.id), label: cap.kind, kind: "contains" });
      if (cap.providerRef) edges.push({ from: capabilityNodeId(cap.id), to: nodeId("provider", cap.providerRef), label: "provider", kind: "binding" });
      if (cap.promptRef) edges.push({ from: capabilityNodeId(cap.id), to: nodeId("prompt", cap.promptRef), label: "prompt", kind: "binding" });
      if (cap.outputSchemaRef) edges.push({ from: capabilityNodeId(cap.id), to: nodeId("schema", cap.outputSchemaRef), label: "output", kind: "binding" });
      (cap.knowledgeSourceRefs ?? []).forEach(ref =>
        edges.push({ from: capabilityNodeId(cap.id), to: nodeId("knowledge", ref), label: "RAG", kind: "binding" }),
      );
      if (cap.retrievalPolicyRef) edges.push({ from: capabilityNodeId(cap.id), to: nodeId("retrieval", cap.retrievalPolicyRef), label: "retrieval", kind: "binding" });
      if (cap.citationPolicyRef) edges.push({ from: capabilityNodeId(cap.id), to: nodeId("citation", cap.citationPolicyRef), label: "citation", kind: "binding" });
      (cap.toolRefs ?? []).forEach(ref =>
        edges.push({ from: capabilityNodeId(cap.id), to: nodeId("tool", ref), label: "tool", kind: "binding" }),
      );
      if (cap.toolPolicyRef) edges.push({ from: capabilityNodeId(cap.id), to: nodeId("toolPolicy", cap.toolPolicyRef), label: "tool policy", kind: "binding" });
    });
    model.toolConfigs.forEach(tool => {
      if (tool.budgetPolicyRef) edges.push({ from: nodeId("tool", tool.id), to: nodeId("toolPolicy", tool.budgetPolicyRef), label: "budget", kind: "binding" });
    });

    const lines = ["flowchart LR"];
    for (const n of nodes) lines.push(`  ${n.id}["${n.label.replace(/"/g, "'")}"]`);
    for (const e of edges) lines.push(`  ${e.from} -->|${e.label ?? ""}| ${e.to}`);
    return { nodes, edges, mermaid: lines.join("\n") };
  },

  /**
   * resolve() 输出合约 (P4 — 2026-07 明确化)
   *
   * 向 AppBundleSkill 暴露的字段（AppBundle.validate/evaluate 依赖）：
   *   - `aigc`           : [model.id]                             —— 本 AIGC 应用标识
   *   - `capability`     : cap.id[]                               —— 所有 AI 能力 ID
   *   - `provider`       : provider.id[]                          —— LLM/服务提供商 ID
   *   - `prompt`         : promptTemplate.id[]                    —— Prompt 模板 ID
   *   - `outputSchema`   : outputSchema.id[]                      —— 输出 Schema ID
   *   - `role`           : roleRef[]                              —— 跨系统角色引用（→ RBAC）
   *   - `permission`     : permissionRef[]                        —— 跨系统权限引用（→ RBAC）
   *   - `field`          : inputField∪outputField                 —— 跨系统字段引用（→ DataModel）
   *   - `runtimeEvidence`: evidenceKey[]                          —— 运行时证据 key（AppBundle 闭环用）
   *   - `crossSkillRuntimeEdges`: "sourceSkill->targetSkill:state"[] —— 跨系统运行时边
   *
   * 条件字段（仅正向路径出现）：
   *   - `aigcToDataModelTrace`  : 正向路径 AIGC→DataModel 证据跟踪
   *   - `aigcToRbacTrace`       : AIGC→RBAC fail-closed 访问控制追踪
   *
   * AppBundle 用 `runtimeEvidence` 数组中的 key 来验证 AIGC 证据是否存在；
   * 只有至少一个 key 的证据通过时，AppBundle 才将 AIGC 标记为 evidencePresent=true。
   */
  resolve(model: AigcModel): ResolvableSurface {
    const refs = capabilityRefs(model);
    const crossRuntime = buildAigcCrossRuntimeEdges(model);
    const surface: any = {
      aigc: [model.id],
      capability: model.capabilities.map(cap => cap.id),
      provider: model.providers.map(provider => provider.id),
      prompt: model.promptTemplates.map(prompt => prompt.id),
      outputSchema: model.outputSchemas.map(schema => schema.id),
      knowledgeSource: model.knowledgeSources.map(source => source.id),
      retrievalPolicy: model.retrievalPolicies.map(policy => policy.id),
      citationPolicy: model.citationPolicies.map(policy => policy.id),
      tool: model.toolConfigs.map(tool => tool.id),
      toolPolicy: model.toolPolicies.map(policy => policy.id),
      role: refs.roleRefs,
      permission: refs.permissionRefs,
      field: unique([...refs.inputFieldRefs, ...refs.outputFieldRefs]),
      runtimeEvidence: crossRuntime.map(edge => edge.evidenceKey),
      crossSkillRuntimeEdges: crossRuntime.map(edge => `${edge.sourceSkill}->${edge.targetSkill}:${edge.state}`),
      aigcToDataModelTrace: traceAigcPositiveSampleEvidenceToDataModelSchemaEvidence(model),
      aigcToRbacTrace: traceAigcProposedAccessFailClosedAgainstRbacEvidence(model),
    };
    const datamodelSample = createAigcPositiveSampleEvidence(model, "datamodel");
    if (datamodelSample.state === "allowed") {
      surface.runtimeEvidence = unique([
        ...surface.runtimeEvidence,
        AIGC_POSITIVE_SAMPLE_TO_DATAMODEL,
        AIGC_DATAMODEL_RUNTIME_EVIDENCE,
      ]);
    }
    const rbacEvidence = createAigcProposedAccessRbacEvidence(model, { declared: capabilityRefs(model) });
    if (rbacEvidence.permissionRefs.length > 0 || rbacEvidence.roleRefs.length > 0) {
      surface.runtimeEvidence = unique([...surface.runtimeEvidence, AIGC_RBAC_RUNTIME_EVIDENCE]);
    }
    return surface;
  },

  crossRefs(model: AigcModel): CrossRefEdge[] {
    const refs: CrossRefEdge[] = [];
    model.capabilities.forEach(cap => {
      const fromNode = capabilityNodeId(cap.id);
      (cap.inputFieldRefs ?? []).forEach(ref =>
        refs.push({ fromNode, toSkill: "datamodel", toKind: "field", toValue: ref, label: "input" }),
      );
      (cap.outputFieldRefs ?? []).forEach(ref =>
        refs.push({ fromNode, toSkill: "datamodel", toKind: "field", toValue: ref, label: "output" }),
      );
      (cap.allowedRoleRefs ?? []).forEach(ref =>
        refs.push({ fromNode, toSkill: "rbac", toKind: "role", toValue: ref, label: "PDP role" }),
      );
      (cap.permissionRefs ?? []).forEach(ref =>
        refs.push({ fromNode, toSkill: "rbac", toKind: "permission", toValue: ref, label: "PDP permission" }),
      );
    });
    model.knowledgeSources.forEach(source => {
      (source.fieldRefs ?? []).forEach(ref =>
        refs.push({ fromNode: nodeId("knowledge", source.id), toSkill: "datamodel", toKind: "field", toValue: ref, label: "source field" }),
      );
    });
    model.retrievalPolicies.forEach(policy => {
      policy.allowedRoleRefs.forEach(ref =>
        refs.push({ fromNode: nodeId("retrieval", policy.id), toSkill: "rbac", toKind: "role", toValue: ref, label: "retrieval role" }),
      );
      policy.permissionRefs.forEach(ref =>
        refs.push({ fromNode: nodeId("retrieval", policy.id), toSkill: "rbac", toKind: "permission", toValue: ref, label: "retrieval permission" }),
      );
    });
    model.toolConfigs.forEach(tool => {
      tool.permissionRefs.forEach(ref =>
        refs.push({ fromNode: nodeId("tool", tool.id), toSkill: "rbac", toKind: "permission", toValue: ref, label: "tool permission" }),
      );
    });
    return refs;
  },

  refNodeId(kind: string, value: string): string | null {
    switch (kind) {
      case "aigc":
        return nodeId("root", value);
      case "capability":
        return capabilityNodeId(value);
      case "provider":
        return nodeId("provider", value);
      case "prompt":
        return nodeId("prompt", value);
      case "outputSchema":
        return nodeId("schema", value);
      case "knowledgeSource":
        return nodeId("knowledge", value);
      case "tool":
        return nodeId("tool", value);
      default:
        return null;
    }
  },

  async generate(intent: string): Promise<AigcModel> {
    if (/purchase|procurement|risk|budget|采购/i.test(intent)) return purchaseRiskAigcModel;
    return emptyLeaveAigcModel;
  },
};

export type AigcRuntimeTargetSkill = "rbac" | "datamodel" | "workflow" | "page" | "appbundle";

export type AigcRuntimeEvidenceState = "allowed" | "blocked";

export interface AigcCrossRuntimeEvidence {
  sourceSkill: "aigc";
  targetSkill: AigcRuntimeTargetSkill;
  evidenceKey: string;
  state: AigcRuntimeEvidenceState;
  reasonCode: string;
  modelId: string;
  capabilityRefs: string[];
  roleRefs: string[];
  permissionRefs: string[];
  fieldRefs: string[];
  outputSchemaRefs: string[];
  toolRefs: string[];
}

export interface NormalizedAigcRuntimeContext {
  sourceSkill: "aigc";
  targetSkill: AigcRuntimeTargetSkill;
  modelId: string;
  capabilityRefs: string[];
  roleRefs: string[];
  permissionRefs: string[];
  fieldRefs: string[];
  upstreamEvidencePresent: boolean;
  evidence: AigcCrossRuntimeEvidence;
}

export const AIGC_CROSS_RUNTIME_EVIDENCE = "AIGC_CROSS_RUNTIME_EVIDENCE";
export const AIGC_RBAC_RUNTIME_EVIDENCE = "AIGC_RBAC_RUNTIME_EVIDENCE";
export const AIGC_DATAMODEL_RUNTIME_EVIDENCE = "AIGC_DATAMODEL_RUNTIME_EVIDENCE";
export const AIGC_RBAC_PROPOSED_ACCESS_TRACE = "AIGC_RBAC_PROPOSED_ACCESS_TRACE";

export interface AigcProposedAccessToRbacTrace {
  traceId: typeof AIGC_RBAC_PROPOSED_ACCESS_TRACE;
  sourceSkill: "aigc";
  targetSkill: "rbac";
  state: "closed" | "blocked";
  reasonCode: string;
  modelId: string;
  capabilityRefs: string[];
  roleRefs: string[];
  permissionRefs: string[];
  evidenceKey: string;
}

function aigcRefsForTarget(model: AigcModel, targetSkill: AigcRuntimeTargetSkill): string[] {
  const refs = capabilityRefs(model);
  if (targetSkill === "rbac") return [...refs.roleRefs, ...refs.permissionRefs].sort();
  if (targetSkill === "datamodel") return [...refs.inputFieldRefs, ...refs.outputFieldRefs, ...model.knowledgeSources.flatMap(source => source.fieldRefs ?? [])].sort();
  if (targetSkill === "workflow") return model.toolConfigs.filter(tool => tool.kind === "workflow").flatMap(tool => tool.toolRefs).sort();
  if (targetSkill === "page") return [...refs.outputFieldRefs, ...model.outputSchemas.flatMap(schema => schema.fields.map(field => field.key))].sort();
  return [
    ...model.capabilities.map(capability => capability.id),
    ...refs.roleRefs,
    ...refs.permissionRefs,
    ...refs.inputFieldRefs,
    ...refs.outputFieldRefs,
  ].sort();
}

export function createAigcCrossRuntimeEvidence(
  model: AigcModel,
  targetSkill: AigcRuntimeTargetSkill,
  upstreamSurface?: unknown,
): AigcCrossRuntimeEvidence {
  const refs = capabilityRefs(model);
  const targetRefs = aigcRefsForTarget(model, targetSkill);
  const upstreamEvidencePresent = upstreamSurface !== undefined && upstreamSurface !== null;
  const state: AigcRuntimeEvidenceState =
    targetRefs.length > 0 && upstreamEvidencePresent ? "allowed" : "blocked";

  return {
    sourceSkill: "aigc",
    targetSkill,
    evidenceKey: `${AIGC_CROSS_RUNTIME_EVIDENCE}:${targetSkill}:${state}`,
    state,
    reasonCode: state === "allowed" ? "AIGC_RUNTIME_EVIDENCE_PRESENT" : "AIGC_RUNTIME_UPSTREAM_ABSENT",
    modelId: model.id,
    capabilityRefs: model.capabilities.map(capability => capability.id).sort(),
    roleRefs: refs.roleRefs.sort(),
    permissionRefs: refs.permissionRefs.sort(),
    fieldRefs: unique([...refs.inputFieldRefs, ...refs.outputFieldRefs]).sort(),
    outputSchemaRefs: model.outputSchemas.map(schema => schema.id).sort(),
    toolRefs: model.toolConfigs.flatMap(tool => tool.toolRefs).sort(),
  };
}

export function normalizeAigcRuntimeContextForSkill(
  model: AigcModel,
  targetSkill: AigcRuntimeTargetSkill,
  upstreamSurface?: unknown,
): NormalizedAigcRuntimeContext {
  const evidence = createAigcCrossRuntimeEvidence(model, targetSkill, upstreamSurface);
  return {
    sourceSkill: "aigc",
    targetSkill,
    modelId: model.id,
    capabilityRefs: evidence.capabilityRefs,
    roleRefs: evidence.roleRefs,
    permissionRefs: evidence.permissionRefs,
    fieldRefs: evidence.fieldRefs,
    upstreamEvidencePresent: evidence.state === "allowed",
    evidence,
  };
}

export function buildAigcCrossRuntimeEdges(model: AigcModel): AigcCrossRuntimeEvidence[] {
  const targets: AigcRuntimeTargetSkill[] = ["rbac", "datamodel", "workflow", "page", "appbundle"];
  return targets
    .filter(target => aigcRefsForTarget(model, target).length > 0)
    .map(target => createAigcCrossRuntimeEvidence(model, target, { declared: aigcRefsForTarget(model, target) }));
}

export function createAigcRbacRuntimeEvidence(
  model: AigcModel,
  upstreamSurface: unknown,
): AigcCrossRuntimeEvidence {
  return {
    ...createAigcCrossRuntimeEvidence(model, "rbac", upstreamSurface),
    evidenceKey: AIGC_RBAC_RUNTIME_EVIDENCE,
  };
}

export function createAigcDataModelRuntimeEvidence(
  model: AigcModel,
  upstreamSurface?: unknown,
): AigcCrossRuntimeEvidence {
  return {
    ...createAigcCrossRuntimeEvidence(model, "datamodel", upstreamSurface),
    evidenceKey: AIGC_DATAMODEL_RUNTIME_EVIDENCE,
  };
}

export function createAigcProposedAccessRbacEvidence(
  model: AigcModel,
  upstreamSurface?: unknown,
): AigcCrossRuntimeEvidence {
  return {
    ...createAigcCrossRuntimeEvidence(model, "rbac", upstreamSurface),
    evidenceKey: AIGC_RBAC_RUNTIME_EVIDENCE,
  };
}

export function traceAigcProposedAccessFailClosedAgainstRbacEvidence(
  model: AigcModel,
  rbacSurface?: { role?: string[]; permission?: string[]; permissions?: string[] },
): AigcProposedAccessToRbacTrace {
  const refs = capabilityRefs(model);
  const roleRefs = refs.roleRefs.sort();
  const permissionRefs = refs.permissionRefs.sort();
  const rbacRoles = rbacSurface?.role ?? [];
  const rbacPermissions = rbacSurface?.permission ?? rbacSurface?.permissions ?? [];
  const hasProposedAccess = model.capabilities.length > 0 && (roleRefs.length > 0 || permissionRefs.length > 0);
  const hasAllRoles = roleRefs.every(role => rbacRoles.includes(role));
  const hasAllPermissions = permissionRefs.every(permission => rbacPermissions.includes(permission));
  const closed = hasProposedAccess && hasAllRoles && hasAllPermissions;

  return {
    traceId: AIGC_RBAC_PROPOSED_ACCESS_TRACE,
    sourceSkill: "aigc",
    targetSkill: "rbac",
    state: closed ? "closed" : "blocked",
    reasonCode: closed
      ? "AIGC_PROPOSED_ACCESS_RBAC_EVIDENCE_CLOSED"
      : "AIGC_PROPOSED_ACCESS_FAIL_CLOSED_AGAINST_RBAC",
    modelId: model.id,
    capabilityRefs: model.capabilities.map(capability => capability.id).sort(),
    roleRefs,
    permissionRefs,
    evidenceKey: `${AIGC_RBAC_PROPOSED_ACCESS_TRACE}:${closed ? "closed" : "blocked"}`,
  };
}

export const emptyLeaveAigcModel: AigcModel = {
  id: "aigc_empty_leave",
  name: "No AIGC capability for leave approval",
  pep: "pep",
  capabilities: [],
  providers: [],
  promptTemplates: [],
  outputSchemas: [],
  knowledgeSources: [],
  retrievalPolicies: [],
  citationPolicies: [],
  toolConfigs: [],
  toolPolicies: [],
  traceSpan: "aigc.leave.none.v1",
};

export const purchaseRiskAigcModel: AigcModel = {
  id: "aigc_purchase_risk",
  name: "Purchase Risk AIGC",
  pep: "pep",
  traceSpan: "aigc.purchase.risk.v1",
  capabilities: [
    {
      id: "budget_risk_summary",
      name: "Budget Risk Summary",
      kind: "summary",
      flowRef: "aigc_flow_purchase_risk",
      providerRef: "openai_gpt4o_ref",
      promptRef: "purchase_risk_prompt",
      outputSchemaRef: "purchase_risk_output",
      inputFieldRefs: [
        "purchase_request.amount",
        "purchase_request.department",
        "purchase_request.vendor",
        "purchase_request.budgetChecked",
      ],
      outputFieldRefs: [],
      allowedRoleRefs: ["finance", "department_manager"],
      permissionRefs: ["purchase:view", "purchase:finance_approve"],
      knowledgeSourceRefs: ["vendor_policy_knowledge"],
      retrievalPolicyRef: "purchase_risk_retrieval",
      citationPolicyRef: "purchase_risk_citation",
      toolRefs: ["budget_policy_lookup"],
      toolPolicyRef: "purchase_tool_policy",
      traceSpan: "aigc.purchase.risk.summary.v1",
    },
  ],
  providers: [
    {
      id: "openai_gpt4o_ref",
      name: "OpenAI GPT-4o reference",
      providerRef: "openai",
      modelRef: "gpt-4o",
      tokenBudget: 16000,
      keyRef: "keyref:llm/openai/default",
    },
  ],
  promptTemplates: [
    {
      id: "purchase_risk_prompt",
      version: "1.0.0",
      template: "Summarize purchase risk using approved SSOT fields only.",
      variables: ["amount", "department", "vendor", "budgetChecked"],
    },
  ],
  outputSchemas: [
    {
      id: "purchase_risk_output",
      version: "1.0.0",
      fields: [
        { key: "riskLevel", type: "enum", required: true, enumValues: ["low", "medium", "high"] },
        { key: "summary", type: "string", required: true },
        { key: "recommendedAction", type: "string", required: true },
      ],
    },
  ],
  knowledgeSources: [
    {
      id: "vendor_policy_knowledge",
      name: "Vendor and budget policy corpus",
      datasourceRef: "knowledge.procurement.policy",
      fieldRefs: ["purchase_request.vendor", "purchase_request.department"],
    },
  ],
  retrievalPolicies: [
    {
      id: "purchase_risk_retrieval",
      allowedRoleRefs: ["finance", "department_manager"],
      permissionRefs: ["purchase:view"],
      maxResults: 5,
    },
  ],
  citationPolicies: [
    {
      id: "purchase_risk_citation",
      citationRequired: true,
      sourceFieldRefs: ["purchase_request.vendor"],
    },
  ],
  toolConfigs: [
    {
      id: "budget_policy_lookup",
      name: "Budget policy lookup",
      kind: "lookup",
      toolRefs: ["budget_policy"],
      permissionRefs: ["purchase:finance_approve"],
      budgetPolicyRef: "purchase_tool_policy",
    },
  ],
  toolPolicies: [
    {
      id: "purchase_tool_policy",
      whitelist: ["budget_policy"],
      permissionRefs: ["purchase:finance_approve"],
      maxCalls: 2,
      timeoutMs: 3000,
    },
  ],
};

// Fixture for AIGC negative sample (119): capability declares refs but policy or schema evidence absent -> fail-closed in evaluate + evidence creators.
export const aigcModelWithMissingPolicyOrSchema: AigcModel = {
  id: "aigc_missing_policy_schema_negative",
  name: "AIGC negative sample - policy or schema absent",
  pep: "pep",
  capabilities: [
    {
      id: "cap_without_policy_schema",
      name: "Cap missing policy/schema",
      kind: "summary",
      providerRef: "openai_gpt4o_ref",
      promptRef: "purchase_risk_prompt",
      outputSchemaRef: "purchase_risk_output",
      permissionRefs: ["purchase:finance_approve"],
      knowledgeSourceRefs: ["vendor_policy_knowledge"],  // RAG without policy -> fail closed
      retrievalPolicyRef: undefined,
      citationPolicyRef: undefined,
      toolRefs: [],
    },
  ],
  providers: [
    {
      id: "openai_gpt4o_ref",
      name: "OpenAI GPT-4o reference",
      providerRef: "openai",
      modelRef: "gpt-4o",
      tokenBudget: 16000,
      keyRef: "keyref:llm/openai/default",
    },
  ],
  promptTemplates: [
    {
      id: "purchase_risk_prompt",
      version: "1.0.0",
      template: "Summarize.",
    },
  ],
  outputSchemas: [],  // schema evidence absent
  knowledgeSources: [],
  retrievalPolicies: [],
  citationPolicies: [],
  toolConfigs: [],
  toolPolicies: [],
};

export const AIGC_RUNTIME_POLICY_DENIED = "AIGC_RUNTIME_POLICY_DENIED" as const;

// AIGC positive sample evidence for DataModel / Page / RBAC / AppBundle closure (119)
export const AIGC_POSITIVE_SAMPLE_EVIDENCE = "AIGC_POSITIVE_SAMPLE_EVIDENCE";
export const AIGC_POSITIVE_SAMPLE_TO_DATAMODEL = "AIGC_POSITIVE_SAMPLE_TO_DATAMODEL";
export const AIGC_POSITIVE_SAMPLE_TO_PAGE = "AIGC_POSITIVE_SAMPLE_TO_PAGE";
export const AIGC_POSITIVE_SAMPLE_TO_RBAC = "AIGC_POSITIVE_SAMPLE_TO_RBAC";
export const AIGC_POSITIVE_SAMPLE_TO_APPBUNDLE = "AIGC_POSITIVE_SAMPLE_TO_APPBUNDLE";
export const AIGC_DATAMODEL_TRACE = "AIGC_DATAMODEL_TRACE";

export interface AigcToDataModelTrace {
  traceId: typeof AIGC_DATAMODEL_TRACE;
  sourceSkill: "aigc";
  targetSkill: "datamodel";
  state: "closed" | "blocked";
  reasonCode: string;
  modelId: string;
  capabilityRefs: string[];
  schemaRefs: string[];
  fieldRefs: string[];
  evidenceKey: string;
}

export function createAigcPositiveSampleEvidence(
  model: AigcModel = purchaseRiskAigcModel,
  targetSkill: AigcRuntimeTargetSkill = "appbundle"
): AigcCrossRuntimeEvidence {
  const refs = aigcRefsForTarget(model, targetSkill);
  const base = createAigcCrossRuntimeEvidence(model, targetSkill, { declared: refs });
  // Override to dedicated positive sample evidence key for closure consumers (DM/Page/RBAC/AppBundle)
  const positiveKey =
    targetSkill === "datamodel" ? AIGC_POSITIVE_SAMPLE_TO_DATAMODEL :
    targetSkill === "page" ? AIGC_POSITIVE_SAMPLE_TO_PAGE :
    targetSkill === "rbac" ? AIGC_POSITIVE_SAMPLE_TO_RBAC :
    AIGC_POSITIVE_SAMPLE_TO_APPBUNDLE;
  return {
    ...base,
    evidenceKey: positiveKey,
  };
}

export function traceAigcPositiveSampleEvidenceToDataModelSchemaEvidence(
  model: AigcModel,
  datamodelSurface?: { field?: string[]; outputSchema?: string[]; fields?: Array<{ ref?: string }> },
): AigcToDataModelTrace {
  const refs = capabilityRefs(model);
  const schemaRefs = model.outputSchemas.map(schema => schema.id).sort();
  const fieldRefs = unique([...refs.inputFieldRefs, ...refs.outputFieldRefs]);
  const capabilityIds = model.capabilities.map(capability => capability.id).sort();
  const surfaceRefs = datamodelSurface
    ? unique([
        ...(datamodelSurface.field ?? []),
        ...(datamodelSurface.outputSchema ?? []),
        ...((datamodelSurface.fields ?? []).map(field => field.ref).filter((ref): ref is string => typeof ref === "string")),
      ])
    : [...schemaRefs, ...fieldRefs];
  const hasSchemaEvidence = schemaRefs.length > 0 && fieldRefs.length > 0;
  const hasSurfaceEvidence = schemaRefs.some(ref => surfaceRefs.includes(ref)) || fieldRefs.some(ref => surfaceRefs.includes(ref));
  const closed = capabilityIds.length > 0 && hasSchemaEvidence && hasSurfaceEvidence;

  return {
    traceId: AIGC_DATAMODEL_TRACE,
    sourceSkill: "aigc",
    targetSkill: "datamodel",
    state: closed ? "closed" : "blocked",
    reasonCode: closed
      ? "AIGC_POSITIVE_SAMPLE_TO_DATAMODEL_SCHEMA_CLOSED"
      : "AIGC_POSITIVE_SAMPLE_TO_DATAMODEL_SCHEMA_FAIL_CLOSED",
    modelId: model.id,
    capabilityRefs: capabilityIds,
    schemaRefs,
    fieldRefs,
    evidenceKey: `${AIGC_DATAMODEL_TRACE}:${closed ? "closed" : "blocked"}`,
  };
}

export function createAigcFailClosedNegativeEvidence(
  model: AigcModel = purchaseRiskAigcModel,
  targetSkill: AigcRuntimeTargetSkill = "page"
): AigcCrossRuntimeEvidence {
  // Explicit fail-closed negative: absent/empty upstream surface yields "blocked"
  return createAigcCrossRuntimeEvidence(model, targetSkill);
}

// AIGC negative sample evidence (119): fails closed when policy (retrieval/citation/tool) or schema evidence is absent.
export const AIGC_NEGATIVE_SAMPLE_EVIDENCE = "AIGC_NEGATIVE_SAMPLE_EVIDENCE";
export const AIGC_NEGATIVE_SAMPLE_POLICY_SCHEMA_ABSENT = "AIGC_NEGATIVE_SAMPLE_POLICY_SCHEMA_ABSENT";

export function createAigcNegativeSampleForPolicyOrSchemaAbsent(
  model: AigcModel = purchaseRiskAigcModel,
  targetSkill: AigcRuntimeTargetSkill = "appbundle"
): AigcCrossRuntimeEvidence {
  // Dedicated fail-closed negative path for when policy or output schema evidence absent in AIGC wiring.
  // Uses upstream-absent to force "blocked" state; evaluateAigcRuntimePolicy separately denies on missing policy/schema refs.
  const base = createAigcCrossRuntimeEvidence(model, targetSkill);
  return {
    ...base,
    evidenceKey: AIGC_NEGATIVE_SAMPLE_POLICY_SCHEMA_ABSENT,
    reasonCode: "AIGC_RUNTIME_POLICY_OR_SCHEMA_EVIDENCE_ABSENT",
    state: "blocked",
  };
}

export type AigcRuntimePolicyDecision =
  | typeof AIGC_RUNTIME_POLICY_DENIED
  | AigcInvocationPlan;

export function evaluateAigcRuntimePolicy(
  model: AigcModel,
  capabilityId: string,
  ctx: AigcRuntimeContext = {}
): AigcRuntimePolicyDecision {
  const capability = model.capabilities.find((c) => c.id === capabilityId);
  if (!capability) {
    return AIGC_RUNTIME_POLICY_DENIED;
  }

  // Check provider/model refs
  const provider = model.providers.find((p) => p.id === capability.providerRef);
  if (!provider || !provider.modelRef || !provider.providerRef) {
    return AIGC_RUNTIME_POLICY_DENIED;
  }

  // Check retrieval policy, citation policy if RAG-backed
  const usesRAG = (capability.knowledgeSourceRefs ?? []).length > 0;
  if (usesRAG) {
    if (!capability.retrievalPolicyRef) {
      return AIGC_RUNTIME_POLICY_DENIED;
    }
    const retrieval = model.retrievalPolicies.find(
      (p) => p.id === capability.retrievalPolicyRef
    );
    if (!retrieval) {
      return AIGC_RUNTIME_POLICY_DENIED;
    }
    const citation = capability.citationPolicyRef
      ? model.citationPolicies.find((p) => p.id === capability.citationPolicyRef)
      : null;
    if (!citation || !citation.citationRequired) {
      return AIGC_RUNTIME_POLICY_DENIED;
    }
  }

  // Check tool policy, represent toolCallBudget
  let toolCallBudget: ToolCallBudget | undefined;
  const usesTools = (capability.toolRefs ?? []).length > 0;
  if (usesTools) {
    if (!capability.toolPolicyRef) {
      return AIGC_RUNTIME_POLICY_DENIED;
    }
    const toolPolicy = model.toolPolicies.find(
      (p) => p.id === capability.toolPolicyRef
    );
    if (!toolPolicy || toolPolicy.maxCalls <= 0 || toolPolicy.timeoutMs <= 0) {
      return AIGC_RUNTIME_POLICY_DENIED;
    }
    toolCallBudget = { maxCalls: toolPolicy.maxCalls, timeoutMs: toolPolicy.timeoutMs };
  }

  // RBAC permission evidence must be present and sufficient (fail-closed)
  const requiredPermissions = capability.permissionRefs ?? [];
  const rbacPerms: string[] =
    ctx.rbac?.permission ?? ctx.rbac?.permissions ?? [];
  if (requiredPermissions.length > 0) {
    if (rbacPerms.length === 0) {
      return AIGC_RUNTIME_POLICY_DENIED;
    }
    const hasAll = requiredPermissions.every((p) => rbacPerms.includes(p));
    if (!hasAll) {
      return AIGC_RUNTIME_POLICY_DENIED;
    }
  }

  // DataModel field refs and lifecycle must be evidenced and non-removed (fail-closed)
  const dm = ctx.datamodel;
  const dmStringFields: string[] = dm?.field ?? [];
  const dmRichFields: Array<{ ref: string; lifecycle?: string }> =
    dm?.fields ?? [];
  const requiredFields = [
    ...(capability.inputFieldRefs ?? []),
    ...(capability.outputFieldRefs ?? []),
  ];
  if (requiredFields.length > 0) {
    if (dmStringFields.length === 0 && dmRichFields.length === 0) {
      return AIGC_RUNTIME_POLICY_DENIED;
    }
    const availableRefs =
      dmStringFields.length > 0
        ? dmStringFields
        : dmRichFields.map((f) => f.ref);
    for (const f of requiredFields) {
      if (!availableRefs.includes(f)) {
        return AIGC_RUNTIME_POLICY_DENIED;
      }
      const meta = dmRichFields.find((m) => m.ref === f);
      if (meta && meta.lifecycle === "removed") {
        return AIGC_RUNTIME_POLICY_DENIED;
      }
    }
  }

  // Produce invocation plan
  const plan: AigcInvocationPlan = {
    capabilityId: capability.id,
    providerRef: capability.providerRef!,
    promptRef: capability.promptRef!,
    outputSchemaRef: capability.outputSchemaRef!,
  };
  if (capability.retrievalPolicyRef) {
    const rp = model.retrievalPolicies.find(
      (p) => p.id === capability.retrievalPolicyRef
    )!;
    plan.retrievalPolicy = { id: rp.id, maxResults: rp.maxResults };
  }
  if (capability.citationPolicyRef) {
    plan.citationPolicy = {
      id: capability.citationPolicyRef,
      citationRequired: true,
    };
  }
  if (toolCallBudget) {
    plan.toolCallBudget = toolCallBudget;
  }
  return plan;
}
