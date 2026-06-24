# Backend Python 104: Permission policy store takeover

## Execution status
- Status: pending
- Goal: move a bounded permission policy store decision/read slice into Python runtime, or explicitly retain policy store ownership.
- Required gate: `permissionPolicyStoreTakeover104Gates`

## Context
103 kept `policyStore` as `node-retained`. This task should prove a Python-owned policy decision or formally classify the retained store.

## Allowed files
- `tws-ai-slide-rule-python/services/permission_policy_store_takeover.py`
- `tws-ai-slide-rule-python/tests/test_permission_policy_store_takeover_104.py`
- `server/permission/policy-store.ts`
- `server/permission/check-engine.ts`
- `server/tests/permission-policy-store-takeover-104.test.ts`
- `shared/permission/contracts.ts`
- This task file

## Do not
- Do not loosen permissions.
- Do not remove existing policy fallback.
- Do not count an allow/deny mock as durable policy store takeover.

## Acceptance criteria
- Python service returns policy ownership and one deterministic policy decision.
- Node tests cover allowed, blocked, and fallback paths.
- Retained policy store responsibilities remain named.
- Review confirms no security regression.
