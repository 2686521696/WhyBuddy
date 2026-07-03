# sliderule-v2-closure-skills-08-page-field-binding-closure-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: skills
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Close Page field binding evidence against DataModel SSOT fields.

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

## Final Report (page-field-binding-closure-119)
Changed files:
- client/src/pages/SlideRule.tsx (fixed: createPageCrossRuntimeEvidence call moved before slideRule.publishGate, now passes real datamodel from result.spec.skills as upstream SSOT surface/fields (not fake {declared:true}), result assigned (not void) so evidence computation participates in publish/runtimeClosure context)
- client/src/lib/skills/page/pageSkill.test.ts (added focused describe + 3 tests exercising positive allowed + fail-closed blocked for field binding evidence)
- agent-loop/tasks/sliderule-v2-closure-skills-08-page-field-binding-closure-119.md (this report)

Exported symbols exercised/added: createPageCrossRuntimeEvidence (existing public), pageSkill.resolve (field surface), pageFieldRefs (internal used for evidence). No public API rename.

Validation commands:
- npx vitest run client/src/lib/skills/page/pageSkill.test.ts -t "page field binding evidence closure"
- npx vitest run client/src/lib/skills/page/pageSkill.test.ts
- node -e "
  const {deriveApplication, slideRule} = require('./client/src/lib/skills/slideRule');
  deriveApplication('请假申请').then(r => { const g=slideRule.publishGate(r.spec.skills); console.log('publishable:',g.publishable,'hasRuntimeClosure:',!!g.runtimeClosure); });
"
- tsc check on client (type ok, no new deps)

How this advances publish/runtime closure: Wires deterministic Page->DataModel field binding evidence (via createPageCrossRuntimeEvidence with actual DM SSOT surface/fields from spec.skills) directly into the derive/publishGate path in SlideRule (before gate, evidence result participates in closure flow for crossRuntime/publish preview). Combined with unit tests for positive (allowed + fieldRefs on real upstream) and fail-closed (blocked on absent), this closes the binding evidence for AppBundle runtimeClosure without weakening semantics. Report now matches implemented behavior and gate evidence. Scoped, preserves fail-closed. Candidate for codex slice.
