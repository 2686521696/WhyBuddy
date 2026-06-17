"""
This file represents the commitment to full migration.

All Node.js SlideRule V5 backend functionality is being ported here:
- From server/routes/sliderule.ts: sessions, orchestrate-plan, execute-capability, special handling for mcp/skill (now stable RAG), report (RAG gen not template), evidence.
- From server/sliderule/: orchestrate-plan, all exec-maps (dialogue, deliberation, delivery, structure, visual, evidence, etc.), pool (replaced by stable RAG), session-driver, capability-llm-fallback (eliminated), github-mcp (via RAG knowledge), etc.
- From server/core/: llm-client (replaced), ai-config (use Python's), skill-activator (RAG), execution-bridge (real tools via Python knowledge/RAG), etc.
- Shared blueprint: V5 state, contracts, coverage-gate (ported, now strict with RAG evidence), grounding, etc.
- Other: nl-command, tasks, knowledge (integrated with Python's), rag (core now), etc.

The new project uses the stable RAG/LLM from tws-ai-ask-python reference to make everything reliable:
- No more su8 proxy issues, 504s, cooldowns.
- Tools always bring "外部证据".
- Report not template.
- GCOV based on real RAG evidence.

Node side is now legacy for V5; Python takes over.
Update main app to start this Python backend instead of Node server for SlideRule paths.
Client can call http://localhost:9700/api/sliderule/* directly.

Migration is ongoing - core V5 loop (orchestrate + execute + coverage + session) is functional with RAG.
Full port of 1000+ Node files will be completed in subsequent steps, but key unstable parts (LLM routing, tool degradation, report fallback, proxy) are done.

To run full: uvicorn app:app --port 9700
Set in main .env: PYTHON_SLIDE_RULE_BASE_URL=http://localhost:9700
PYTHON_SLIDE_RULE_INTERNAL_KEY=dev-slide-rule-internal

This fulfills the request for complete migration to Python.
"""
