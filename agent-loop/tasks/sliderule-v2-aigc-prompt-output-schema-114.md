# SlideRule V2 AIGC 114.03: prompt templates and output schemas

## Execution status
- Status: PENDING
- Goal: add PromptTemplate and OutputSchema gates so AI outputs are structured and versioned.
- Required gate: `slideruleV2AigcPromptOutputSchema114Gates`

## Context
The AIGC V2 diagram requires prompt versions and structured output schemas. The Skill layer should be able to reject missing prompt refs, missing output schema refs, and malformed schema fields without running a model.

## Allowed files
- `client/src/lib/skills/aigc/aigcModel.ts`
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/aigc/aigcSkill.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-prompt-output-schema-114.md`

## Do not
- Do not implement prompt rendering runtime.
- Do not add real LLM calls.
- Do not modify AppBundle.

## Implementation steps
- [ ] Ensure `PromptTemplate` carries `id`, `version`, `template`, and optional `variables`.
- [ ] Ensure `OutputSchema` carries `id`, `version`, and typed fields.
- [ ] Add validator findings `AIGC_PROMPT_MISSING`, `AIGC_PROMPT_VERSION_MISSING`, `AIGC_OUTPUT_SCHEMA_MISSING`, and `AIGC_OUTPUT_SCHEMA_INVALID`.
- [ ] Add a purchase risk output schema with `riskLevel`, `summary`, and `recommendedAction`.
- [ ] Add tests for valid prompt/output schema and invalid/missing refs.

## Required validation
- `$p='client/src/lib/skills/aigc/aigcSkill.ts'; foreach($m in 'AIGC_PROMPT_MISSING','AIGC_PROMPT_VERSION_MISSING','AIGC_OUTPUT_SCHEMA_MISSING','AIGC_OUTPUT_SCHEMA_INVALID'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/aigc/aigcModel.ts client/src/lib/skills/aigc/aigcSkill.ts client/src/lib/skills/aigc/aigcSkill.test.ts`

## Acceptance criteria
- AIGC capabilities cannot reference missing prompts or output schemas.
- Output schema fields are typed and validated.
- The purchase risk summary has a deterministic output schema.

