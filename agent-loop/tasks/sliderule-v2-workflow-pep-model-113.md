# SlideRule V2 Skills 113.08: Workflow PEP model

## Execution status
- Status: DONE_REVIEWED - committed b5e4b641
- Goal: upgrade Workflow model into a V2 PEP execution point that delegates actor/permission decisions to RBAC PDP and binds form/branch fields to DataModel SSOT.
- Required gate: `slideruleV2WorkflowPepModel113Gates`

## Context
Workflow should keep execution semantics such as reachability and termination, but it must not own authorization or data-field truth. In V2 it executes process logic and delegates kernel decisions.

## Allowed files
- `client/src/lib/skills/workflow/workflowModel.ts`
- `client/src/lib/skills/workflow/workflowSkill.test.ts`
- `client/src/lib/skills/workflow/workflowSkill.ts` only for model compile fixes
- `agent-loop/tasks/sliderule-v2-workflow-pep-model-113.md`
- `This task file`

## Do not
- Do not remove existing start/approval/branch/end node behavior.
- Do not add a workflow runtime engine or persistent job store.
- Do not let Workflow define local permissions as authoritative.
- Do not modify Page or AppBundle in this task.

## Implementation steps
- [ ] Add model fields for `actorRoleRef`, `policyCheckRefs`, `fieldRefs`, and optional `traceSpan`.
- [ ] Move or mirror approval assignees into typed RBAC role refs while keeping backward compatibility for the existing sample.
- [ ] Represent branch/form fields as DataModel SSOT refs instead of plain local strings where possible.
- [ ] Update the leave-approval workflow sample to use RBAC role refs and DataModel field refs.
- [ ] Add tests that the model can express PEP delegation without changing reachability behavior.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/workflow/workflowSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/workflow/workflowModel.ts client/src/lib/skills/workflow/workflowSkill.test.ts`

## Acceptance criteria
- Workflow model clearly identifies itself as a PEP.
- Approval actor decisions are modeled as RBAC PDP refs.
- Branch/form field decisions are modeled as DataModel SSOT refs.
- Existing workflow execution semantics tests remain meaningful.

