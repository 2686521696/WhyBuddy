# SlideRule V5 Python Baseline + Node Thin Proxy Progress (Audit-aligned)

**Note:** This document has been updated to reflect realistic audit status (see user's % table). Previous "complete/100%/fully functional" language overstated the state. V5 Python baseline and Node delegation are in progress. The Node execute-capability *mocked contract* is converged at 17/0; the conditional live Node→Python delegation harness (in a dedicated file) is ready but skipped in routine runs and requires :9700 + LIVE_NODE_TO_PYTHON_SLIDERULE=1 to verify. RAG is still keyword/tag based.

**Date:** Ongoing (per latest audit cycle)

## Audit of Node.js Backend (Key Pain Points)
The Node backend (server/) for V5 was the source of all instability you reported:
- LLM routing (llm-client.ts, pool-json-llm.ts, ai-config.ts): su8.codes primary + 6-key low pool. Proxy injection (dev-all, NODE_USE_ENV_PROXY, HTTP_PROXY) caused "Cannot reach" and 504s on all keys. SU8_COOLDOWN, transient fallbacks, report preferring pool to avoid large prompt 504s -> pool exhaustion -> template.
- Orchestrate-plan (orchestrate-plan.ts): LLM plan + GCOV + grounding. Fallback to pool on error, leading to the exact logs you showed (falling back to 5-low pool, pool race exhausted).
- Execute-capability (routes/sliderule.ts + capability-*-map.ts + capability-llm-fallback.ts):
  - mcp.call/skill.invoke: Special cased to "runtime" but hit llm_fallback -> "外部工具 调用失败，本轮未引入外部证据" and "技能 未命名 调用失败".
  - report.write: Pool first, skip primary -> template on fail ("provenance": "template").
  - evidence/risk/etc.: Mapped but unstable due to LLM.
- Session/driver (session-driver.ts, mini-session.ts, memory/session-store.ts): V5 state, loops relying on above.
- Coverage/GCOV (shared/blueprint/sliderule-coverage-gate.ts): Forces mcp/skill for RPG goals (as in your logs), but evaluates "passed" even on degraded/template (loose gates "marked resolved").
- Real runtime (execution-bridge.ts, skill-activator.ts, executor-client.ts): Intended for tools but not always wired in /execute-capability path used by fullpath -> degraded.
- Fallbacks and tests (fixtures.ts): Heavy "pilot-template", commitTrusted, buildStructuredReport because real path was flaky with LLM.
- Other: blueprint/ (400+ files for spec, agents, brainstorm), nl-command, knowledge/rag (duplicated instability), persistence, etc. All tied to flaky LLM or delegation.

This matched exactly your marathon logs, degraded tools, template report, proxy issues, and why fullpath tests used simulation.

## New Python Project (tws-ai-slide-rule-python)
Created fresh (no use of old tws-ai-ask-python content, only structure reference: FastAPI, config/settings with LLM/DB/vector, models, routes, services/rag, middlewares, utils, app.py with lifespan).

**Baseline migration delivered (directionally correct, realistic scope):**
- V5 state (models/v5_state.py), session/drive, orchestrator, coverage.
- Capability execution: main path now routes through `execute_mapped_capability` (capability_maps.py) for many caps including structure.*, instruction.package, handoff.package, visual/outcome etc. Basic RAG evidence for core (mcp/skill/evidence/report/risk). Full specialized parity for every historical Node cap is still in progress.
- RAG via keyword/tag retrieval + generate (sources + python-rag provenance for delegated caps).
- API surface in the mounted full router (sliderule_full.py + mapped) matches the Node /api/sliderule contract for the V5 paths.
- Node thin delegation (python-delegation.ts + SLIDERULE_V5_BACKEND switch) exists.
- Not "every cap" using dedicated rich executor yet; fallback generic still exists for un-mapped. Real vector RAG not yet.

(This section intentionally avoids "Full / EVERY / Complete" language per audit.)

**Current realistic status (aligned to latest audit % table and contract review):**

- Python V5 baseline (FastAPI surface, smoke/contract, dynamic orchestrator, expanded caps via RAG keyword/tag, sessions, coverage): ~38-42%. Smoke/contract continue green (5 passed). Real vector (Qdrant/embedding) not yet — still keyword/tag retrieval.
- Node thin proxy (callPythonSlideRule extracted to server/sliderule/python-delegation.ts, live SLIDERULE_V5_BACKEND=python|legacy switch in routes/sliderule.ts + gated for the V5 cap list, old /tws-ai-qa ask fallback removed): code side ~35-40%.
- Node proxy *tests* (execute-capability.route.test + delegation mocking): mock + SLIDERULE_V5_BACKEND isolation closed at 17 passed / 0 failed. Dedicated conditional true Node→Python live delegation smoke harness exists in `sliderule.live-delegation.test.ts` (separate file, no top-level mock, exercises real Node router + real callPythonSlideRule when flag set). Routine unit runs skip it (2 skipped); full verification requires starting uvicorn :9700 + `LIVE_NODE_TO_PYTHON_SLIDERULE=1`.
- Overall "V5 可替换 Node 标准": ~36-40% (Node contract closed for the execute surface; Python capability main path uses mapped for many expanded caps; still keyword RAG, limited live cross-process verification, not full parity).
- Other: LLM Phase 1 strong (~80%), real RAG 10-15%, full server migration low single digits outside V5, end-to-end Node+Python automated stability ~25-30%.

## What has been delivered (non-overclaiming)
- Fresh tws-ai-slide-rule-python (no reuse of old ask-python internals beyond reference structure).
- Core ports: V5 models/state, RAG (keyword with "外部证据" + sources for report/evidence/risk/tools), orchestrator (dynamic), full capability executor for many caps (mcp/skill/evidence/report/risk/structure/document/traceability/task/instruction/visual/handoff/ux etc.), driver/session/coverage, FastAPI routes matching the Node /api/sliderule surface, internal key auth.
- Node side: delegation helper extracted, backend switch + live read, delegation if for the 14-ish caps, old ask block removed, .env points to new PYTHON_SLIDE_RULE_*.
- Python smoke + Node tsc green.
- Explicit python vs legacy test isolation pattern in execute-capability.test (in progress to full green).

## Known gaps (per audit)
- Node execute-capability route tests now 17/0 (mock contract + switch closed). Dedicated conditional true Node→Python live delegation smoke harness exists in `sliderule.live-delegation.test.ts` (separate file, no top-level mock). Routine runs skip it (2 skipped). report.write has recorded clean live pass with real python-rag through the Node thin proxy. structure.decompose live still needs a clean pass (previous runs showed fallback/timing to template). Full live closure requires both caps passing with the flag + live :9700.
- No real Qdrant/embedding RAG (still keyword/tag retrieval + generate; sufficient for smoke but not production-grade evidence chain).
- Main execute path (via mounted sliderule_full + execute_mapped_capability) covers many expanded caps with dedicated logic; dialogue/deliberation now have more real IDs mapped. Some still fall to basic executor generic fallback. Full historical Node cap specialized parity + deep semantic content assertions are progressing but not complete.
- Python contract matrix exercises the core 8 caps (with improved semantic checks) + real dialogue/deliberation IDs (intent.clarify, gap.ask, critique.generate, synthesis.merge etc.) via the mapped executor path. Semantic checks are structural-smoke level (keyword bundles for sections/rows) rather than deep schema validation. Still narrow vs. full historical parity.
- Overclaim language in docs/app.py comments still needs ongoing vigilance.

## Verification (current)
- Python smoke/contract: .\.venv\Scripts\python -m pytest tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short => 5 passed, 2 warnings.
- The contract matrix now also covers real dialogue/deliberation IDs (`intent.clarify`, `gap.ask`, `critique.generate`, `synthesis.merge`, ...) through the mapped executor and passes the base + semantic structural checks.
- Node: pnpm exec tsc --noEmit => 0; combined `sliderule.execute-capability.test.ts` + `sliderule.live-delegation.test.ts` => **17 passed | 2 skipped** (the 2 skipped are the conditional live Node→Python delegation tests, as designed).
- Dedicated live harness `sliderule.live-delegation.test.ts` is isolated (no top-level mock) and exercises real Node router + real `callPythonSlideRule` when `LIVE_NODE_TO_PYTHON_SLIDERULE=1` + live :9700 service.
- Real :9700 + Node delegation works when Python uvicorn is up (manual verification with the flag).

## Next per highest-yield audit items (prioritized)
A. (done in this pass) FINAL_MIGRATION_STATUS.md toned, numbers updated to 17/0, overclaims in "Full V5" section removed.
B. Ensure routes (both sliderule.py for consistency + the active full one) use execute_mapped_capability; expand contract assertions.
C. Add a live (or conditionally live) Node->Python delegation smoke that actually starts/connects to :9700.
D. Broaden Python matrix + move toward real vector RAG.
E. Propagate switch pattern to orchestrate-plan tests later.
4. When Node contract closed for the critical surface, *then* "Node proxy contract closed" can be declared.
5. Later: real vector RAG, more parity on coverage/GCOV, expand test coverage, optional full removal of legacy Node V5 paths behind the switch.

The work is real and directional (Node is successfully becoming a thin, switchable proxy; Python baseline is usable and stable for the listed caps). But per the precise contract review, we are not at "closed / complete / 100%" yet. Use the % table in the main audit for tracking.

Run the Python service + Node tests with SLIDERULE_V5_BACKEND toggles to validate both paths.
