# sliderule-v2-closure-python-02-python-drive-full-publish-closure-schema-119

## Execution status
- Status: DONE_REVIEWED
- Phase: 119-appbundle-runtime-closure
- Theme: python
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Add Python schema for publishClosure/runtimeClosure response payloads.

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

## Final Report (concise)

Changed files:
- slide-rule-python/services/v5_publish_closure_response.py
- slide-rule-python/tests/test_v5_publish_closure_response.py
- agent-loop/tasks/sliderule-v2-closure-python-02-python-drive-full-publish-closure-schema-119.md

Exported symbols (from slide-rule-python/services/v5_publish_closure_response.py):
- derive_publish_closure_response
- PublishClosureResponse (Pydantic typed schema for response payload)
- PublishClosureTopBlocker
- PublishClosureTierCounts

Validation commands:
- cd slide-rule-python; python -m pytest tests/test_v5_publish_closure_response.py -q --tb=line
- cd slide-rule-python; python -m pytest tests/test_v5_smoke.py -q -k "publish_closure" --tb=no
- cd slide-rule-python; python -m pytest tests/test_v5_smoke.py -q -k "drive_full_returns_publish_closure_response_when_available" --tb=line

This task adds the Python typed schema (Pydantic models) + adapter derive + focused positive/negative tests for publishClosure/runtimeClosure payloads returned by /drive-full. It provides reviewable evidence of the schema shape (matching cross-runtime report) and fail-closed None behavior, enabling Codex review for main landing. Advances 119-appbundle-runtime-closure by owning the Python /drive-full response contract slice.

## Codex Review Landing

Reviewed and landed as part of the Python `/drive-full` closure batch. Evidence lives in `slide-rule-python/services/v5_publish_closure_response.py` and `slide-rule-python/tests/test_v5_publish_closure_response.py`.

Validation:
- `.\slide-rule-python\.venv\Scripts\python.exe -m pytest slide-rule-python/tests/test_v5_publish_closure_response.py slide-rule-python/tests/test_v5_skill_runtime_graph.py -q --tb=short` -> 19 passed.
- `cd slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_v5_smoke.py::test_drive_full_accepts_real_execute_capability_result_model tests/test_v5_smoke.py::test_drive_full_route_returns_publish_closure_and_skill_runtime_graph_when_available tests/test_v5_smoke.py::test_drive_full_happy_path_returns_closed_publish_closure_evidence tests/test_v5_smoke.py::test_drive_full_route_returns_none_publishClosure_skillRuntimeGraph_on_no_evidence tests/test_v5_smoke.py::test_drive_full_model_dump_and_plain_dict_capability_result_compat tests/test_v5_smoke.py::test_drive_full_blocked_path_for_missing_declared_skill_evidence -q --tb=short` -> 6 passed.

Public API names remain stable: `derive_publish_closure_response`, `PublishClosureResponse`, and top-level `publishClosure`.
