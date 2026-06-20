# Backend Python Node Route Inventory 75 Candidate

## Purpose

This inventory supports the 75% candidate migration batch. It is not proof that the overall NodeJS backend migration has reached 75%. It separates current surfaces into unmigrated, contract, runtime bridge, and production wiring buckets.

## Scope

The migration target is this repository's NodeJS backend moving toward Python implementation plus Node proxy/contract surfaces. The sibling or reference project `tws-ai-ask-python` is reference-only and must not be counted as migrated target code.

## Status Buckets

| Bucket | Meaning | Evidence Required |
|---|---|---|
| unmigrated | Node remains the owner and Python has no meaningful contract/runtime path | route/core file evidence |
| contract | Python and Node agree on envelope/schema, often with fake or bounded runtime | Python pytest + Node vitest contract gate |
| runtime bridge | Node delegates a real bounded operation to Python runtime without production external dependency | Python runtime tests + Node proxy tests |
| production wiring | Runtime bridge is connected to stable storage/service/observability boundary with safe fallback | runtime tests + production boundary tests + no-secret checks |

## Major Backend Areas To Recheck

| Area | Current planning status | Next 75 candidate task |
|---|---|---|
| executor/tasks | contract existed but previous queue had HALT_NO_CHANGES; do not count as new delivery | backend-python-task-executor-runtime-bridge |
| knowledge/admin | contract existed but previous queue had HALT_NO_CHANGES; do not count as new delivery | backend-python-knowledge-admin-runtime-bridge |
| Blueprint main state | contract/runtime boundary still separate from full Node state machine | backend-python-blueprint-main-state-runtime-boundary |
| Blueprint job runtime | proxy/runtime slice exists and should be revalidated | backend-python-blueprint-job-runtime-proxy |
| Blueprint stage edit | proxy contract slice exists and should be revalidated | backend-python-blueprint-stage-edit-proxy-contract |
| role runtime | proxy contract slice exists; real role-agent runtime remains larger than this task | backend-python-role-runtime-proxy-contract |
| session persistence | Python persistence contract exists; runtime boundary must be kept honest | backend-python-session-persistence-runtime-boundary |
| NL command | runtime contract slice exists; full Node orchestration remains larger | backend-python-nl-command-runtime-contract |
| workflow | runtime contract exists; staged production execution remains larger | backend-python-workflow-runtime-contract |
| RAG ingestion | runtime contract exists; production storage and external vector dependencies remain separate | backend-python-rag-ingestion-runtime-contract |
| telemetry | route contract exists; production sink and rollup are separate | backend-python-telemetry-route-contract |
| A2A | runtime contract exists; stream and real external agents remain out of scope | backend-python-a2a-runtime-contract |
| deployment/live smoke | not a business migration slice, but required for 75 candidate maturity | backend-python-deployment-live-smoke-boundary |
| production observability | rollup needed before claiming production maturity | backend-python-production-observability-rollup |

## Counting Rules

- Queue completion is not migration completion. Inspect DONE/HALT/HALT_NO_CHANGES/final report evidence.
- Contract completion is not runtime completion.
- Runtime bridge completion is not production wiring completion.
- Fake runtime completion is not real external service wiring.
- HALT_NO_CHANGES is not a new migration slice.
- A high SlideRule subsystem percentage must not be reported as the whole NodeJS backend percentage.

## Files To Inspect During Execution

- `agent-loop/scripts/migration-queue.json`
- `agent-loop/tasks/sliderule-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `.agent-loop/runs/*/final-report.md` and `.agent-loop/runs/*/final-report.json` as read-only evidence
- Python tests under `tws-ai-slide-rule-python/tests/`
- Node tests under `server/tests/`, `server/routes/__tests__/`, and route-local `*.test.ts` files
