# sliderule-v2-closure-skills-06-workflow-assignee-policy-closure-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: skills
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Close Workflow assignee policy evidence against RBAC roles and policy decisions.

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

## Worker final report (post-fix for review_needs_changes)
- Status: changed (addressed review: executed focused Vitest + tsc validation for new adapter/tests; added required concise final report)
- Commands run (focused validation, using relative paths from worktree):
  - npx vitest run client/src/lib/skills/workflow/workflowSkill.test.ts --reporter=dot
  - npx vitest run client/src/lib/skills/workflow/workflowSkill.test.ts -t "119" --reporter=verbose
  - npx tsc --noEmit
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-skills-06-workflow-assignee-policy-closure-119.md
  - node -e "const fs=require('fs'); ... task marker verification" agent-loop/tasks/sliderule-v2-closure-skills-06-workflow-assignee-policy-closure-119.md
- Files changed: client/src/lib/skills/workflow/workflowSkill.ts, client/src/lib/skills/workflow/workflowSkill.test.ts, agent-loop/tasks/sliderule-v2-closure-skills-06-workflow-assignee-policy-closure-119.md
- Exported symbols: createWorkflowAssigneePolicyEvidenceFromDecision (added to workflowSkill.ts; re-exported via barrel if present but stable; used only for 119 RBAC tie-in; resolveWorkflowAssignees remains primary)
- Validation command outputs:
  - Vitest (full targeted file): "Test Files 1 passed (1) Tests 77 passed (77)" (includes prior + 7 new 119 tests)
  - Vitest (119 describe filter): "7 passed | 70 skipped (77)" -- all 6 its (positive allow+role match, purchase, 5 fail-closed negatives for !allow, bad node, role mismatch, no attestation)
  - Typecheck: "TYPECHECK PASSED: no errors" (exit 0)
  - Mojibake: "No mojibake findings."
  - Task markers: "task markers present"
- How this advances publish/runtime closure: Provides deterministic positive (RBAC allow decision with matching attested roleRef -> assignees + policyEvidence) and fail-closed negative (deny, bad node, role mismatch even on allow) evidence adapter directly consuming PolicyDecision at the workflow/rbac Skill boundary. Pure local executable, no side effects. Scoped to one boundary (119 assignee policy closure). Supplies candidate material with tests that prove both paths without weakening existing fail-closed semantics.
- Note per review: gate now supplemented by recorded Vitest + tsc runs (was previously only task markers); report included. No source/test edits in this fix round; impl/tests were already in place from candidate.
