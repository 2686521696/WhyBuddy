# SlideRule V2 Skills 113.05: DataModel SSOT model

## Execution status
- Status: DONE_REVIEWED - committed b11ec2bf
- Goal: upgrade DataModel Skill model so it acts as the V2 SSOT host for entities and fields, with stable field IDs, versions, lifecycle, namespace, and OLAP separation.
- Required gate: `slideruleV2DataModelSsotModel113Gates`

## Context
DataModel is Kernel 2, the single source of truth. Workflow branch fields, Page bindings, and RBAC data rules must bind to DataModel facts instead of inventing local field definitions.

## Allowed files
- `client/src/lib/skills/datamodel/dataModelModel.ts`
- `client/src/lib/skills/datamodel/dataModelSkill.ts`
- `client/src/lib/skills/datamodel/dataModelSkill.test.ts`
- `client/src/lib/skills/skill.ts` only for additive shared type fixes
- `agent-loop/tasks/sliderule-v2-datamodel-ssot-model-113.md`
- `This task file`

## Do not
- Do not add OLAP warehouse as a second SSOT.
- Do not change RBAC/Workflow/Page/AppBundle implementation in this task.
- Do not replace existing entity/field model with backend table DDL.
- Do not introduce a database migration.

## Implementation steps
- [ ] Add stable field identity to field definitions, for example `fieldId`, `version`, and `lifecycle`.
- [ ] Add entity namespace/domain metadata so cross-system refs can distinguish same-named entities.
- [ ] Add lifecycle values: `active`, `deprecated`, `removed`.
- [ ] Add an OLAP split marker, for example `storageRole: "ssot" | "olap_projection"`, with DataModel authoritative fields marked as `ssot`.
- [ ] Update the leave-approval sample so all fields have stable IDs and active lifecycle.
- [ ] Add tests proving the sample exposes stable field IDs without breaking current entity/relationship behavior.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/datamodel/dataModelModel.ts client/src/lib/skills/datamodel/dataModelSkill.ts client/src/lib/skills/datamodel/dataModelSkill.test.ts`

## Acceptance criteria
- DataModel can represent SSOT entities and field-level versioned facts.
- OLAP is represented as a projection role, not a source of truth.
- Existing DataModel sample and tests remain valid.

