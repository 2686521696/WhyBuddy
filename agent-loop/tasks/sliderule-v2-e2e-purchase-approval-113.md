# SlideRule V2 Skills 113.15: purchase approval E2E scenario

## Execution status
- Status: pending
- Goal: add a second end-to-end scenario, purchase approval, to prove the Skill system is not hardcoded to leave approval and can assemble all five V2 surfaces.
- Required gate: `slideruleV2E2ePurchaseApproval113Gates`

## Context
The current sample line is leave approval. V2 needs a second scenario that exercises permissions, workflow, data fields, pages, version pins, publish gate, and impact graph with different domain language.

## Allowed files
- `client/src/lib/skills/slideRule.ts`
- `client/src/lib/skills/orchestrator.test.ts`
- `client/src/lib/skills/purchaseApproval.test.ts`
- `client/src/lib/skills/rbac/rbacSkill.ts` only for adding exported sample data
- `client/src/lib/skills/datamodel/dataModelSkill.ts` only for adding exported sample data
- `client/src/lib/skills/workflow/workflowSkill.ts` only for adding exported sample data
- `client/src/lib/skills/page/pageSkill.ts` only for adding exported sample data
- `client/src/lib/skills/appbundle/appBundleSkill.ts` only for adding exported sample data
- `agent-loop/tasks/sliderule-v2-e2e-purchase-approval-113.md`
- `This task file`

## Do not
- Do not replace the leave-approval sample.
- Do not special-case orchestrator logic for purchase approval.
- Do not skip publish gate or impact checks.
- Do not introduce LLM calls; use deterministic sample generation in this task.

## Implementation steps
- [ ] Create a purchase-approval sample with at least requester, department manager, finance, and procurement roles.
- [ ] Add DataModel entities and fields for purchase request, amount, department, vendor, approval status, and budget check.
- [ ] Add Workflow nodes for submit, manager approval, finance approval, procurement fulfillment, approved, and rejected.
- [ ] Add Page model for request form and approval/detail view with SSOT bindings and PDP render checks.
- [ ] Add AppBundle model with all surfaces pinned.
- [ ] Add E2E tests that run orchestrator, publish gate, and impact analysis for purchase approval.
- [ ] Assert the final report has no ghost refs and no publish-blocking errors.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/purchaseApproval.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/purchaseApproval.test.ts client/src/lib/skills/slideRule.ts`

## Acceptance criteria
- Purchase approval assembles RBAC, DataModel, Workflow, Page, and AppBundle.
- Publish gate is green for the purchase scenario.
- Impact graph returns meaningful affected paths for purchase amount field and finance role.
- Leave approval scenario remains green.

