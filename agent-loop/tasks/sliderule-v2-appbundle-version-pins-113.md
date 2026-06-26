# SlideRule V2 Skills 113.12: AppBundle version pins and runtime snapshot

## Execution status
- Status: pending
- Goal: upgrade AppBundle into Kernel 6 assembly root with version pins, publish manifest, and runtime snapshot semantics.
- Required gate: `slideruleV2AppBundleVersionPins113Gates`

## Context
AppBundle represents the application center. It assembles RBAC, DataModel, Workflow, and Page surfaces into one publishable application. V2 requires publish-time version pins so runtime behavior resolves by snapshot, not by floating latest state.

## Allowed files
- `client/src/lib/skills/appbundle/appBundleModel.ts`
- `client/src/lib/skills/appbundle/appBundleSkill.ts`
- `client/src/lib/skills/appbundle/appBundleSkill.test.ts`
- `agent-loop/tasks/sliderule-v2-appbundle-version-pins-113.md`
- `This task file`

## Do not
- Do not implement closure validation in this task beyond basic version-pin structure.
- Do not introduce real package publishing or file writes.
- Do not add backend routes.
- Do not change RBAC/DataModel/Workflow/Page models unless a shared type compile fix is unavoidable.

## Implementation steps
- [ ] Add `versionPins` for each assembled Skill surface: RBAC, DataModel, Workflow, Page, and AppBundle itself.
- [ ] Add a `publishManifest` model with app id, version, created time placeholder, included refs, and gate status.
- [ ] Add a `runtimeSnapshot` model that points to pinned refs instead of live mutable refs.
- [ ] Update AppBundle sample to pin all included surfaces.
- [ ] Add tests that the sample exposes version pins and snapshot refs without running publish gate yet.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/appbundle/appBundleModel.ts client/src/lib/skills/appbundle/appBundleSkill.ts client/src/lib/skills/appbundle/appBundleSkill.test.ts`

## Acceptance criteria
- AppBundle can represent pinned versions for every assembled Skill.
- Runtime snapshot is explicit and separate from mutable design-time model.
- Existing AppBundle tests remain green.

