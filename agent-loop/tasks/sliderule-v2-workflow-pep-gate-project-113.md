# SlideRule V2 Skills 113.09: Workflow PEP gate and projection

## Execution status
- Status: DONE_REVIEWED - committed 5e533daa
- Goal: enforce Workflow PEP delegation and update projection so workflows show RBAC PDP checks, DataModel SSOT bindings, and existing execution-semantics gates in one diagram.
- Required gate: `slideruleV2WorkflowPepGateProject113Gates`

## Context
Workflow must prove two things: the process can execute, and the process does not bypass RBAC/DataModel kernels.

## Allowed files
- `client/src/lib/skills/workflow/workflowSkill.ts`
- `client/src/lib/skills/workflow/workflowSkill.test.ts`
- `client/src/lib/skills/orchestrator.test.ts`
- `agent-loop/tasks/sliderule-v2-workflow-pep-gate-project-113.md`
- `This task file`

## Do not
- Do not weaken `WF_UNREACHABLE_NODE`, `WF_NON_TERMINATING`, or branch coverage checks.
- Do not silently accept missing RBAC or DataModel external surfaces when refs are declared.
- Do not make Workflow a PDP.
- Do not change RBAC/DataModel implementation unless a compile-only type correction is unavoidable.

## Implementation steps
- [ ] Add tests that a workflow approval node referencing an unknown RBAC role fails with `WF_ASSIGNEE_MISSING_ROLE`.
- [ ] Add tests that a workflow branch/form field referencing a missing DataModel field fails with a Workflow-specific missing SSOT code.
- [ ] Add tests that local auth checks without PDP delegation fail with `WF_PEP_BYPASS`.
- [ ] Preserve tests for unreachable nodes, non-terminating flows, and branch defaults.
- [ ] Update `project()` so approval nodes show delegated PDP role refs and branch/form nodes show SSOT field refs.
- [ ] Update orchestrator tests so Workflow cross-refs resolve through RBAC and DataModel surfaces.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/workflow/workflowSkill.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/workflow/workflowSkill.ts client/src/lib/skills/workflow/workflowSkill.test.ts client/src/lib/skills/orchestrator.test.ts`

## Acceptance criteria
- Workflow remains a PEP and cannot authorize locally.
- Workflow field refs bind to DataModel SSOT.
- Generated diagrams show both process execution and kernel delegation.

