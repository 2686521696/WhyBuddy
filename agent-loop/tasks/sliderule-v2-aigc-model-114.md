# SlideRule V2 AIGC 114.01: base metamodel

## Execution status
- Status: PENDING
- Goal: create the runtime-less AIGC-Skill base model so AIGC can join the Skill graph as a PEP execution point.
- Required gate: `slideruleV2AigcModel114Gates`

## Context
AIGC must not become a new PDP, SSOT, or assembly root. It is a PEP execution point that owns AI capability definitions and delegates authorization to RBAC while binding business fields to DataModel.

## Allowed files
- `client/src/lib/skills/aigc/aigcModel.ts`
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/aigc/aigcSkill.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-model-114.md`

## Do not
- Do not register AIGC in `slideRule.ts` yet.
- Do not modify AppBundle in this task.
- Do not add real provider keys or raw secrets.
- Do not stage unrelated WIP.

## Implementation steps
- [ ] Create `client/src/lib/skills/aigc/aigcModel.ts`.
- [ ] Define `AigcCapabilityKind` with summary, classification, extraction, recommendation, and tool_orchestration.
- [ ] Define `AigcCapability` with `id`, `name`, `kind`, `flowRef`, `providerRef`, `promptRef`, `outputSchemaRef`, `inputFieldRefs`, `outputFieldRefs`, `allowedRoleRefs`, `permissionRefs`, and `traceSpan`.
- [ ] Define `ModelProviderRef`, `PromptTemplate`, `OutputSchema`, `KnowledgeSource`, `RetrievalPolicy`, `CitationPolicy`, `ToolSkillConfig`, `ToolPolicy`, and `AigcModel`.
- [ ] Create `client/src/lib/skills/aigc/aigcSkill.ts` with a deterministic `purchaseRiskAigcModel` sample but no real LLM/provider runtime.
- [ ] Add tests that prove the purchase risk summary model contains finance/department_manager role refs and purchase_request field refs.

## Required validation
- `$p='client/src/lib/skills/aigc/aigcModel.ts'; foreach($m in 'AigcCapability','ModelProviderRef','PromptTemplate','OutputSchema','KnowledgeSource','ToolSkillConfig','AigcModel'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/aigc/aigcModel.ts client/src/lib/skills/aigc/aigcSkill.ts client/src/lib/skills/aigc/aigcSkill.test.ts`

## Acceptance criteria
- AIGC has a pure data model and deterministic sample.
- No runtime provider, database, Redis, or real LLM code is introduced.
- Tests fail before implementation and pass after implementation.

