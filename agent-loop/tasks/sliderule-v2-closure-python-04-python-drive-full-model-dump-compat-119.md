# sliderule-v2-closure-python-04-python-drive-full-model-dump-compat-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: python
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Keep /drive-full compatible with Pydantic model_dump results and plain dict capability results.

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
- `slide-rule-python/services/v5_full_driver.py`
- `slide-rule-python/services/v5_publish_closure_response.py`
- `slide-rule-python/services/v5_skill_runtime_graph.py`
- `slide-rule-python/tests/test_v5_smoke.py`
- `agent-loop/tasks/sliderule-v2-closure-python-04-python-drive-full-model-dump-compat-119.md`

**Exported / key symbols exercised (Python /drive-full model-dump compat):**
- `services.v5_full_driver._result_to_dict` (now documented adapter for Pydantic model_dump results + plain dict capability results in drive_full_v5_session)
- `services.v5_publish_closure_response._as_dict` + `derive_publish_closure_response`
- `services.v5_skill_runtime_graph._as_dict` + `derive_skill_runtime_graph_response`
- `routes.sliderule_full.drive_full` (POST /drive-full returns publishClosure/skillRuntimeGraph)
- `services.v5_capability_executor.execute_v5_capability` (returns model; normalized in driver)
- Focused test: `test_drive_full_model_dump_and_plain_dict_capability_result_compat`

**Validation commands:**
- `cd slide-rule-python && python -m pytest tests/test_v5_smoke.py -q -k "drive_full_model_dump_and_plain_dict or accepts_real_execute or drive_full_route_returns" --tb=line`
- `cd slide-rule-python && python -m pytest tests/test_v5_smoke.py::test_drive_full_model_dump_and_plain_dict_capability_result_compat -q --tb=short`
- `cd slide-rule-python && python -m pytest tests/test_v5_publish_closure_response.py tests/test_v5_skill_runtime_graph.py -q --tb=no`
- `cd slide-rule-python && python -m pytest tests/test_v5_smoke.py -q -k "drive_full" --tb=line`

**How this advances publish/runtime closure:**
Supplies the missing executable adapter (_result_to_dict + _as_dict) + focused test snapshot for /drive-full Python side that explicitly exercises both Pydantic model_dump() capability results and plain dicts in pass-through (publishClosure + skillRuntimeGraph). Adds positive (both shapes derive) and fail-closed negative (degraded/error latest -> None for graph, no masking) behavior. All local fakes, zero provider/net calls enforced. Provides the evidence the gate lacked. Task.md now carries final report. Keeps public API (/drive-full, drive_full_v5_session, derive_*) stable. Candidate slice for 119-appbundle-runtime-closure cross-runtime landing.

Public API names stable; no renames.
