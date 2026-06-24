# Backend Python 104: Auth session repository takeover

## Execution status
- Status: pending
- Goal: move a bounded session repository operation into Python runtime, or explicitly retain the Node session repository.
- Required gate: `authSessionRepositoryTakeover104Gates`

## Context
103 kept `sessionRepository` as `node-retained`. This task must attack that blocker directly with runtime evidence or a retained decision.

## Allowed files
- `tws-ai-slide-rule-python/services/auth_session_repository_takeover.py`
- `tws-ai-slide-rule-python/tests/test_auth_session_repository_takeover_104.py`
- `server/auth/session-service.ts`
- `server/routes/auth.ts`
- `server/tests/auth-session-repository-takeover-104.test.ts`
- `shared/auth.ts`
- This task file

## Do not
- Do not weaken login/session security.
- Do not store secrets or real tokens in tests.
- Do not count token decision-only behavior as repository takeover.

## Acceptance criteria
- Python service handles a deterministic session repository decision or operation.
- Node tests cover create/read/revoke or fallback behavior.
- Takeover flag is true only for the proven slice.
- Retained repository responsibility remains explicit if not migrated.
