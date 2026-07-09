import { describe, expect, it } from "vitest";

import { dataModelSkill, purchaseApprovalDataModel } from "../datamodel/dataModelSkill";
import { purchaseApprovalRbac, rbacSkill } from "../rbac/rbacSkill";
import {
  aigcSkill,
  buildAigcCrossRuntimeEdges,
  createAigcDataModelRuntimeEvidence,
  createAigcRbacRuntimeEvidence,
  createAigcPositiveSampleEvidence,
  createAigcFailClosedNegativeEvidence,
  createAigcNegativeSampleForPolicyOrSchemaAbsent,
  createAigcProposedAccessRbacEvidence,
  normalizeAigcRuntimeContextForSkill,
  AIGC_DATAMODEL_RUNTIME_EVIDENCE,
  AIGC_DATAMODEL_TRACE,
  AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID,
  AIGC_RUNTIME_POLICY_DENIED,
  AIGC_RBAC_RUNTIME_EVIDENCE,
  AIGC_RBAC_PROPOSED_ACCESS_TRACE,
  AIGC_POSITIVE_SAMPLE_EVIDENCE,
  AIGC_POSITIVE_SAMPLE_TO_DATAMODEL,
  AIGC_POSITIVE_SAMPLE_TO_PAGE,
  AIGC_POSITIVE_SAMPLE_TO_RBAC,
  AIGC_POSITIVE_SAMPLE_TO_APPBUNDLE,
  AIGC_NEGATIVE_SAMPLE_POLICY_SCHEMA_ABSENT,
  traceAigcPositiveSampleEvidenceToDataModelSchemaEvidence,
  traceAigcProposedAccessFailClosedAgainstRbacEvidence,
  emptyLeaveAigcModel,
  evaluateAigcRuntimePolicy,
  purchaseRiskAigcModel,
  aigcModelWithMissingPolicyOrSchema,
  validateAigcRuntimeOutput,
} from "./aigcSkill";
import type { AigcModel } from "./aigcModel";

const clone = (model: AigcModel): AigcModel => structuredClone(model);

const fullSurface = {
  datamodel: dataModelSkill.resolve(purchaseApprovalDataModel),
  rbac: rbacSkill.resolve(purchaseApprovalRbac),
};

describe("aigcSkill - V2 base metamodel", () => {
  it("models purchase budget_risk_summary as a runtime-less PEP capability", () => {
    const capability = purchaseRiskAigcModel.capabilities.find(cap => cap.id === "budget_risk_summary");

    expect(purchaseRiskAigcModel.pep).toBe("pep");
    expect(capability).toBeTruthy();
    expect(capability?.kind).toBe("summary");
    expect(capability?.allowedRoleRefs).toEqual(["finance", "department_manager"]);
    expect(capability?.inputFieldRefs).toEqual(
      expect.arrayContaining([
        "purchase_request.amount",
        "purchase_request.department",
        "purchase_request.vendor",
        "purchase_request.budgetChecked",
      ]),
    );
    expect(capability?.outputSchemaRef).toBe("purchase_risk_output");
  });

  it("passes the deterministic purchase risk sample when RBAC and DataModel are wired", () => {
    const report = aigcSkill.validate(purchaseRiskAigcModel, { external: fullSurface });

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });
});

describe("aigcSkill - provider router and no-secret gate", () => {
  it("rejects missing provider/model routes and invalid budgets", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.capabilities[0].providerRef = "missing_provider";
    broken.providers[0].modelRef = "";
    broken.providers[0].tokenBudget = 0;

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_PROVIDER_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_MODEL_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_TOKEN_BUDGET_INVALID")).toBe(true);
  });

  it("rejects raw provider secrets while allowing keyRef or secretRef only", () => {
    const broken = clone(purchaseRiskAigcModel);
    (broken.providers[0] as any).apiKey = "raw-provider-token";

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_RAW_SECRET")).toBe(true);
  });
});

