# Backend Python 104: Blueprint preview state runtime takeover

## Execution status
- Status: pending
- Goal: add Python-owned preview-state projection/validation for a bounded Blueprint slice, or formally retain preview state.
- Required gate: `blueprintPreviewStateRuntimeTakeover104Gates`

## Context
103 marked `previewState` as `node-retained`. This task should prove a narrow runtime projection path that can be consumed by Node without breaking current preview behavior.

## Allowed files
- `tws-ai-slide-rule-python/services/blueprint_preview_state_runtime_takeover.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_preview_state_runtime_takeover_104.py`
- `server/routes/blueprint/preview-state-runtime-takeover-python.ts`
- `server/routes/blueprint/*preview*`
- `server/routes/__tests__/blueprint.preview-state-runtime-takeover-104.test.ts`
- This task file

## Do not
- Do not rewrite effect preview or generated asset systems.
- Do not count a display-only projection as durable state ownership.
- Do not modify unrelated UI.

## Acceptance criteria
- Python returns a preview-state decision/projection for a realistic input.
- Node bridge test consumes it and keeps fallback explicit.
- Tests distinguish projection from durable production takeover.
- Migration denominator is updated in code-level evidence.
