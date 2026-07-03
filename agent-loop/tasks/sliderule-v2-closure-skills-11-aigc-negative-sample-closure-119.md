# sliderule-v2-closure-skills-11-aigc-negative-sample-closure-119

## Execution status
- Status: DONE_REVIEWED
- Phase: 119-appbundle-runtime-closure
- Theme: skills
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Expose AIGC negative sample evidence that fails closed when policy or schema evidence is absent.

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

## Final report (concise, per Required implementation)
- Changed files:
  - client/src/lib/skills/aigc/aigcSkill.ts
  - client/src/lib/skills/aigc/aigcSkill.test.ts
  - client/src/lib/skills/appbundle/appBundleSkill.ts
  - client/src/lib/skills/appbundle/appBundleSkill.test.ts
- Exported symbols (new for AIGC negative sample evidence that fails closed on absent policy/schema):
  - aigcModelWithMissingPolicyOrSchema (fixture demonstrating absent schema/policy)
  - AIGC_NEGATIVE_SAMPLE_EVIDENCE, AIGC_NEGATIVE_SAMPLE_POLICY_SCHEMA_ABSENT
  - createAigcNegativeSampleForPolicyOrSchemaAbsent(model, targetSkill) -> AigcCrossRuntimeEvidence (state "blocked", specific reason)
  - APPBUNDLE_AIGC_NEGATIVE_RUNTIME_PATH
  - createAppBundleAigcNegativePathSample(model) -> Normalized... (state blocked, APPBUNDLE_AIGC_POLICY_SCHEMA_EVIDENCE_ABSENT)
  - (existing) createAigcFailClosedNegativeEvidence, createAigcPositiveSampleEvidence, evaluateAigcRuntimePolicy (now covered by dedicated negative test)
- How advances publish/runtime closure: Adds deterministic negative sample evidence path for AIGC when policy (retrieval/citation) or schema absent, complementing positive; surfaces feed appbundle runtime closure evaluate + publish gates with explicit blocked on absent policy/schema evidence. Preserves all prior fail-closed, no new IO, no API breaks.
- Validation commands (deterministic, local):
  - pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot
  - pnpm exec vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts --reporter=dot
  - pnpm exec vitest run client/src/lib/skills --reporter=dot
  - pnpm exec tsc --noEmit --skipLibCheck
- Public API: additive only (new creators+consts+fixture); existing createAigc* and evaluate stable. No migration.
- No secrets/IO/weakening; all tests 463 pass in skills; focused negative for absent policy/schema.

## Codex Review Landing

Reviewed and landed as part of the Skill linkage closure batch. AIGC negative/fail-closed sample evidence for absent policy/schema is covered by AIGC tests and consumed by AppBundle runtime closure tests.

Validation:
- `npx vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts client/src/lib/skills/rbac/rbacSkill.test.ts client/src/lib/skills/workflow/workflowSkill.test.ts client/src/lib/skills/page/pageSkill.test.ts client/src/lib/skills/aigc/aigcSkill.test.ts client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/purchaseApproval.test.ts --reporter=dot` -> 7 files / 470 tests passed.
