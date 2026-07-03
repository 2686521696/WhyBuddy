# sliderule-v2-closure-skills-07-workflow-task-view-closure-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: skills
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Close Workflow task view evidence against Page task surfaces and AppBundle bindings.

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
- Status: changed
- Commands run (focused validation, relative paths):
  - npx vitest run client/src/lib/skills/page/pageSkill.test.ts --reporter=dot
  - npx vitest run client/src/lib/skills/page/pageSkill.test.ts -t "119 workflow task view" --reporter=verbose
  - npx vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts --reporter=dot
  - npx tsc --noEmit
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-skills-07-workflow-task-view-closure-119.md
  - node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['119-appbundle-runtime-closure','## Required implementation','## Acceptance criteria','codex-reviewed-only','Worker final report']) { if(!task.includes(needle)) throw new Error('task missing marker: '+needle); }" agent-loop/tasks/sliderule-v2-closure-skills-07-workflow-task-view-closure-119.md
- Files changed: ["client/src/lib/skills/page/pageSkill.ts", "client/src/lib/skills/appbundle/appBundleSkill.ts", "client/src/lib/skills/page/pageSkill.test.ts", "client/src/pages/SlideRule.tsx", "agent-loop/tasks/sliderule-v2-closure-skills-07-workflow-task-view-closure-119.md"]
- Exported symbols: createWorkflowTaskViewAppBundleBindingEvidence, WORKFLOW_TASK_VIEW_APPBUNDLE_BINDING_EVIDENCE (from pageSkill); createAppBundleWorkflowTaskViewPositiveSample / NegativeSample, APPBUNDLE_WORKFLOW_TASK_VIEW_* (from appBundleSkill); projectWorkflowTaskView (now directly referenced); workflowPageTaskViewConsistency path now exercises projection in evaluateAppBundleRuntimeClosure
- Validation outputs (to be recorded):
  - pageSkill vitest: all prior + 3 new 119 tests pass
  - tsc: clean
  - mojibake: clean
  - markers: include required + report
- How this advances publish/runtime closure: Adds executable adapter createWorkflowTaskViewAppBundleBindingEvidence (calls projectWorkflowTaskView for Page task surface) + wiring inside AppBundle evaluateAppBundleRuntimeClosure so that pageBindings produce workflowPageTaskViewConsistency (positive when valid binding+instance projects view; fail-closed to INVALID/blocked on mismatch/empty). Added dedicated positive/negative 119 tests. SlideRule.tsx now directly imports and references for task view closure evidence. Provides both paths scoped to one boundary without weakening fail-closed or prior semantics. Supplies focused candidate for Codex.
