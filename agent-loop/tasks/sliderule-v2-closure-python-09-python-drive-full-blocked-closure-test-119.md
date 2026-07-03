# sliderule-v2-closure-python-09-python-drive-full-blocked-closure-test-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: python
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Add Python blocked path test proving missing declared Skill evidence does not fake green.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on Python /drive-full schema and pass-through. Preserve degraded/error states and avoid provider calls.

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

## Required implementation (post-fix)
- [x] Added focused executable tests (and schema usage) for Python /drive-full blocked path on missing declared Skill evidence.
- [x] Included positive schema evidence + fail-closed negative (blocked=true, partial evidence) behavior.
- [x] Deterministic local, no provider calls, fail-closed preserved.
- [x] Added concise final report below.

## Validation commands
Run from worktree root (covers /drive-full schema, derive, route pass-through for blocked case):
```
cd slide-rule-python
python -m pytest tests/test_v5_publish_closure_response.py -q --tb=line
python -m pytest tests/test_v5_smoke.py -q -k "drive_full or publish_closure or blocked" --tb=line
python -m pytest tests/test_v5_publish_closure_response.py::test_derive_publish_closure_response_blocked_for_missing_declared_skill_evidence -q --tb=short
python -m pytest tests/test_v5_smoke.py::test_drive_full_blocked_path_for_missing_declared_skill_evidence -q --tb=short
```

## Final Report
This task (119) adds Python-side focused tests proving the blocked path for missing declared Skill evidence in AppBundle publish/runtime closure via /drive-full.

Changed files:
- slide-rule-python/tests/test_v5_publish_closure_response.py (new test exercising derive with declared-missing-ev report)
- slide-rule-python/tests/test_v5_smoke.py (new route-level test for /drive-full returning blocked publishClosure)
- agent-loop/tasks/sliderule-v2-closure-python-09-python-drive-full-blocked-closure-test-119.md (validation cmds + report)

Exported symbols (used/verified):
- derive_publish_closure_response, PublishClosureResponse, PublishClosureTierCounts, PublishClosureTopBlocker (services/v5_publish_closure_response.py:160)
- drive_full handler + publishClosure pass-through (slide-rule-python/routes/sliderule_full.py:516)

Validation commands (as above) execute the Python /drive-full blocked closure tests (both unit derive and integration route) and assert blocked=true + evidencePresentCount < skillCount when declared skill lacks evidencePresent. No faking of green; fail-closed semantics for data absence preserved.

How advances publish/runtime closure: Provides the missing executable evidence (per review) that Python /drive-full + schema derive carries through the fail-closed blocked state from missing declared Skill evidence (as defined by evaluateAppBundleRuntimeClosure semantics), without weakening existing none/degraded paths. Candidate material for codex-reviewed landing. Public API names stable (no migration).
