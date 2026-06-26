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

## V2 Kernel Vocabulary (shared contract)

The five Skills behave as a lightweight product kernel (no DB, no HTTP, no runtime services):

- **PDP** (Policy Decision Point): RBAC is Kernel 1. It is the single host for policy decisions. Other skills delegate decisions here (fail-closed posture).
- **PEP** (Policy Enforcement Point): Workflow and Page are execution points. They delegate policy checks to the PDP and bind data references to the SSOT.
- **SSOT** (Single Source of Truth): DataModel is Kernel 2. All entity/field/relation definitions live here; other skills reference it for referential integrity.
- **AppBundle**: Kernel 6, the assembly root. It checks cross-skill closure (publish gate) and pins versions for reproducible snapshots.
- **publish gate**: The top-level gate (owned by AppBundle semantics) that passes only when every skill's validate succeeds AND all cross-skill references resolve (no dangling refs).
- **impact graph**: Reverse dependency traversal. Changing a resource (e.g. an RBAC role) reports every downstream artifact (workflow nodes, pages) that would break, across skill boundaries.

All V2 declarations live in one place (`skill.ts`): `KernelRole`, `SkillRuntimeRole`, `DependencyRef`, `VersionPin`, `PolicyDecision`, `PublishGateReport`, `ImpactReport`, `SkillCapabilitySurface`, and `SkillDefinition` (with optional V2 metadata block). Individual skills import and declare using these. The contract accepts both compact labels (`pdp`, `ssot`, `skill/value`) and V2 diagram labels (`pdp-host`, `ssot-host`, `to/ref`) so existing tasks and future diagram-driven tasks can share the same surface.
