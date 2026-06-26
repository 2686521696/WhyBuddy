# SlideRule V2 Skills 113.03: RBAC PDP gate and decisions

## Execution status
- Status: DONE_REVIEWED - committed 763039ca
- Goal: implement the RBAC PDP gate so invalid role inheritance, SoD conflicts, and local decision bypasses are caught before downstream Skills can publish.
- Required gate: `slideruleV2RbacPdpGate113Gates`

## Context
The PDP must be objective. If another Skill asks for an authorization decision and RBAC cannot prove it is allowed, the default is deny/fail-closed.

## Allowed files
- `client/src/lib/skills/rbac/rbacSkill.ts`
- `client/src/lib/skills/rbac/rbacSkill.test.ts`
- `client/src/lib/skills/rbac/rbacModel.ts` only for additive model corrections from task 113.02
- `agent-loop/tasks/sliderule-v2-rbac-pdp-gate-113.md`
- `This task file`

## Do not
- Do not return allow decisions when the requested role, permission, or resource is missing.
- Do not couple the PDP to browser state or logged-in users.
- Do not modify Page or Workflow to consume PDP yet; this task is RBAC-local.
- Do not downgrade errors into warnings for SoD or inheritance cycles.

## Implementation steps
- [ ] Add tests that create an inheritance cycle and expect `RBAC_ROLE_INHERITANCE_CYCLE`.
- [ ] Add tests that assign mutually exclusive roles and expect `RBAC_SOD_VIOLATION`.
- [ ] Add tests for missing policy inputs and unknown permission requests, expecting a deny decision and `RBAC_DECISION_FAIL_CLOSED`.
- [ ] Implement inheritance expansion with cycle detection.
- [ ] Implement SoD validation against direct and inherited roles.
- [ ] Add a pure decision helper such as `decideRbacPolicy(model, request)` that returns a typed `PolicyDecision`.
- [ ] Ensure `validate()` includes the new errors and preserves existing missing-reference/menu-cycle checks.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/rbac/rbacSkill.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/rbac/rbacSkill.ts client/src/lib/skills/rbac/rbacSkill.test.ts`

## Acceptance criteria
- RBAC denies unknown or incomplete policy requests by default.
- Inheritance cycles fail validation.
- SoD conflicts fail validation.
- Existing RBAC gate errors still work.

