# Backend Python 104: Final provider and A2A scope reconciliation

## Execution status
- Status: pending
- Goal: reconcile Web AIGC real providers and A2A real transport/registry into final migration denominator categories.
- Required gate: `finalProviderA2aScopeReconciliation104Gates`

## Context
103 showed many Web AIGC real providers are `external-owned` or `skipped-live`, and A2A transport/registry can require external agents. This task should not fake live readiness; it should either prove live-ready Python-owned takeover or formally exclude/retain the surface.

## Allowed files
- `tws-ai-slide-rule-python/services/final_provider_a2a_scope_reconciliation.py`
- `tws-ai-slide-rule-python/services/web_aigc_real_provider_live_contract.py`
- `tws-ai-slide-rule-python/services/a2a_session_stream_runtime_slice.py`
- `tws-ai-slide-rule-python/tests/test_final_provider_a2a_scope_reconciliation_104.py`
- `server/core/web-aigc-runtime-extra-adapters.ts`
- `server/routes/a2a-python-runtime.ts`
- `server/tests/final-provider-a2a-scope-reconciliation-104.test.ts`
- `shared/telemetry/contracts.ts`
- `shared/a2a/contracts.ts`
- This task file

## Do not
- Do not use synthetic providers as real external takeover.
- Do not require live paid keys for normal gates.
- Do not count skipped-live/external-owned as migration numerator.

## Acceptance criteria
- Python and Node return the same provider/A2A denominator summary.
- Real live-ready claim is possible only with explicit live-ready ownership and takeover evidence.
- skipped-live, synthetic, external-owned, and external-agent-required stay excluded from completion math.
- Review confirms final provider/A2A status is safe for 104 status refresh.
