# SlideRule V2 Skills 113.04: RBAC PDP project and resolve surface

## Execution status
- Status: DONE_REVIEWED - committed 40b823f6
- Goal: make RBAC project and resolve expose PDP semantics so other Skills can delegate permission decisions and diagrams can show inbound PDP delegation.
- Required gate: `slideruleV2RbacPdpProjectResolve113Gates`

## Context
The V2 diagrams make RBAC the PDP host. The runtime-less Skill must reflect that: `resolve()` should expose roles, permissions, policies, and decision surfaces; `project()` should make PDP, inheritance, SoD, and fail-closed visible.

## Allowed files
- `client/src/lib/skills/rbac/rbacSkill.ts`
- `client/src/lib/skills/rbac/rbacSkill.test.ts`
- `client/src/lib/skills/orchestrator.test.ts` only for cross-Skill projection assertions
- `agent-loop/tasks/sliderule-v2-rbac-pdp-project-resolve-113.md`
- `This task file`

## Do not
- Do not change DataModel/Workflow/Page/AppBundle models in this task.
- Do not hardcode diagram nodes that are not derived from model data.
- Do not remove existing RBAC role, menu, permission, data-rule projection.

## Implementation steps
- [ ] Add tests that `resolve()` exposes `role`, `permission`, `policy`, and `decision` surfaces.
- [ ] Add tests that `refNodeId("role", "manager")` maps to the real role node.
- [ ] Add tests that `project()` contains PDP host, fail-closed, inheritance, and SoD nodes when the model declares them.
- [ ] Implement the resolver surface for PDP consumers.
- [ ] Update the projector so inbound delegation is represented as a typed reference surface, not a fake external line.
- [ ] Ensure old diagrams still include roles, menus, permissions, and data rules.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/rbac/rbacSkill.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/rbac/rbacSkill.ts client/src/lib/skills/rbac/rbacSkill.test.ts client/src/lib/skills/orchestrator.test.ts`

## Acceptance criteria
- RBAC can be consumed as the authoritative PDP surface by downstream Skills.
- Generated diagrams show RBAC as PDP host rather than a passive role table.
- Cross-Skill references still resolve deterministically.

