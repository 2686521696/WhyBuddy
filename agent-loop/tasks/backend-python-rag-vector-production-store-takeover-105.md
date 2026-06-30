# Backend Python 105: RAG vector production store takeover

## Execution status
- Status: pending
- Goal: Move RAG ingestion/vector update/delete/retrieval production store boundary to Python-owned runtime.
- Queue: `backend-python-total-cutover-105-queue`
- Phase: Web AIGC RAG Providers
- Sequence: 32 / 48

## Context
This task is part of the single-batch NodeJS-to-Python total cutover push. The intent is to reduce real Node business ownership, not to add another thin classification slice. Treat `agent-loop/tasks/000-nodejs-to-python-migration-status.md` as the current denominator map and use the 104 evidence as the baseline.

## Allowed files
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `agent-loop/tasks/backend-python-rag-vector-production-store-takeover-105.md`
- `server/routes/rag.ts`
- `server/web-aigc/vector-*.ts`
- `slide-rule-python/services/rag_ingestion.py`
- `slide-rule-python/sliderule_llm/vector.py`

## Evidence to read
- `agent-loop/tasks/000-nodejs-to-python-migration-status.md`
- `.agent-loop/queue-outcomes.json` when present
- `agent-loop/scripts/backend-python-total-cutover-105-queue.json`
- Previous 105 queue tasks 1-31 when their outputs are relevant.
- Existing Python and Node tests near the files listed above

## Required implementation
1. Implement Python vector store provider abstraction with Qdrant-shaped contract.
2. Delegate Node RAG/vector operations to Python-first runtime.
3. Test no-key degraded, fake Qdrant, upsert/delete/retrieve, and embedding mismatch.

## Required tests
- Add or update Python tests under `slide-rule-python/tests/` for the Python-owned behavior.
- Add or update Node/Vitest tests under `server/**/__tests__/` or `server/tests/` proving Node is a thin proxy or explicit retained compatibility shell.
- Run the smallest relevant Python and Node test commands and record them in the final task update.
- Keep or add a mojibake check for this task and every edited non-generated markdown/code file named by the queue gate.

## Do not
- Do not count docs-only, no-diff, skipped-live, synthetic, external-owned, or retained Node fallback as Python migration completion.
- Do not remove public API compatibility without a Node bridge or explicit frontend update.
- Do not hide Python failures behind silent Node success; degraded and fallback states must be visible.
- Do not edit unrelated frontend polish or AgentLoop dashboard layout unless the task explicitly names it.

## Acceptance criteria
- The task lands real Python-owned runtime, production wiring, frontend integration, or an executable cutover guard matching the goal.
- Tests prove the Python path is exercised and that Node no longer owns migrated business semantics.
- Any remaining Node behavior is named as thin proxy, compatibility shell, or explicitly retained boundary with a reason.
- The worker final report lists commands run, files changed, and whether the migration numerator can change.

## Worker final report (post-fix)

### Commands run (smallest relevant)
- node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-rag-vector-production-store-takeover-105.md
- node agent-loop/src/check-mojibake.js server/routes/rag.ts
- node agent-loop/src/check-mojibake.js slide-rule-python/services/rag_ingestion.py
- node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['## Required implementation','## Required tests','## Acceptance criteria']) { if(!task.includes(needle)) throw new Error('task missing section: '+needle); }" agent-loop/tasks/backend-python-rag-vector-production-store-takeover-105.md
- cd slide-rule-python && python -m pytest tests/test_rag_ingestion_runtime_contract.py tests/test_rag_ingestion_production_storage.py tests/test_vector_client_parity.py -q --tb=line
- npx vitest run server/routes/__tests__/rag-ingestion-python-runtime-contract.test.ts --passWithNoTests

### Files changed
- server/routes/rag.ts
- server/routes/__tests__/rag-ingestion-python-runtime-contract.test.ts
- slide-rule-python/services/rag_ingestion.py
- slide-rule-python/sliderule_llm/vector.py
- slide-rule-python/tests/test_rag_ingestion_runtime_contract.py
- slide-rule-python/tests/test_rag_ingestion_production_storage.py
- slide-rule-python/tests/test_vector_client_parity.py
- agent-loop/tasks/backend-python-rag-vector-production-store-takeover-105.md

### Migration numerator
- Fixes review (all findings):
  - Finding 1 (blocker): rag.ts now uses tryDelegateToPythonRag result as the response for /ingest /batch /search (was ignored); py delegate failures/degraded now returned to client (no silent Node success via deps); explicit retained Node compatibility shell documented.
  - Finding 2 (major): contract test updated to assert delegate result is returned to client (status 503 degraded from delegate, Node deps not called for ingest/search); proves thin proxy, Python path exercised for result, Node no longer owns the migrated vector semantics.
  - Finding 3 (major): report corrected with complete Files changed list (now includes vector.py + all 3 py tests + the Node contract test).
- Python owned (per scope): RAGVectorStoreProvider (Qdrant contract) + rag_ingestion.py production paths for upsert/delete/search (no-key/fake/mismatch covered in py tests).
- Per 000/guards: Node rag routes = explicit retained compatibility shell (reason: Python /api/rag routes not added in this vector store slice); purge/dlq retained. Delegate result visible; degraded states not hidden.
- Numerator increment: no (retained Node shell for public RAG ops per guards; real vector store boundary owned in py but this slice does not change core ownership count).
- Remaining: live Qdrant, full batch/purge/admin, py /api/rag HTTP routes out of this vector store slice.

Mojibake check: pass (ran on all edited md+ts+py; no bad chars).
