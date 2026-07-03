# sliderule-v2-closure-precheck-01-closure-focused-vitest-matrix-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: precheck
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Define and run the focused vitest matrix for AppBundle closure, reports, and Skill linkage.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on validation, landing evidence, and queue hygiene. Do not add broad feature code here.

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

## Worker final report
- Status: changed (addressing review_needs_changes: added executable focused vitest matrix + positive/negative cases + run evidence + this report)
- Commands run (smallest relevant for vitest matrix definition+run):
  - pnpm exec vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts --reporter=dot -t "focused vitest matrix"   => 7 passed (matrix cases)
  - pnpm exec vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/orchestrator.test.ts client/src/lib/skills/purchaseApproval.test.ts --reporter=dot  => 103 passed
  - pnpm exec tsc --noEmit -p tsconfig.json --skipLibCheck  => exit 0
  - node -e "..." agent-loop/tasks/sliderule-v2-closure-precheck-01-closure-focused-vitest-matrix-119.md  => markers OK
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-precheck-01-closure-focused-vitest-matrix-119.md  => clean
- Files changed (relative, scoped):
  - client/src/lib/skills/appbundle/appBundleSkill.test.ts
  - agent-loop/tasks/sliderule-v2-closure-precheck-01-closure-focused-vitest-matrix-119.md
- Exported symbols (new in test):
  - closureReportSkillLinkageMatrix (local test matrix)
  - describe block: "focused vitest matrix: AppBundle closure/reports/Skill linkage (119 precheck)"
  - 5 matrix-driven it.each cases (2 positive evidence, 3 fail-closed negative on APPBUNDLE_RUNTIME_CLOSURE_BLOCKED)
  - 2 additional its: attach* linkage, publishGate positive
- Validation commands (as referenced in prior 117/118 + this precheck):
  - pnpm exec vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot
  - pnpm exec vitest run client/src/lib/skills/purchaseApproval.test.ts --reporter=dot
  - pnpm exec vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts --reporter=dot -t "runtime closure|APPBUNDLE_CLOSURE_MATRIX|evaluateAppBundleRuntimeClosure"
  - pnpm exec tsc --noEmit --pretty false
- How this advances publish/runtime closure: This precheck task supplies the missing focused vitest matrix definition and execution evidence (positive + fail-closed negative behavior for evaluateAppBundleRuntimeClosure, per-skill reports, attach* digest/summary helpers, and cross-skill linkage via publish gate). Previously only marker checks existed; now executable matrix + runs prove AppBundle closure/reports/Skill linkage coverage per Objective/Required. Provides clean candidate slice for codex review without weakening semantics or broad changes. All within allowed files.
