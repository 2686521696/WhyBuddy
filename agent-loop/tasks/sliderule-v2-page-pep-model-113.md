# SlideRule V2 Skills 113.10: Page PEP model

## Execution status
- Status: DONE_REVIEWED - committed 365da934
- Goal: upgrade Page model into a V2 PEP execution point with BindingSchema, PermissionRender, component version metadata, and traceable local dependency graph.
- Required gate: `slideruleV2PagePepModel113Gates`

## Context
Page Designer keeps canvas/rendering/local linkage, but it does not own authorization or data truth. It renders based on PDP decisions and binds components to SSOT fields.

## Allowed files
- `client/src/lib/skills/page/pageModel.ts`
- `client/src/lib/skills/page/pageSkill.test.ts`
- `client/src/lib/skills/page/pageSkill.ts` only for model compile fixes
- `agent-loop/tasks/sliderule-v2-page-pep-model-113.md`
- `This task file`

## Do not
- Do not modify AgentLoop settings UI.
- Do not replace the page model with real React component code.
- Do not let `visibleToRoles` remain the only authorization model.
- Do not modify AppBundle in this task.

## Implementation steps
- [ ] Add `BindingSchema` to describe component-to-DataModel entity/field bindings.
- [ ] Add `PermissionRender` to describe component visibility/action enablement as RBAC PDP refs.
- [ ] Add component version and optional `traceSpan` metadata.
- [ ] Preserve backward compatibility by migrating or mapping existing `visibleToRoles` into PDP role refs in the sample.
- [ ] Keep local linkage/dependency rules as Page-owned execution graph, not as global truth.
- [ ] Add tests proving the sample page can express bindings, permission rendering, and linkage rules.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/page/pageSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/page/pageModel.ts client/src/lib/skills/page/pageSkill.test.ts`

## Acceptance criteria
- Page model clearly separates rendering execution from PDP/SSOT authority.
- Component visibility is expressible as RBAC PDP delegation.
- Component data bindings are expressible as DataModel SSOT refs.
- Existing Page sample remains readable.

