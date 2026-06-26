# SlideRule V2 AIGC 114.08: project, resolve, and crossRefs

## Execution status
- Status: PENDING
- Goal: expose AIGC capability projection, resolve surface, and cross-skill references.
- Required gate: `slideruleV2AigcProjectResolve114Gates`

## Context
The combined Intent-to-App graph must show AIGC capabilities, providers, prompts, RAG sources, tools, output schemas, RBAC refs, and DataModel refs. AIGC must be pluggable into the orchestrator like the five existing Skills.

## Allowed files
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/aigc/aigcSkill.test.ts`
- `client/src/lib/skills/slideRule.ts`
- `client/src/lib/skills/orchestrator.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-project-resolve-114.md`

## Do not
- Do not modify AppBundle in this task.
- Do not add impact graph expectations yet.
- Do not change existing Skill IDs.

## Implementation steps
- [ ] Export `aigcSkill` implementing `validate`, `project`, `resolve`, `crossRefs`, `refNodeId`, and deterministic `generate`.
- [ ] Project nodes for capability, provider, prompt, output schema, knowledge source, retrieval policy, citation policy, and tool config.
- [ ] Resolve `capability`, `provider`, `prompt`, `outputSchema`, `knowledgeSource`, and `tool`.
- [ ] Emit crossRefs to RBAC roles/permissions and DataModel fields.
- [ ] Register `aigcSkill` in `slideRule.ts` after Page and before AppBundle only if AppBundle does not yet consume AIGC refs.
- [ ] Add orchestrator tests proving the combined diagram has an AIGC subgraph and no ghost refs when DataModel/RBAC are wired.

## Required validation
- `$p='client/src/lib/skills/aigc/aigcSkill.ts'; foreach($m in 'aigcSkill','project(model','resolve(model','crossRefs(model','refNodeId'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/aigc/aigcSkill.ts client/src/lib/skills/aigc/aigcSkill.test.ts client/src/lib/skills/orchestrator.test.ts`

## Acceptance criteria
- AIGC appears in the combined architecture graph.
- AIGC refs resolve through existing RBAC and DataModel surfaces.
- Full existing Skill suite remains green.

