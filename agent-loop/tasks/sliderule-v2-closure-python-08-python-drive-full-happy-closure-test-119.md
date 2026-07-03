# sliderule-v2-closure-python-08-python-drive-full-happy-closure-test-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: python
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Add Python happy path test proving /drive-full returns closed publish closure evidence.

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

## Final Report (concise, for Codex review)

**Changed files (relative, scoped to task):**
- `slide-rule-python/tests/test_v5_smoke.py`
- `agent-loop/tasks/sliderule-v2-closure-python-08-python-drive-full-happy-closure-test-119.md` (report; code change is primary)

**Exported / key symbols exercised (Python /drive-full happy closed):**
- `routes/sliderule_full.drive_full` (POST /drive-full returns `publishClosure`)
- `services.v5_publish_closure_response.derive_publish_closure_response`
- `services.v5_publish_closure_response.PublishClosureResponse` (schema validation in happy path)
- `services.v5_full_driver.drive_full_v5_session`
- New focused test: `test_drive_full_happy_path_returns_closed_publish_closure_evidence`

**Validation commands:**
- `cd slide-rule-python && python -m pytest tests/test_v5_smoke.py -q -k "drive_full_happy_path_returns_closed_publish_closure_evidence or drive_full_route_returns_publish_closure" --tb=line`
- `cd slide-rule-python && python -m pytest tests/test_v5_smoke.py::test_drive_full_happy_path_returns_closed_publish_closure_evidence -q --tb=short`
- `cd slide-rule-python && python -m pytest tests/test_v5_publish_closure_response.py -q --tb=no`
- `cd slide-rule-python && python -m pytest tests/test_v5_smoke.py -q -k "drive_full" --tb=line`

**How this advances publish/runtime closure:**
Adds dedicated Python happy path test exercising /drive-full route + derive to return closed (blocked=False) publishClosure evidence with positive counts, closureId/hash, and Pydantic schema assert. Uses only local fakes inside capabilityRun (no provider/net/DB). Complements prior schema/derive work and fail-closed tests. Includes final report. Provides the missing Python-side happy closed evidence assertion the review noted was absent. Keeps /drive-full and derive_* public names stable. Supplies candidate for codex-reviewed landing in 119-appbundle-runtime-closure wave.

Public API names unchanged.
