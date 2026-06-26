# SlideRule V2 AIGC 114.11: purchase approval E2E

## Execution status
- Status: PENDING
- Goal: add a deterministic purchase approval E2E sample with an AI budget risk summary.
- Required gate: `slideruleV2AigcPurchaseApprovalE2e114Gates`

## Context
The existing purchase approval scenario proves five-system closure. This task extends it with AIGC so the six-system Intent-to-App story is visible and testable.

## Allowed files
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/purchaseApproval.test.ts`
- `client/src/lib/skills/orchestrator.test.ts`
- `client/src/lib/skills/slideRule.ts`
- `client/src/lib/skills/appbundle/appBundleSkill.ts`
- `agent-loop/tasks/sliderule-v2-aigc-purchase-approval-e2e-114.md`

## Do not
- Do not call a real LLM.
- Do not add a new product scenario unless purchase approval cannot express the needed AIGC refs.
- Do not weaken publish gate to make the sample pass.

## Implementation steps
- [ ] Add or reuse a `budget_risk_summary` AIGC capability.
- [ ] Bind inputs to `purchase_request.amount`, `purchase_request.department`, `purchase_request.vendor`, and `purchase_request.budgetChecked`.
- [ ] Restrict use to `finance` and `department_manager`.
- [ ] Use output schema fields `riskLevel`, `summary`, and `recommendedAction`.
- [ ] Ensure publish gate is green with AIGC included in AppBundle.
- [ ] Assert impact paths for amount and finance role include the AIGC capability.

## Required validation
- `$p='client/src/lib/skills/purchaseApproval.test.ts'; foreach($m in 'budget_risk_summary','purchase_request.amount','finance','recommendedAction','publishGate'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/purchaseApproval.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/purchaseApproval.test.ts client/src/lib/skills/aigc/aigcSkill.ts`

## Acceptance criteria
- Purchase approval becomes a six-system E2E sample.
- AIGC is covered by publish gate and impact graph.
- No real LLM/provider/runtime work is introduced.

