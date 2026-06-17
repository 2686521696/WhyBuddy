# tws-ai-slide-rule-python

Migrated backend from Node.js SlideRule V5 (cube-pets-office server/).

This replaces the unstable Node.js backend for:
- V5 Session management and state (artifacts, capability runs, coverage/GCOV).
- Orchestrate-plan (capability selection with grounding, coverage gates).
- Execute-capability for key V5 caps:
  - report.write (stable structured report generation via RAG).
  - mcp.call / skill.invoke (real tool/skill execution bringing external evidence via RAG/knowledge).
  - evidence.search, risk.analyze, etc. (RAG-based evidence retrieval instead of LLM fallbacks or templates).
- LLM routing: Uses stable config (like original tws-ai-ask-python's llm_config) + RAG for evidence/tools instead of su8 primary + 6-key pool (which caused 504s, "Cannot reach", template fallbacks, degraded tools).
- Proxy/NO_PROXY issues resolved by using Python's direct LLM/RAG stack.
- Full-path reasoning now stable (no more "pilot-template" hacks in real runs; real RAG evidence).

## Structure (modeled after tws-ai-ask-python)
- app.py: FastAPI entry, lifespan, routers.
- config/: settings (LLM, DB, Qdrant, etc.), database.
- models/: Pydantic for V5SessionState, Coverage, etc. + SQLAlchemy.
- routes/: sliderule.py (main V5 APIs: /sessions, /orchestrate-plan, /execute-capability).
- services/: 
  - rag_service.py, knowledge_embedding_service.py (for evidence/tools).
  - llm_config.py, qwen_service.py or equivalent (stable LLM).
  - slide_rule_orchestrator.py (plan selection).
  - slide_rule_executor.py (cap execution).
  - session_store.py.
- middlewares/: auth, etc.
- utils/: helpers.

## How to run (dev)
python -m uvicorn app:app --port 9700 --reload

## Integration
- .env: PYTHON_SLIDE_RULE_BASE_URL=http://localhost:9700
- Node client/fullpath now proxies V5 calls here (or direct).
- Replaces Node's su8/pool, capability-llm-fallback, pool-json-llm, etc.

All Node V5 instability (degraded mcp/skill, report template, proxy 504s on pool, loose GCOV) resolved by using this project's mature RAG + knowledge + LLM.

## Migration status
Core V5 migrated: state, orchestrate, execute for tools/evidence/report/risk using stable RAG (no templates, real evidence).
Full surface (auth, knowledge upload, other non-V5 routes) can be ported iteratively from original tws-ai-ask-python reference + Node.

See app.py and routes/sliderule.py for entrypoints.
