# Backend Python 104: Blueprint event bus runtime takeover

## Execution status
- Status: pending
- Goal: create a bounded Python-owned event projection/append/replay slice for Blueprint events, or formally keep the real event bus as retained with denominator evidence.
- Required gate: `blueprintEventBusRuntimeTakeover104Gates`

## Context
103 left Blueprint `eventBus` as `node-retained`. This task attacks that exact blocker. A small slice is acceptable, but it must be real code with tests, not a markdown claim.

## Allowed files
- `tws-ai-slide-rule-python/services/blueprint_event_bus_runtime_takeover.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_event_bus_runtime_takeover_104.py`
- `server/routes/blueprint/event-bus-runtime-takeover-python.ts`
- `server/routes/blueprint/event-bus.ts`
- `server/routes/__tests__/blueprint.event-bus-runtime-takeover-104.test.ts`
- `shared/blueprint/agent-events.ts`
- This task file

## Do not
- Do not replace the whole event bus.
- Do not hide Node-owned transport behind a Python wrapper and call it takeover.
- Do not count replay projection alone as durable event bus ownership.

## Acceptance criteria
- Python service can classify append/project/replay ownership and run one deterministic event projection.
- Node test proves the bridge uses the Python result without breaking existing Node event bus behavior.
- Envelope clearly separates `python-owned`, `node-retained`, and `out-of-scope`.
- Review confirms production event transport is not overstated.
