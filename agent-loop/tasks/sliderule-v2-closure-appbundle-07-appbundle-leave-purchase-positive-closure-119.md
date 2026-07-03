# sliderule-v2-closure-appbundle-07-appbundle-leave-purchase-positive-closure-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: appbundle
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Keep leave and purchase approval AppBundle closure green with explicit per-skill evidence coverage.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on AppBundle as the publish/runtime closure aggregator. Prefer pure TypeScript helpers, deterministic fixtures, and focused tests.

## Reference sources
- `agent-loop/tasks/sliderule-v2-cross-*-118.md`
- `agent-loop/scripts/sliderule-v2-cross-runtime-118-shard-*-queue.json`
- `.worktrees/sliderule-v2-cross-runtime-118-shard-*-run`
- Current main commits around AppBundle runtime closure and Skill linkage.

## Allowed files
- `client/src/lib/skills/**`
- `client/src/pages/sliderule/**`
- `client/src/pages/SlideRule.tsx`
- `slide-rule-python/**`
- `server/routes/sliderule.ts`
- `server/sliderule/**`
- `agent-loop/tasks/**`
- `agent-loop/scripts/**`

## Do not
- Do not edit `.env`, credentials, lockfiles, or unrelated runtime artifacts.
- Do not weaken existing tests, gates, or fail-closed semantics.
- Do not apply a raw 480-task patch wholesale.
- Do not mark done with markdown-only changes.
- Do not make network, DB, Redis, provider, or browser calls from pure Skill helpers.

## Required implementation
- [ ] Add or update executable code, typed schema, fixture, adapter, or focused tests for the objective.
- [ ] Preserve deterministic local behavior.
- [ ] Include both positive evidence and fail-closed negative behavior where applicable.
- [ ] Keep public API names stable or document any migration in the final report.
- [ ] Add a concise final report listing changed files, exported symbols, and validation commands.

## Acceptance criteria
- The result is useful as candidate material for Codex review and main landing.
- The changed code is scoped to the objective and theme.
- Focused tests are added or updated when practical.
- Existing AppBundle publish/runtime closure semantics are not weakened.
- AgentLoop final report explains how this task advances publish/runtime closure.

## Implementation report (grok fix for review)
Changed files:
- client/src/lib/skills/appbundle/appBundleSkill.test.ts
- client/src/lib/skills/purchaseApproval.test.ts
- agent-loop/tasks/sliderule-v2-closure-appbundle-07-appbundle-leave-purchase-positive-closure-119.md (report only)

Exported symbols exercised/updated (no new public names):
- evaluateAppBundleRuntimeClosure
- leaveApprovalAppBundle / purchaseApprovalAppBundle (existing fixtures)
- buildLeaveModels / buildPurchaseModels (internal test helpers)
- perSkillEvidence fields: evidencePresent, dataModelBindings, rbacPdpDecisions, workflowPageTaskViewConsistency, versionPin.pinned, aigcInvocationOutputPolicy etc.
- classifyAppBundleRuntimeClosureFinding, APPBUNDLE_RUNTIME_CLOSURE_BLOCKED, findingsByTier

This adds explicit per-skill positive evidence assertions for leave approval AppBundle (core skills: datamodel/rbac/workflow/page/appbundle) in appBundleSkill.test.ts (plus existing leave fail-closed), and for purchase approval AppBundle (incl aigc) in purchaseApproval.test.ts + purchase positive test in appBundleSkill.test.ts. Strengthens coverage of per-skill (datamodel/rbac/workflow/page/aigc/appbundle) positive + hard_blocker fail-closed without changing impl or fixtures. Keeps all prior semantics, pure deterministic TS.

Validation commands:
- pnpm exec vitest run client/src/lib/skills/purchaseApproval.test.ts client/src/lib/skills/appbundle/appBundleSkill.test.ts --reporter=dot
- pnpm exec tsc --noEmit --pretty false

Advances publish/runtime closure by ensuring the AppBundle aggregator's leave and purchase positive paths carry explicit per-skill evidence (purchase incl aigc) as required for the 119 wave candidate material.
