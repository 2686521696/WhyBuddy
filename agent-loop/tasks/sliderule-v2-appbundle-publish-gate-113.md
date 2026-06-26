# SlideRule V2 Skills 113.13: AppBundle publish gate

## Execution status
- Status: pending
- Goal: implement AppBundle publish gate so the assembly root validates cross-system closure, version pins, ghost refs, and PEP delegation before an app can be considered publishable.
- Required gate: `slideruleV2AppBundlePublishGate113Gates`

## Context
This is the key V2 product gate. App Center should not publish a generated application if any referenced role, field, workflow, page, or version pin is missing.

## Allowed files
- `client/src/lib/skills/appbundle/appBundleSkill.ts`
- `client/src/lib/skills/appbundle/appBundleSkill.test.ts`
- `client/src/lib/skills/appbundle/appBundleModel.ts`
- `client/src/lib/skills/orchestrator.ts` only if the gate needs existing resolver surfaces passed through
- `client/src/lib/skills/orchestrator.test.ts`
- `agent-loop/tasks/sliderule-v2-appbundle-publish-gate-113.md`
- `This task file`

## Do not
- Do not mark publish green if any warning should be a blocking closure error.
- Do not hide ghost refs in generated diagrams.
- Do not make publish gate call real services.
- Do not bypass individual Skill `validate()` gates.

## Implementation steps
- [ ] Add tests for missing assembled refs expecting `APPBUNDLE_PUBLISH_REF_MISSING`.
- [ ] Add tests for unpinned surfaces expecting `APPBUNDLE_VERSION_UNPINNED`.
- [ ] Add tests for unresolved cross-Skill refs expecting `APPBUNDLE_GHOST_REF`.
- [ ] Add tests for Page/Workflow local auth bypass expecting `APPBUNDLE_PEP_BYPASS`.
- [ ] Implement `publishGate()` or `validatePublishGate()` as a pure function.
- [ ] Make publish gate consume existing resolver surfaces instead of duplicating Skill-specific lookup logic.
- [ ] Project publish status and pinned snapshot in the AppBundle diagram.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/appbundle/appBundleSkill.ts client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/orchestrator.ts client/src/lib/skills/orchestrator.test.ts`

## Acceptance criteria
- Publish gate blocks missing refs, unpinned versions, ghost refs, and PEP bypasses.
- Publish gate is pure and deterministic.
- AppBundle diagram shows assembly root, closure gate, and runtime snapshot.

