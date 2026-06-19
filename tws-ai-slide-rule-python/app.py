"""
SlideRule V5 Python Backend (baseline).

Exposes the active /api/sliderule/* surface (via sliderule_full_router + mapped capability executor):
- Sessions
- orchestrate-plan (RAG)
- execute-capability using execute_mapped_capability for core + many expanded caps (structure, instruction.package, handoff, visual, etc.)
- drive, coverage

The main delegation target for Node (PYTHON_SLIDE_RULE_BASE_URL).

Current state: keyword RAG baseline, many caps have dedicated paths in capability_maps, but not yet full historical Node parity or real vector store.
See FINAL_MIGRATION_STATUS.md and audit for realistic % (Python baseline ~38-42%, not "complete").

Run: uvicorn app:app --port 9700
Node .env: PYTHON_SLIDE_RULE_BASE_URL=http://localhost:9700 + internal key
"""

import sys
import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, str(Path(__file__).parent))

from config.settings import settings
from routes.blueprint_spec_docs import router as blueprint_spec_docs_router
from routes.sliderule_full import router as sliderule_full_router
from services.persistence import load_all, save_all
from services.v5_full_driver import drive_full_v5_session
from models.v5_state import V5SessionState

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[startup] SlideRule V5 Python Backend starting...")
    # Load persisted V5 sessions
    app.state.sessions = load_all()
    print(f"Loaded {len(app.state.sessions)} V5 sessions.")
    # TODO: init vector DB, knowledge like original Python project for RAG
    yield
    print("Persisting V5 sessions on shutdown...")
    save_all(app.state.sessions)

app = FastAPI(
    title="SlideRule V5 Python Backend (baseline)",
    description="Python V5 baseline for /api/sliderule (sessions, orchestrate, execute via mapped caps + RAG). See status docs for current coverage and gaps vs. full historical Node V5.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Full V5 API - this is the takeover
app.include_router(sliderule_full_router, prefix="/api/sliderule")
app.include_router(blueprint_spec_docs_router, prefix="/api/blueprint/spec-documents")

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "backend": "tws-ai-slide-rule-python",
        "migration": "v5-baseline",
        "note": "Active target for Node PYTHON_SLIDE_RULE_* delegation. execute-capability uses mapped executor for core + expanded caps. Keyword RAG. Realistic progress per FINAL_MIGRATION_STATUS.md (~38-42% baseline)."
    }

@app.post("/api/sliderule/drive-full")
async def drive_full(payload: dict, x_internal_key: str = Header(None)):
    if x_internal_key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")
    state = V5SessionState(**payload["state"])
    final = drive_full_v5_session(state, max_loops=payload.get("max_loops", 5))
    return {"state": final.model_dump(), "status": "V5 full path completed with real RAG evidence"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)
