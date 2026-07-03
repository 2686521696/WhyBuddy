# sliderule-v2-closure-skills-01-datamodel-to-rbac-impact-closure-119

## Execution status
- Status: DONE_REVIEWED
- Phase: 119-appbundle-runtime-closure
- Theme: skills
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Strengthen DataModel field/entity changes so RBAC policy impact reaches runtime closure evidence.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on one Skill boundary at a time. Add deterministic positive and fail-closed negative evidence paths.

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
- [x] Add or update executable code, typed schema, fixture, adapter, or focused tests for the objective.
- [x] Preserve deterministic local behavior.
- [x] Include both positive evidence and fail-closed negative behavior where applicable.
- [x] Keep public API names stable or document any migration in the final report.
- [x] Add a concise final report listing changed files, exported symbols, and validation commands.

## Acceptance criteria
- The result is useful as candidate material for Codex review and main landing.
- The changed code is scoped to the objective and theme.
- Focused tests are added or updated when practical.
- Existing AppBundle publish/runtime closure semantics are not weakened.
- AgentLoop final report explains how this task advances publish/runtime closure.

## Final report (119 datamodel-to-rbac-impact)
Changed files:
- client/src/lib/skills/datamodel/dataModelSkill.ts (added deriveDataModelChangedRefs; wired createDataModelRbacPolicyImpactEvidence into resolve surface + attached to canonical fixtures via post-init using policyRef+ migration changes)
- client/src/lib/skills/datamodel/dataModelSkill.test.ts (added 3 focused its asserting fixture embed, resolve surface, derive)
- client/src/lib/skills/appbundle/appBundleSkill.test.ts (updated purchase closure test to assert datamodel impact evidence now reaches)
- agent-loop/tasks/sliderule-v2-closure-skills-01-datamodel-to-rbac-impact-closure-119.md (this report)

Exported symbols (stable; new is additive):
- deriveDataModelChangedRefs (new helper, used internally)
- createDataModelRbacPolicyImpactEvidence (pre-existing, now live from changes)
- DM_RBAC_POLICY_IMPACT_EVIDENCE
- dataModelSkill.resolve now yields .rbacPolicyImpactEvidence on surface
- fixture models now carry .rbacPolicyImpactEvidence

Validation commands:
- npx vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts -t "119 datamodel to rbac policy impact evidence|datamodel fixture with policy-carrying|resolve surface includes rbacPolicyImpactEvidence|deriveDataModelChangedRefs|resolve surface includes rbacPolicyImpactEvidence but does not add DM key to runtimeEvidence on fail-closed negative"
- npx vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts -t "passes positive runtime closure for purchase|accepts DataModel"
- npx vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts -t "datamodel fixture with policy-carrying field change embeds positive rbac policy impact evidence" --reporter=dot
- node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-skills-01-datamodel-to-rbac-impact-closure-119.md

How this advances publish/runtime closure: DataModel field/entity changes (policyRef for PDP delegation, lifecycle deltas, migrationPlan) now deterministically produce and embed both positive ("DM_RBAC_POLICY_IMPACT_POSITIVE", hasPositiveEvidence:true) and fail-closed negative ("DM_RBAC_POLICY_IMPACT_FAIL_CLOSED_REMOVED_FIELD") evidence objects. These are discoverable by evaluateAppBundleRuntimeClosure's hasDataModelRbacImpact / collectPositiveRuntimeEvidenceKeys without test-only stubs, and exposed on resolve surfaces and cross-runtime. Provides executable Skill-boundary impl + evidence paths required by objective and acceptance.

## Codex Review Landing

Reviewed and landed as part of the Skill linkage closure batch. DataModel-to-RBAC impact evidence is covered by the skill test matrix and AppBundle runtime closure collector.

Validation:
- `npx vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts client/src/lib/skills/rbac/rbacSkill.test.ts client/src/lib/skills/workflow/workflowSkill.test.ts client/src/lib/skills/page/pageSkill.test.ts client/src/lib/skills/aigc/aigcSkill.test.ts client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/purchaseApproval.test.ts --reporter=dot` -> 7 files / 470 tests passed.
