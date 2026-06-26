# SlideRule V2 Skills 113.11: Page PEP gate and projection

## Execution status
- Status: pending
- Goal: validate Page PEP delegation and project canvas, bindings, permission rendering, and local linkage into the unified architecture graph.
- Required gate: `slideruleV2PagePepGateProject113Gates`

## Context
Page Designer is where users see product depth. The gate must prove that visible components do not bypass RBAC and that fields shown on the canvas really exist in DataModel.

## Allowed files
- `client/src/lib/skills/page/pageSkill.ts`
- `client/src/lib/skills/page/pageSkill.test.ts`
- `client/src/lib/skills/orchestrator.test.ts`
- `agent-loop/tasks/sliderule-v2-page-pep-gate-project-113.md`
- `This task file`

## Do not
- Do not weaken linkage validation.
- Do not allow missing DataModel fields to render as valid bindings.
- Do not allow local role-only visibility to bypass PDP in V2 mode.
- Do not modify AppBundle publish logic in this task.

## Implementation steps
- [ ] Add tests that a component binding to a missing SSOT field fails with `PAGE_BINDING_FIELD_MISSING`.
- [ ] Add tests that a component permission render referencing a missing RBAC role or permission fails with `PAGE_PERMISSION_REF_MISSING`.
- [ ] Add tests that V2 mode rejects local-only auth with `PAGE_PEP_BYPASS`.
- [ ] Preserve linkage/dependency tests for component source/target closure.
- [ ] Update `project()` to show canvas components, BindingSchema edges to DataModel, PermissionRender edges to RBAC, and local linkage edges.
- [ ] Update orchestrator tests so Page cross-refs resolve to real RBAC/DataModel nodes.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/page/pageSkill.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/page/pageSkill.ts client/src/lib/skills/page/pageSkill.test.ts client/src/lib/skills/orchestrator.test.ts`

## Acceptance criteria
- Page Skill refuses missing SSOT field bindings.
- Page Skill refuses missing PDP permission refs.
- Generated diagrams make Page a PEP, not a kernel host.

