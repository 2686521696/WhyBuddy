# SlideRule V2 AIGC 114.10: AppBundle AIGC pins and publish gate

## Execution status
- Status: PENDING
- Goal: let AppBundle assemble AIGC capabilities with version pins and publish gate checks.
- Required gate: `slideruleV2AppbundleAigcPinsPublish114Gates`

## Context
AppBundle is the assembly root. Once AIGC enters the Skill graph, AppBundle must be able to reference AIGC capabilities and require pinned versions for flow, prompt, provider/model policy, output schema, and tool config.

## Allowed files
- `client/src/lib/skills/appbundle/appBundleModel.ts`
- `client/src/lib/skills/appbundle/appBundleSkill.ts`
- `client/src/lib/skills/appbundle/appBundleSkill.test.ts`
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/orchestrator.test.ts`
- `agent-loop/tasks/sliderule-v2-appbundle-aigc-pins-publish-114.md`

## Do not
- Do not remove existing DataModel/RBAC/Workflow/Page bundle behavior.
- Do not make AppBundle execute AIGC runtime.
- Do not allow AIGC refs without version pins.

## Implementation steps
- [ ] Add `aigcCapabilityRefs` or equivalent to `AppBundleModel`.
- [ ] Add AppBundle crossRefs to `aigc.capability`.
- [ ] Extend version pin requirements for AIGC capability refs.
- [ ] Add publish blockers `APPBUNDLE_AIGC_UNRESOLVED` and reuse `APPBUNDLE_VERSION_UNPINNED` for unpinned AIGC refs.
- [ ] Update runtime snapshot samples to include pinned AIGC refs where appropriate.
- [ ] Add tests for valid AIGC bundle, ghost AIGC ref, and missing AIGC version pin.

## Required validation
- `$p='client/src/lib/skills/appbundle/appBundleSkill.ts'; foreach($m in 'aigc','APPBUNDLE_AIGC_UNRESOLVED','APPBUNDLE_VERSION_UNPINNED'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/appbundle/appBundleModel.ts client/src/lib/skills/appbundle/appBundleSkill.ts client/src/lib/skills/appbundle/appBundleSkill.test.ts`

## Acceptance criteria
- AppBundle can assemble AIGC capability refs.
- AIGC refs must be pinned before publish.
- Existing AppBundle publish gate behavior remains green.

