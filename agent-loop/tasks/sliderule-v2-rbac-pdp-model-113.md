# SlideRule V2 Skills 113.02: RBAC PDP model

## Execution status
- Status: DONE_REVIEWED - committed 0f1aa2a4
- Goal: upgrade the RBAC Skill model so it represents the V2 PDP host, including role inheritance, SoD rules, and fail-closed policy posture.
- Required gate: `slideruleV2RbacPdpModel113Gates`

## Context
RBAC is no longer just a static role-permission graph. In V2 it is Kernel 1, the policy decision point. Other Skills must ask it for decisions instead of making local permission decisions.

## Allowed files
- `client/src/lib/skills/rbac/rbacModel.ts`
- `client/src/lib/skills/rbac/rbacSkill.test.ts`
- `client/src/lib/skills/skill.ts` only if the shared contract from task 113.01 needs an additive type fix
- `agent-loop/tasks/sliderule-v2-rbac-pdp-model-113.md`
- `This task file`

## Do not
- Do not change Workflow, Page, DataModel, or AppBundle implementation in this task.
- Do not add a real auth runtime, database lookup, or user session dependency.
- Do not remove the existing leave-approval sample.
- Do not make permission failures permissive by default.

## Implementation steps
- [ ] Extend the RBAC model with role inheritance, for example `inheritsRoleIds?: string[]`.
- [ ] Add SoD model fields for separation-of-duty rules, for example `sodRules: { id; name; exclusiveRoleIds; severity }[]`.
- [ ] Add a policy posture field such as `decisionMode: "fail-closed"` or `failClosed: true`.
- [ ] Add a typed policy request/context shape: subject role refs, action, resource type, resource id, and optional tenant/scope.
- [ ] Update the sample RBAC model so it still represents the leave approval case and explicitly declares fail-closed.
- [ ] Add failing tests first for inheritance metadata, SoD metadata, and fail-closed defaults; then make the model compile and pass.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/rbac/rbacSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/rbac/rbacModel.ts client/src/lib/skills/rbac/rbacSkill.test.ts`

## Acceptance criteria
- RBAC model can express inheritance, SoD, policy context, and fail-closed mode.
- Existing RBAC sample remains valid.
- No other Skill behavior changes in this task.

