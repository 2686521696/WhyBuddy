# Backend Python 104: Auth mailer and user store scope

## Execution status
- Status: pending
- Goal: decide whether email mailer and user repository are Python-owned, node-retained, external-owned, or out-of-scope, with code-level evidence.
- Required gate: `authMailerUserStoreScope104Gates`

## Context
103 kept `emailCodeMailer` and `userRepository` as Node retained. These may not be worth migrating, but they must be formally classified so they stop being vague 100% blockers.

## Allowed files
- `tws-ai-slide-rule-python/services/auth_mailer_user_store_scope.py`
- `tws-ai-slide-rule-python/tests/test_auth_mailer_user_store_scope_104.py`
- `server/auth/email-code-service.ts`
- `server/auth/email-mailer.ts`
- `server/routes/auth.ts`
- `server/tests/auth-mailer-user-store-scope-104.test.ts`
- `shared/auth.ts`
- This task file

## Do not
- Do not send real email.
- Do not touch real user data.
- Do not claim production takeover if the surface is intentionally external or retained.

## Acceptance criteria
- Python and Node tests agree on mailer/user store ownership classification.
- External-owned or retained status includes reason and denominator handling.
- No live email or real user persistence is required.
- Review confirms the scope decision can feed migration status.
