# SlideRule V2 Skills 113.07: DataModel SSOT project and resolve surface

## Execution status
- Status: DONE_REVIEWED - committed f44a8fb8
- Goal: expose DataModel as field-level SSOT so downstream Skills can resolve entity and field references, and diagrams can show real field nodes instead of coarse entity-only links.
- Required gate: `slideruleV2DataModelSsotProjectResolve113Gates`

## Context
V2 needs Page and Workflow to bind exact fields. `resolve()` should therefore expose field-level refs with version and lifecycle metadata, and `project()` should make SSOT fields visible.

## Allowed files
- `client/src/lib/skills/datamodel/dataModelSkill.ts`
- `client/src/lib/skills/datamodel/dataModelSkill.test.ts`
- `client/src/lib/skills/orchestrator.test.ts` only for cross-Skill diagram assertions
- `agent-loop/tasks/sliderule-v2-datamodel-ssot-project-resolve-113.md`
- `This task file`

## Do not
- Do not change RBAC data-rule semantics beyond consuming the improved resolver if needed.
- Do not hardcode field nodes in tests without deriving them from the model.
- Do not remove entity-level refs; keep them for coarse consumers.

## Implementation steps
- [ ] Add tests that `resolve()` exposes `entity` and `field` surfaces.
- [ ] Add tests that `refNodeId("field", "leave_request.approved@v1")` or equivalent maps to a field node.
- [ ] Add tests that resolver metadata includes lifecycle and version.
- [ ] Update `project()` so SSOT entities and fields are distinct but readable.
- [ ] Update cross-Skill diagram tests so RBAC data rules can point to a real SSOT entity or field node.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/datamodel/dataModelSkill.ts client/src/lib/skills/datamodel/dataModelSkill.test.ts client/src/lib/skills/orchestrator.test.ts`

## Acceptance criteria
- DataModel resolver supports field-level cross-Skill refs.
- Diagrams show SSOT field facts clearly.
- Existing entity-level consumers still work.

