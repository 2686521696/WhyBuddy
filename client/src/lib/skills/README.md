# SlideRule Runtime-Less Skills

This directory contains the first runtime-less Slice of the SlideRule V5.2 skill architecture.

The goal is to distill heavy application-platform subsystems into pure metamodel skills:

- `datamodel`: entity, field, and relation modeling.
- `rbac`: roles, permissions, menus, users, departments, positions, and data rules.
- `workflow`: start, approval, branch, and end flow semantics.
- `page`: page components, DataModel field binding, RBAC visibility, and linkage rules.
- `appbundle`: application-center packaging across entities, roles, workflows, pages, menus, and page-workflow bindings.
- `orchestrator`: generic dependency-threading, validation aggregation, unified SPEC, and combined relation diagram generation.

Each skill exposes the same shape:

- `generate(intent, ctx)`: produces a model instance. This is currently sample-backed and is the future LLM seam.
- `validate(model, ctx)`: pure consistency gate. This is the objective guardrail.
- `project(model)`: pure model-to-graph projection.
- `resolve(model)`: the cross-skill reference surface.
- `crossRefs(model)`: outgoing references used by the orchestrator to stitch relation diagrams.

Current verified slice:

- Intent: `我要一个请假审批平台`.
- Skills: DataModel -> RBAC -> Workflow -> Page -> AppBundle.
- Cross-skill gates:
  - RBAC data rules resolve against DataModel entities.
  - Workflow approval assignees resolve against RBAC roles.
  - Page component fields resolve against DataModel fields.
  - Page component visibility resolves against RBAC roles.
  - AppBundle packaging resolves against DataModel, RBAC, Workflow, and Page refs.
- Output:
  - Unified application SPEC.
  - Aggregate gate report.
  - Combined Mermaid relation diagram.

Not included yet:

- Real LLM-backed generation.
- Materialization into the heavy low-code platform or AgentLoop-generated code.

## V2 Kernel Vocabulary (short glossary)

- **PDP (Policy Decision Point)**: RBAC acts as Kernel 1, the central host for policy decisions.
- **PEP (Policy Enforcement Point)**: Workflow and Page are execution points that delegate to PDP and bind to SSOT.
- **SSOT (Single Source of Truth)**: DataModel is Kernel 2, the authoritative host for entities, fields, and relations.
- **AppBundle**: Kernel 6, the assembly root that checks cross-skill closure and pins versions.
- **publish gate**: The orchestrator gate that aggregates skill validations and dangling cross-refs to decide publishability.
- **impact graph**: The derived projection showing how a change in one skill affects others (via resolve + project surfaces).
