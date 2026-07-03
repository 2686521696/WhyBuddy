# sliderule-v2-closure-python-03-python-drive-full-closure-response-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: python
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Return skillRuntimeGraph and publishClosure from /drive-full where deterministic closure evidence is available.

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

**Changed files (relative, scoped):**
- `slide-rule-python/tests/test_v5_smoke.py`
- `agent-loop/tasks/sliderule-v2-closure-python-03-python-drive-full-closure-response-119.md` (report only; no sole-md reliance)

**Exported / key symbols exercised (Python /drive-full):**
- `routes/sliderule_full.drive_full` (POST /drive-full) returns `publishClosure` + `skillRuntimeGraph`
- `services.v5_publish_closure_response.derive_publish_closure_response` (and `PublishClosureResponse` pydantic schema)
- `services.v5_skill_runtime_graph.derive_skill_runtime_graph_response`
- `services.v5_full_driver.drive_full_v5_session` (used by route)
- Public schema models: `PublishClosureResponse`, `PublishClosureTierCounts`, `PublishClosureTopBlocker`

**Validation commands:**
- `cd slide-rule-python && python -m pytest tests/test_v5_smoke.py -q -k "drive_full_route_returns_publish_closure_and_skill_runtime_graph or drive_full_route_returns_none" --tb=line`
- `cd slide-rule-python && python -m pytest tests/test_v5_publish_closure_response.py tests/test_v5_skill_runtime_graph.py -q --tb=no`
- `cd slide-rule-python && python -m pytest tests/test_v5_smoke.py::test_drive_full_route_returns_publish_closure_and_skill_runtime_graph_when_available -q --tb=short`

**How this advances publish/runtime closure:**
Provides executable route-level positive evidence (both fields populated when appbundle.runtimeClosure + skill graph runs present) and fail-closed negative (None when no/dgraded evidence) directly in Python /drive-full handler + derives. Uses only local deterministic fakes (no provider/net). Adds focused test coverage at the /drive-full surface (previously unit-only on derives). Keeps names stable. Supplies the final report the gate lacked. Candidate material for cross-runtime landing.

Public API names stable: no renames; /drive-full, derive_* unchanged.