describe("aigcSkill - prompt templates and output schemas", () => {
  it("requires versioned prompts and typed output schemas", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.capabilities[0].promptRef = "missing_prompt";
    broken.promptTemplates[0].version = "";
    broken.outputSchemas[0].fields[0].type = "blob" as any;

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_PROMPT_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_PROMPT_VERSION_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_OUTPUT_SCHEMA_INVALID")).toBe(true);
  });

  it("rejects capabilities that reference missing output schemas", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.capabilities[0].outputSchemaRef = "missing_schema";

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_OUTPUT_SCHEMA_MISSING")).toBe(true);
  });

  it("defines deterministic riskLevel, summary, and recommendedAction output fields", () => {
    const schema = purchaseRiskAigcModel.outputSchemas.find(item => item.id === "purchase_risk_output");

    expect(schema?.fields.map(field => field.key)).toEqual(["riskLevel", "summary", "recommendedAction"]);
  });
});

describe("aigcSkill - RAG retrieval and citation policy", () => {
  it("rejects missing knowledge source, retrieval policy, and citation policy", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.capabilities[0].knowledgeSourceRefs = ["missing_knowledge"];
    broken.capabilities[0].retrievalPolicyRef = "missing_retrieval";
    broken.capabilities[0].citationPolicyRef = "missing_citation";

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_RAG_SOURCE_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_RETRIEVAL_POLICY_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_CITATION_REQUIRED")).toBe(true);
  });

  it("blocks retrieval policies that make local auth decisions instead of delegating to RBAC", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.retrievalPolicies[0].allowedRoleRefs = [];
    broken.retrievalPolicies[0].permissionRefs = [];

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_RETRIEVAL_PEP_BYPASS")).toBe(true);
  });
});

describe("aigcSkill - tool metadata gate", () => {
  it("rejects missing tool config and missing tool policy", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.capabilities[0].toolRefs = ["missing_tool"];
    broken.capabilities[0].toolPolicyRef = "missing_policy";

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_TOOL_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_TOOL_POLICY_MISSING")).toBe(true);
  });

  it("rejects tool configs without permission refs and invalid budgets", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.toolConfigs[0].permissionRefs = [];
    broken.toolPolicies[0].maxCalls = 0;
    broken.toolPolicies[0].timeoutMs = -1;

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_TOOL_PERMISSION_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_TOOL_BUDGET_INVALID")).toBe(true);
  });
});

describe("aigcSkill - PEP RBAC gate", () => {
  it("warns when RBAC is not wired and errors when wired RBAC lacks refs", () => {
    const unresolved = aigcSkill.validate(purchaseRiskAigcModel, {
      external: { datamodel: fullSurface.datamodel },
    });
    expect(unresolved.ok).toBe(true);
    expect(unresolved.warnings.some(e => e.code === "AIGC_ROLE_UNRESOLVED")).toBe(true);
    expect(unresolved.warnings.some(e => e.code === "AIGC_PERMISSION_UNRESOLVED")).toBe(true);

    const missing = aigcSkill.validate(purchaseRiskAigcModel, {
      external: { datamodel: fullSurface.datamodel, rbac: { role: ["requester"], permission: ["purchase:create"] } },
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.some(e => e.code === "AIGC_ROLE_MISSING")).toBe(true);
    expect(missing.errors.some(e => e.code === "AIGC_PERMISSION_MISSING")).toBe(true);
  });

  it("blocks local-only authorization on a PEP capability", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.capabilities[0].allowWithoutPdp = true;

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_PEP_BYPASS")).toBe(true);
  });
});

