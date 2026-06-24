# Backend Python 104: Task project auth runtime takeover

## Execution status
- Status: pending
- Goal: add a Python-owned project-resource authorization decision for task lifecycle, or explicitly retain Node ownership.
- Required gate: `taskProjectAuthRuntimeTakeover104Gates`

## Context
Project resource auth remained a Task lifecycle blocker after 103. This task should add a testable authorization decision envelope and Node bridge behavior.

## Allowed files
- `tws-ai-slide-rule-python/services/task_project_auth_runtime_takeover.py`
- `tws-ai-slide-rule-python/tests/test_task_project_auth_runtime_takeover_104.py`
- `server/routes/tasks.ts`
- `server/tasks/mission-runtime.ts`
- `server/tests/task-project-auth-runtime-takeover-104.test.ts`
- `shared/mission/contracts.ts`
- This task file

## Do not
- Do not loosen project access rules.
- Do not replace unrelated permission systems.
- Do not mark auth as Python-owned without a denied/allowed/error-path test.

## Acceptance criteria
- Python returns allow/deny/degraded classification for project resource auth.
- Node route test proves the classification affects task behavior safely.
- Existing Node fallback is explicit.
- Review confirms no security regression.
