# sliderule-v2-closure-precheck-02-closure-python-test-matrix-119

## Execution status
- Status: DONE_REVIEWED
- Phase: 119-appbundle-runtime-closure
- Theme: precheck
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Define and run the Python test matrix for drive-full closure schema and blocked/happy paths.

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

## Worker final report
- Status: changed (addressing review_needs_changes: added focused Python test matrix for drive-full closure schema + happy/blocked/fail-closed paths; ran pytest; added this report)
- Commands run (smallest relevant for Python drive-full closure matrix definition+run):
  - slide-rule-python/.venv/Scripts/python.exe -m pytest tests/test_v5_publish_closure_response.py -q --tb=line  => 5 passed (original 2 + matrix 3 cases)
  - slide-rule-python/.venv/Scripts/python.exe -m pytest tests/test_v5_publish_closure_response.py -q -k "closure_matrix or drive_full_closure" --tb=no  => targeted matrix
  - node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['119-appbundle-runtime-closure','## Required implementation','## Acceptance criteria','codex-reviewed-only']) { if(!task.includes(needle)) throw new Error('task missing marker: '+needle); }\" agent-loop/tasks/sliderule-v2-closure-precheck-02-closure-python-test-matrix-119.md  => markers OK
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-precheck-02-closure-python-test-matrix-119.md  => clean
- Files changed (relative, scoped to allowed):
  - slide-rule-python/tests/test_v5_publish_closure_response.py
  - agent-loop/tasks/sliderule-v2-closure-precheck-02-closure-python-test-matrix-119.md
- Exported symbols (new/updated in test):
  - test_drive_full_closure_schema_matrix_happy_blocked_119 (parametrized matrix, 3 cases: 1 happy, 2 blocked)
  - test_drive_full_closure_response_absent_is_fail_closed_119 (explicit negative)
  - describe-equivalent: matrix covers drive-full style runtimeClosure schema (blocked, blockers, perSkillEvidence, closureHash, findingsByTier, topBlockers)
- Validation commands (per required for 119 precheck + cross ref 118):
  - slide-rule-python/.venv/Scripts/python.exe -m pytest tests/test_v5_publish_closure_response.py -q
  - slide-rule-python/.venv/Scripts/python.exe -m pytest tests/test_v5_publish_closure_response.py tests/test_v5_smoke.py -q -k "publish_closure or drive_full" --tb=line
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-precheck-02-closure-python-test-matrix-119.md
- How this advances publish/runtime closure: This precheck task supplies the missing Python test matrix definition and execution evidence for drive-full closure schema (positive happy non-blocked evidence paths + explicit blocked/fail-closed negative behaviors in derive_publish_closure_response used by routes after drive_full_v5_session). Previously gate only marker-checked the task; now executable matrix + pytest runs prove drive-full publishClosure extraction (blocked/happy, schema keys) for AppBundle runtime closure per Objective. Provides clean candidate slice for codex review/landing without weakening any fail-closed semantics or existing tests. Scoped to slide-rule-python and task file. All public API (derive_publish_closure_response) stable.

## Codex Review Landing

Reviewed and landed as part of the closure precheck batch. Python drive-full closure schema matrix is covered by publish closure and smoke route tests.

Validation:
- `npx vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/orchestrator.test.ts client/src/lib/skills/purchaseApproval.test.ts --reporter=dot` -> 3 files / 128 tests passed.
- `cd slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_v5_publish_closure_response.py tests/test_v5_smoke.py -q -k "publish_closure or drive_full" --tb=short` -> 16 passed / 12 deselected.
- `node agent-loop/scripts/normalize-closure-queue-outcomes.mjs --self-test` -> ok true.
- `node agent-loop/scripts/land-queue.mjs --self-test` -> ok true.
- `node agent-loop/scripts/secret-scan.mjs --self-test` -> positive clean and negative blocker cases passed.
- `node --run check` -> exit 0.
- `git diff --check` -> exit 0.
