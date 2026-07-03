# sliderule-v2-closure-skills-10-aigc-positive-sample-closure-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: skills
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Expose AIGC positive sample evidence that can feed DataModel/Page/RBAC/AppBundle closure.

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

## Final report (concise, per Required implementation)
- Changed files:
  - client/src/lib/skills/aigc/aigcSkill.ts
  - client/src/lib/skills/aigc/aigcSkill.test.ts
  - agent-loop/tasks/sliderule-v2-closure-skills-10-aigc-positive-sample-closure-119.md
- Exported symbols (new/used for positive sample evidence feeding closure):
  - purchaseRiskAigcModel (canonical positive AIGC sample)
  - emptyLeaveAigcModel (negative/empty)
  - AIGC_POSITIVE_SAMPLE_TO_DATAMODEL, AIGC_POSITIVE_SAMPLE_TO_PAGE, AIGC_POSITIVE_SAMPLE_TO_RBAC, AIGC_POSITIVE_SAMPLE_TO_APPBUNDLE
  - AIGC_POSITIVE_SAMPLE_EVIDENCE
  - createAigcPositiveSampleEvidence(model, targetSkill) -> AigcCrossRuntimeEvidence (state "allowed" with refs)
  - createAigcFailClosedNegativeEvidence(model, targetSkill) -> ... (state "blocked")
  - createAigcCrossRuntimeEvidence, buildAigcCrossRuntimeEdges, evaluateAigcRuntimePolicy (existing, used), normalizeAigcRuntimeContextForSkill
  - validateAigcRuntimeOutput (fail-closed on missing citationEvidence etc.)
- How advances publish/runtime closure: AIGC now exposes deterministic positive evidence paths (purchase risk sample with capability/field/permission/outputSchema refs) and explicit fail-closed blocked negatives for the four target skills (datamodel, page, rbac, appbundle). These surfaces (resolve + cross runtime + dedicated positive creators) feed AppBundle runtime closure checks, publish gates, and impact without runtime side effects.
- Validation commands (deterministic, local):
  - pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot
  - pnpm exec vitest run client/src/lib/skills --reporter=dot
  - node -e "const fs=require('fs'); const t=fs.readFileSync('agent-loop/tasks/sliderule-v2-closure-skills-10-aigc-positive-sample-closure-119.md','utf8'); console.log('markers ok:', t.includes('119-appbundle-runtime-closure') && t.includes('## Required implementation'));"
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-skills-10-aigc-positive-sample-closure-119.md
  - pnpm exec tsc --noEmit --pretty false | findstr /C:"error TS" || echo "tsc clean (no new errors)"
- Public API: no renames; additive exports only. No migration needed.
- No secrets, no IO, no weaken of fail-closed (evaluate + evidence + output validate + cross all preserve deny/blocked on missing).
