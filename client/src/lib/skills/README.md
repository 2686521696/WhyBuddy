# SlideRule Runtime-Less Skills

This directory contains the first runtime-less Slice of the SlideRule V5.2 skill architecture.

The goal is to distill heavy application-platform subsystems into pure metamodel skills:

- `datamodel`: entity, field, and relation modeling.
- `rbac`: roles, permissions, menus, users, departments, positions, and data rules.
- `workflow`: start, approval, branch, and end flow semantics.
- `page`: page components, DataModel field binding, RBAC visibility, and linkage rules.
- `orchestrator`: generic dependency-threading, validation aggregation, unified SPEC, and combined relation diagram generation.

Each skill exposes the same shape:

- `generate(intent, ctx)`: produces a model instance. This is currently sample-backed and is the future LLM seam.
- `validate(model, ctx)`: pure consistency gate. This is the objective guardrail.
- `project(model)`: pure model-to-graph projection.
- `resolve(model)`: the cross-skill reference surface.
- `crossRefs(model)`: outgoing references used by the orchestrator to stitch relation diagrams.

Current verified slice:

- Intent: `我要一个请假审批平台`.
- Skills: DataModel -> RBAC -> Workflow -> Page.
- Cross-skill gates:
  - RBAC data rules resolve against DataModel entities.
  - Workflow approval assignees resolve against RBAC roles.
  - Page component fields resolve against DataModel fields.
  - Page component visibility resolves against RBAC roles.
- Output:
  - Unified application SPEC.
  - Aggregate gate report.
  - Combined Mermaid relation diagram.

Not included yet:

- AppBundle-Skill.
- Real LLM-backed generation.
- Materialization into the heavy low-code platform or AgentLoop-generated code.