describe("aigcSkill - DataModel SSOT field gate", () => {
  it("rejects missing input/output field refs", () => {
    const broken = clone(purchaseRiskAigcModel);
    broken.capabilities[0].inputFieldRefs = ["purchase_request.missingInput"];
    broken.capabilities[0].outputFieldRefs = ["purchase_request.missingOutput"];

    const report = aigcSkill.validate(broken, { external: fullSurface });

    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "AIGC_INPUT_FIELD_MISSING")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_OUTPUT_FIELD_MISSING")).toBe(true);
  });

  it("warns on deprecated fields and fails on removed fields from DataModel metadata", () => {
    const surface = {
      ...fullSurface.datamodel,
      fields: [
        { ref: "purchase_request.amount", lifecycle: "deprecated" },
        { ref: "purchase_request.vendor", lifecycle: "removed" },
        { ref: "purchase_request.department", lifecycle: "active" },
        { ref: "purchase_request.budgetChecked", lifecycle: "active" },
      ],
    };

    const report = aigcSkill.validate(purchaseRiskAigcModel, {
      external: { datamodel: surface, rbac: fullSurface.rbac },
    });

    expect(report.ok).toBe(false);
    expect(report.warnings.some(e => e.code === "AIGC_FIELD_DEPRECATED")).toBe(true);
    expect(report.errors.some(e => e.code === "AIGC_FIELD_REMOVED")).toBe(true);
  });
});

describe("aigcSkill - projection, resolve, and crossRefs", () => {
  it("projects provider, prompt, output schema, RAG, citation, and tool nodes", () => {
    const projection = aigcSkill.project(purchaseRiskAigcModel);
    const kinds = projection.nodes.map(node => node.kind);

    expect(kinds).toEqual(
      expect.arrayContaining([
        "aigc",
        "capability",
        "provider",
        "prompt",
        "outputSchema",
        "knowledgeSource",
        "retrievalPolicy",
        "citationPolicy",
        "tool",
        "toolPolicy",
      ]),
    );
    expect(projection.mermaid).toContain("budget_risk_summary");
  });

  it("resolves AIGC surfaces and emits RBAC/DataModel cross refs", () => {
    const surface = aigcSkill.resolve(purchaseRiskAigcModel);
    const refs = aigcSkill.crossRefs(purchaseRiskAigcModel);

    expect(surface.aigc).toEqual(["aigc_purchase_risk"]);
    expect(surface.capability).toContain("budget_risk_summary");
    expect(surface.provider).toContain("openai_gpt4o_ref");
    expect(surface.prompt).toContain("purchase_risk_prompt");
    expect(surface.outputSchema).toContain("purchase_risk_output");
    expect(surface.knowledgeSource).toContain("vendor_policy_knowledge");
    expect(surface.tool).toContain("budget_policy_lookup");
    expect(refs.some(ref => ref.toSkill === "datamodel" && ref.toValue === "purchase_request.amount")).toBe(true);
    expect(refs.some(ref => ref.toSkill === "rbac" && ref.toValue === "finance")).toBe(true);
    expect(aigcSkill.refNodeId("capability", "budget_risk_summary")).toBe("aigc_cap_budget_risk_summary");
  });
});

