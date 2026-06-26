# SlideRule V2 AIGC 114.09: impact graph integration

## Execution status
- Status: PENDING
- Goal: include AIGC in the global dependency and impact graph.
- Required gate: `slideruleV2AigcImpactGraph114Gates`

## Context
If a business field or role changes, the user should see affected AIGC capabilities, prompts, tools, pages, workflows, and app bundles in the impact report.

## Allowed files
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/impact.test.ts`
- `client/src/lib/skills/orchestrator.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-impact-graph-114.md`

## Do not
- Do not rewrite the impact graph engine unless AIGC exposes a real missing edge case.
- Do not modify AppBundle pins yet.
- Do not add runtime behavior.

## Implementation steps
- [ ] Add tests proving `purchase_request.amount` impacts the AIGC purchase risk capability.
- [ ] Add tests proving the `finance` RBAC role impacts the AIGC purchase risk capability.
- [ ] Ensure impact paths show AIGC nodes as PEP consumers of DataModel and RBAC refs.
- [ ] Keep existing field->Page/AppBundle and role->Workflow/Page/AppBundle tests passing.

## Required validation
- `$p='client/src/lib/skills/impact.test.ts'; foreach($m in 'purchase_request.amount','finance','aigc'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/impact.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/impact.test.ts`

## Acceptance criteria
- Impact graph includes AIGC as a downstream consumer.
- Existing non-AIGC impact paths do not regress.
- No engine rewrite unless tests prove it is needed.

