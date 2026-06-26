# SlideRule V2 AIGC 114.07: SSOT DataModel binding gate

## Execution status
- Status: PENDING
- Goal: enforce DataModel SSOT binding for all AIGC input and output field refs.
- Required gate: `slideruleV2AigcSsotBindingGate114Gates`

## Context
AIGC may read business fields and produce structured outputs, but those fields must come from DataModel SSOT. The AIGC Skill must reject missing or removed fields and warn on deprecated fields.

## Allowed files
- `client/src/lib/skills/aigc/aigcModel.ts`
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/aigc/aigcSkill.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-ssot-binding-gate-114.md`

## Do not
- Do not make AIGC define business fields locally.
- Do not modify DataModel unless a tiny resolve metadata fix is required.
- Do not silently accept missing DataModel surfaces.

## Implementation steps
- [ ] Validate `inputFieldRefs` against `ctx.external.datamodel.field`.
- [ ] Validate `outputFieldRefs` and output schema writeback refs against `ctx.external.datamodel.field`.
- [ ] Use DataModel metadata surface when available to detect `deprecated` and `removed` lifecycle.
- [ ] Add findings `AIGC_FIELD_UNRESOLVED`, `AIGC_INPUT_FIELD_MISSING`, `AIGC_OUTPUT_FIELD_MISSING`, `AIGC_FIELD_DEPRECATED`, and `AIGC_FIELD_REMOVED`.
- [ ] Add tests using `dataModelSkill.resolve(purchaseApprovalDataModel)`.

## Required validation
- `$p='client/src/lib/skills/aigc/aigcSkill.ts'; foreach($m in 'AIGC_INPUT_FIELD_MISSING','AIGC_OUTPUT_FIELD_MISSING','AIGC_FIELD_DEPRECATED','AIGC_FIELD_REMOVED'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/aigc/aigcSkill.ts client/src/lib/skills/aigc/aigcSkill.test.ts`

## Acceptance criteria
- AIGC field refs bind to DataModel SSOT.
- Removed fields fail; deprecated fields warn.
- Existing DataModel tests stay green.