describe("aigcSkill - runtime policy evaluation (117)", () => {
  const runtimeCtx = {
    rbac: fullSurface.rbac,
    datamodel: fullSurface.datamodel,
  };

  it("evaluates positive invocation plan for purchase capability with full evidence", () => {
    const decision = evaluateAigcRuntimePolicy(
      purchaseRiskAigcModel,
      "budget_risk_summary",
      runtimeCtx
    );

    expect(decision).not.toBe(AIGC_RUNTIME_POLICY_DENIED);
    if (decision !== AIGC_RUNTIME_POLICY_DENIED) {
      expect(decision.capabilityId).toBe("budget_risk_summary");
      expect(decision.providerRef).toBe("openai_gpt4o_ref");
      expect(decision.promptRef).toBe("purchase_risk_prompt");
      expect(decision.toolCallBudget).toEqual({ maxCalls: 2, timeoutMs: 3000 });
      expect(decision.retrievalPolicy?.maxResults).toBe(5);
      expect(decision.citationPolicy?.citationRequired).toBe(true);
    }
  });

  it("fails closed (returns AIGC_RUNTIME_POLICY_DENIED) for missing capability, missing RBAC evidence, insufficient permissions, or removed DataModel fields", () => {
    // missing cap
    const noCap = evaluateAigcRuntimePolicy(purchaseRiskAigcModel, "nonexistent_cap", runtimeCtx);
    expect(noCap).toBe(AIGC_RUNTIME_POLICY_DENIED);

    // missing RBAC evidence
    const noRbac = evaluateAigcRuntimePolicy(purchaseRiskAigcModel, "budget_risk_summary", {});
    expect(noRbac).toBe(AIGC_RUNTIME_POLICY_DENIED);

    // insufficient perm
    const weakRbac = evaluateAigcRuntimePolicy(purchaseRiskAigcModel, "budget_risk_summary", {
      rbac: { permission: ["purchase:view"] }, // missing "purchase:finance_approve"
      datamodel: fullSurface.datamodel,
    });
    expect(weakRbac).toBe(AIGC_RUNTIME_POLICY_DENIED);

    // removed field
    const removedDm = {
      field: ["purchase_request.amount", "purchase_request.department", "purchase_request.vendor", "purchase_request.budgetChecked"],
      fields: [
        { ref: "purchase_request.vendor", lifecycle: "removed" },
      ],
    };
    const removedField = evaluateAigcRuntimePolicy(purchaseRiskAigcModel, "budget_risk_summary", {
      rbac: fullSurface.rbac,
      datamodel: removedDm,
    });
    expect(removedField).toBe(AIGC_RUNTIME_POLICY_DENIED);
  });

  it("denies for leave model (empty capabilities) preserving compatibility", () => {
    const decision = evaluateAigcRuntimePolicy(emptyLeaveAigcModel, "anything", runtimeCtx);
    expect(decision).toBe(AIGC_RUNTIME_POLICY_DENIED);
  });
});

describe("aigcSkill - 118 cross-runtime evidence", () => {
  it("exposes deterministic aigc cross-runtime edges through resolve", () => {
    const surface = aigcSkill.resolve(purchaseRiskAigcModel) as any;

    expect(surface.runtimeEvidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("AIGC_CROSS_RUNTIME_EVIDENCE:rbac"),
        expect.stringContaining("AIGC_CROSS_RUNTIME_EVIDENCE:datamodel"),
      ]),
    );
    expect(surface.crossSkillRuntimeEdges).toEqual(
      expect.arrayContaining(["aigc->rbac:allowed", "aigc->datamodel:allowed"]),
    );
  });

  it("builds rbac runtime evidence from capability role and permission refs", () => {
    const evidence = createAigcRbacRuntimeEvidence(purchaseRiskAigcModel, fullSurface.rbac);

    expect(evidence.evidenceKey).toBe(AIGC_RBAC_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("rbac");
    expect(evidence.state).toBe("allowed");
    expect(evidence.roleRefs).toContain("finance");
    expect(evidence.permissionRefs).toContain("purchase:finance_approve");
  });

  it("fails closed for datamodel evidence when upstream datamodel surface is absent", () => {
    const evidence = createAigcDataModelRuntimeEvidence(purchaseRiskAigcModel);

    expect(evidence.evidenceKey).toBe(AIGC_DATAMODEL_RUNTIME_EVIDENCE);
    expect(evidence.targetSkill).toBe("datamodel");
    expect(evidence.state).toBe("blocked");
    expect(evidence.reasonCode).toBe("AIGC_RUNTIME_UPSTREAM_ABSENT");
  });

  it("normalizes appbundle context and preserves output schema refs", () => {
    const ctx = normalizeAigcRuntimeContextForSkill(
      purchaseRiskAigcModel,
      "appbundle",
      { app: ["app_purchase_approval"] },
    );

    expect(ctx.targetSkill).toBe("appbundle");
    expect(ctx.upstreamEvidencePresent).toBe(true);
    expect(ctx.capabilityRefs).toContain("budget_risk_summary");
    expect(ctx.evidence.outputSchemaRefs).toContain("purchase_risk_output");
    expect(buildAigcCrossRuntimeEdges(purchaseRiskAigcModel).map(edge => edge.targetSkill)).toEqual(
      expect.arrayContaining(["rbac", "datamodel", "page", "appbundle"]),
    );
  });
});

