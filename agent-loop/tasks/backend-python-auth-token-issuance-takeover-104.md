# Backend Python 104: Auth token issuance takeover

## Execution status
- Status: pending
- Goal: add Python-owned token issue/refresh/revoke decision for a bounded auth slice, or formally retain token issuance.
- Required gate: `authTokenIssuanceTakeover104Gates`

## Context
103 kept `tokenIssuance` as `node-retained`. This task must prove Python can own a token lifecycle decision without compromising existing auth behavior.

## Allowed files
- `tws-ai-slide-rule-python/services/auth_token_issuance_takeover.py`
- `tws-ai-slide-rule-python/tests/test_auth_token_issuance_takeover_104.py`
- `server/auth/session-service.ts`
- `server/routes/auth.ts`
- `server/tests/auth-token-issuance-takeover-104.test.ts`
- `shared/auth.ts`
- This task file

## Do not
- Do not generate real production secrets.
- Do not change password or session policy without tests.
- Do not claim full auth migration from a decision-only response.

## Acceptance criteria
- Python returns token lifecycle decision with safe metadata only.
- Node tests cover issue/refresh/revoke or retained fallback.
- Security-sensitive behavior stays deterministic in tests.
- Review confirms no false 100% auth claim.
