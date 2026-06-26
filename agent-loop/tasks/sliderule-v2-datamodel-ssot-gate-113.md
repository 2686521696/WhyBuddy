# SlideRule V2 Skills 113.06: DataModel SSOT gate

## Execution status
- Status: DONE_REVIEWED - committed 6eba157b
- Goal: implement SSOT validation so field identity, lifecycle, version, and OLAP misuse are objectively checked before downstream Skills bind to data facts.
- Required gate: `slideruleV2DataModelSsotGate113Gates`

## Context
If Workflow or Page references a field, DataModel must be able to say whether that field exists, which version is current, and whether it is safe to bind.

## Allowed files
- `client/src/lib/skills/datamodel/dataModelSkill.ts`
- `client/src/lib/skills/datamodel/dataModelSkill.test.ts`
- `client/src/lib/skills/datamodel/dataModelModel.ts` only for additive corrections from task 113.05
- `agent-loop/tasks/sliderule-v2-datamodel-ssot-gate-113.md`
- `This task file`

## Do not
- Do not make deprecated fields hard errors unless a downstream task explicitly requires it.
- Do not allow removed fields to pass.
- Do not let OLAP projection fields satisfy SSOT bindings.
- Do not modify Page/Workflow binding behavior yet.

## Implementation steps
- [ ] Add tests for duplicate field IDs and duplicate entity-field pairs.
- [ ] Add tests for version mismatch expecting `DM_FIELD_VERSION_MISMATCH`.
- [ ] Add tests for deprecated fields expecting warning code `DM_FIELD_DEPRECATED`.
- [ ] Add tests for removed fields expecting error code `DM_FIELD_REMOVED`.
- [ ] Add tests for OLAP projection misuse expecting `DM_OLAP_NOT_SSOT`.
- [ ] Implement SSOT validation in `validate()`.
- [ ] Preserve existing entity relation and missing-ref checks.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/datamodel/dataModelSkill.ts client/src/lib/skills/datamodel/dataModelSkill.test.ts`

## Acceptance criteria
- Active SSOT field refs pass.
- Deprecated refs warn.
- Removed refs fail.
- OLAP projection fields cannot impersonate SSOT.