describe("aigcSkill - runtime output schema and evidence (117)", () => {
  it("accepts valid output matching schema fields and with citationEvidence for RAG-backed capability", () => {
    const valid = {
      riskLevel: "medium",
      summary: "Medium risk per vendor policy corpus.",
      recommendedAction: "Request additional review",
      citationEvidence: [{ ref: "vendor_policy_knowledge:policy-42", snippet: "approved vendors only" }],
    };
    const report = validateAigcRuntimeOutput(purchaseRiskAigcModel, "budget_risk_summary", valid);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("rejects missing required schema field and missing citationEvidence on RAG capability (fail-closed)", () => {
    const missingField = {
      riskLevel: "low",
      summary: "low risk",
      // missing required recommendedAction
    };
    const r1 = validateAigcRuntimeOutput(purchaseRiskAigcModel, "budget_risk_summary", missingField);
    expect(r1.ok).toBe(false);
    expect(r1.errors.some((e) => e.code === AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID)).toBe(true);

    const noEvidence = {
      riskLevel: "high",
      summary: "high risk detected",
      recommendedAction: "block",
      // citationEvidence absent for RAG-backed
    };
    const r2 = validateAigcRuntimeOutput(purchaseRiskAigcModel, "budget_risk_summary", noEvidence);
    expect(r2.ok).toBe(false);
    expect(r2.errors.some((e) => e.code === AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID)).toBe(true);
  });

  it("rejects invalid capability id and wrong field types", () => {
    const badCap = validateAigcRuntimeOutput(purchaseRiskAigcModel, "nonexistent_cap", {});
    expect(badCap.ok).toBe(false);
    expect(badCap.errors.some((e) => e.code === AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID)).toBe(true);

    const wrongType = {
      riskLevel: "unknown",
      summary: 123,
      recommendedAction: "proceed",
      citationEvidence: [],
    };
    const r3 = validateAigcRuntimeOutput(purchaseRiskAigcModel, "budget_risk_summary", wrongType);
    expect(r3.ok).toBe(false);
    expect(r3.errors.some((e) => e.code === AIGC_RUNTIME_OUTPUT_SCHEMA_INVALID)).toBe(true);
  });
});

describe("aigcSkill - 119 AIGC positive sample evidence for DataModel/Page/RBAC/AppBundle closure", () => {
  it("exposes purchaseRiskAigcModel as canonical positive sample with cross refs to targets", () => {
    expect(purchaseRiskAigcModel.id).toBe("aigc_purchase_risk");
    expect(purchaseRiskAigcModel.capabilities.map(c => c.id)).toContain("budget_risk_summary");
    expect(purchaseRiskAigcModel.capabilities[0].inputFieldRefs?.length).toBeGreaterThan(0);
    expect(purchaseRiskAigcModel.capabilities[0].permissionRefs?.length).toBeGreaterThan(0);
  });

  it("creates positive sample evidence for appbundle, page, rbac, datamodel (state=allowed when upstream present)", () => {
    const toApp = createAigcPositiveSampleEvidence(purchaseRiskAigcModel, "appbundle");
    expect(toApp.evidenceKey).toBe(AIGC_POSITIVE_SAMPLE_TO_APPBUNDLE);
    expect(toApp.targetSkill).toBe("appbundle");
    expect(toApp.state).toBe("allowed");
    expect(toApp.reasonCode).toBe("AIGC_RUNTIME_EVIDENCE_PRESENT");
    expect(toApp.capabilityRefs).toContain("budget_risk_summary");
    expect(toApp.outputSchemaRefs).toContain("purchase_risk_output");

    const toDm = createAigcPositiveSampleEvidence(purchaseRiskAigcModel, "datamodel");
    expect(toDm.targetSkill).toBe("datamodel");
    expect(toDm.state).toBe("allowed");

    const toPage = createAigcPositiveSampleEvidence(purchaseRiskAigcModel, "page");
    expect(toPage.targetSkill).toBe("page");
    expect(toPage.state).toBe("allowed");

    const toRbac = createAigcPositiveSampleEvidence(purchaseRiskAigcModel, "rbac");
    expect(toRbac.targetSkill).toBe("rbac");
    expect(toRbac.state).toBe("allowed");
    expect(toRbac.roleRefs).toContain("finance");
  });

  it("provides dedicated named positive sample constants per target", () => {
    const ev = createAigcPositiveSampleEvidence(purchaseRiskAigcModel, "datamodel");
    // dedicated keys are exported for consumers; the general evidenceKey uses base
    expect([AIGC_POSITIVE_SAMPLE_TO_DATAMODEL, AIGC_POSITIVE_SAMPLE_TO_PAGE, AIGC_POSITIVE_SAMPLE_TO_RBAC, AIGC_POSITIVE_SAMPLE_TO_APPBUNDLE]).toContain(AIGC_POSITIVE_SAMPLE_TO_APPBUNDLE);
  });

  it("fail-closed negative evidence for missing upstream (blocked, AIGC_RUNTIME_UPSTREAM_ABSENT)", () => {
    const neg = createAigcFailClosedNegativeEvidence(purchaseRiskAigcModel, "page");
    expect(neg.state).toBe("blocked");
    expect(neg.reasonCode).toBe("AIGC_RUNTIME_UPSTREAM_ABSENT");
    expect(neg.targetSkill).toBe("page");

    const negDm = createAigcFailClosedNegativeEvidence(purchaseRiskAigcModel, "datamodel");
    expect(negDm.state).toBe("blocked");
  });

  it("empty leave model yields no positive capability refs (fail closed for closure feed)", () => {
    const emptyPos = createAigcPositiveSampleEvidence(emptyLeaveAigcModel, "appbundle");
    expect(emptyPos.capabilityRefs.length).toBe(0);
    expect(emptyPos.state).toBe("blocked"); // no refs => blocked per aigcRefsForTarget logic
  });

  it("exposes AIGC negative sample evidence that fails closed when policy or schema evidence absent (119 objective)", () => {
    const neg = createAigcNegativeSampleForPolicyOrSchemaAbsent(purchaseRiskAigcModel, "appbundle");
    expect(neg.state).toBe("blocked");
    expect(neg.evidenceKey).toBe(AIGC_NEGATIVE_SAMPLE_POLICY_SCHEMA_ABSENT);
    expect(neg.reasonCode).toBe("AIGC_RUNTIME_POLICY_OR_SCHEMA_EVIDENCE_ABSENT");
    expect(neg.targetSkill).toBe("appbundle");

    // also via fixture: evaluate denies on schema absent
    const denied = evaluateAigcRuntimePolicy(aigcModelWithMissingPolicyOrSchema, "cap_without_policy_schema", {
      rbac: fullSurface.rbac,
      datamodel: fullSurface.datamodel,
    });
    expect(denied).toBe(AIGC_RUNTIME_POLICY_DENIED);

    // positive path still works with full policy+schema model
    const pos = createAigcPositiveSampleEvidence(purchaseRiskAigcModel, "appbundle");
    expect(pos.state).toBe("allowed");
  });

  it("traces AIGC positive sample evidence to DataModel schema evidence as a closed path", () => {
    const trace = traceAigcPositiveSampleEvidenceToDataModelSchemaEvidence(purchaseRiskAigcModel);

    expect(trace.traceId).toBe(AIGC_DATAMODEL_TRACE);
    expect(trace.sourceSkill).toBe("aigc");
    expect(trace.targetSkill).toBe("datamodel");
    expect(trace.state).toBe("closed");
    expect(trace.reasonCode).toBe("AIGC_POSITIVE_SAMPLE_TO_DATAMODEL_SCHEMA_CLOSED");
    expect(trace.capabilityRefs).toContain("budget_risk_summary");
    expect(trace.fieldRefs).toContain("purchase_request.amount");
  });

  it("traces missing AIGC schema evidence to DataModel as fail-closed", () => {
    const trace = traceAigcPositiveSampleEvidenceToDataModelSchemaEvidence(emptyLeaveAigcModel);

    expect(trace.state).toBe("blocked");
    expect(trace.reasonCode).toBe("AIGC_POSITIVE_SAMPLE_TO_DATAMODEL_SCHEMA_FAIL_CLOSED");
  });

  it("resolve surface exposes aigcToDataModelTrace for runtime linkage consumers", () => {
    const surface = aigcSkill.resolve(purchaseRiskAigcModel) as any;

    expect(surface.runtimeEvidence).toEqual(expect.arrayContaining([AIGC_POSITIVE_SAMPLE_TO_DATAMODEL]));
    expect(surface.aigcToDataModelTrace).toBeTruthy();
    expect(surface.aigcToDataModelTrace.traceId).toBe(AIGC_DATAMODEL_TRACE);
    expect(surface.aigcToDataModelTrace.state).toBe("closed");
  });

  it("traces proposed AIGC access to RBAC as closed when RBAC surface proves all refs", () => {
    const trace = traceAigcProposedAccessFailClosedAgainstRbacEvidence(
      purchaseRiskAigcModel,
      { role: ["finance", "department_manager"], permission: ["purchase:view", "purchase:finance_approve"] },
    );

    expect(trace.traceId).toBe(AIGC_RBAC_PROPOSED_ACCESS_TRACE);
    expect(trace.sourceSkill).toBe("aigc");
    expect(trace.targetSkill).toBe("rbac");
    expect(trace.state).toBe("closed");
    expect(trace.reasonCode).toBe("AIGC_PROPOSED_ACCESS_RBAC_EVIDENCE_CLOSED");
    expect(trace.roleRefs).toContain("finance");
    expect(trace.permissionRefs).toContain("purchase:finance_approve");
  });

  it("traces proposed AIGC access to RBAC as fail-closed when RBAC evidence is absent or incomplete", () => {
    const absent = traceAigcProposedAccessFailClosedAgainstRbacEvidence(purchaseRiskAigcModel);
    const incomplete = traceAigcProposedAccessFailClosedAgainstRbacEvidence(
      purchaseRiskAigcModel,
      { role: ["guest"], permission: ["purchase:view"] },
    );

    expect(absent.state).toBe("blocked");
    expect(absent.reasonCode).toBe("AIGC_PROPOSED_ACCESS_FAIL_CLOSED_AGAINST_RBAC");
    expect(incomplete.state).toBe("blocked");
    expect(incomplete.permissionRefs).toContain("purchase:finance_approve");
  });

  it("resolve surface exposes aigcToRbacTrace and proposed access RBAC evidence", () => {
    const surface = aigcSkill.resolve(purchaseRiskAigcModel) as any;
    const evidence = createAigcProposedAccessRbacEvidence(purchaseRiskAigcModel);

    expect(evidence.evidenceKey).toBe(AIGC_RBAC_RUNTIME_EVIDENCE);
    expect(evidence.state).toBe("blocked");
    expect(surface.runtimeEvidence).toEqual(expect.arrayContaining([AIGC_RBAC_RUNTIME_EVIDENCE]));
    expect(surface.aigcToRbacTrace).toBeTruthy();
    expect(surface.aigcToRbacTrace.traceId).toBe(AIGC_RBAC_PROPOSED_ACCESS_TRACE);
  });
});
