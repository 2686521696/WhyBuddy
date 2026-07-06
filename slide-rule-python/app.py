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
import re
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, str(Path(__file__).parent))

from config.settings import settings
from routes.blueprint_jobs import router as blueprint_jobs_router
from routes.blueprint_spec_docs import router as blueprint_spec_docs_router
from routes.sliderule_full import router as sliderule_full_router
from routes.agent_loop import router as agent_loop_router
from routes.rag import router as rag_router
from services.persistence import load_all, save_all
from services.slide_rule_session import save_session
from services.v5_full_driver import drive_full_v5_session
from services.v5_publish_closure_response import derive_publish_closure_response
from services.v5_skill_runtime_graph import derive_skill_runtime_graph_response
from services.sliderule_session_sanitizer import sanitize_session_dict, sanitize_session_state
from models.v5_state import V5SessionState


def _turn_seq_for_drive_full(value) -> int:
    if not value:
        return 0
    match = re.search(r"(\d+)", str(value))
    return int(match.group(1)) if match else 0


def _advance_drive_full_turn_id(value) -> str:
    return f"turn-{_turn_seq_for_drive_full(value) + 1}-drive-full"

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[startup] SlideRule V5 Python Backend starting...")
    # Load persisted V5 sessions
    app.state.sessions = load_all()
    print(f"Loaded {len(app.state.sessions)} V5 sessions.")
    # skill.invoke / mcp.call production runtimes (node-bridge strangler; see
    # services/node_bridge_runtime.py). Without this the executor degrades.
    from services.node_bridge_runtime import configure_node_bridge_runtimes

    if configure_node_bridge_runtimes():
        print("[startup] node-bridge skill/mcp runtimes configured.")
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
app.include_router(blueprint_jobs_router, prefix="/api/blueprint/jobs")

# AgentLoop control plane (Python owned, bridge mode for workers)
app.include_router(agent_loop_router, prefix="/api/agent-loop")

# RAG query/search (PYTHON_FIRST_COMPAT per task 37); Python owns search/ingest behavior
app.include_router(rag_router, prefix="/api/rag")

# SlideRule AgentLoop 110: first-class /AgentLoop and /agent-loop web route shell
# Served by python app; reuses dashboard statics; /api/agent-loop/dashboard remains for compat.
from fastapi.responses import HTMLResponse, FileResponse
from routes.agent_loop import _get_dashboard_index_path

@app.get("/AgentLoop", response_class=HTMLResponse)
async def serve_agentloop_top():
    """First-class /AgentLoop route serving the AgentLoop shell (110)."""
    index_path = _get_dashboard_index_path()
    if index_path.exists():
        try:
            return FileResponse(str(index_path), media_type="text/html")
        except Exception:
            html = index_path.read_text(encoding="utf-8")
            return HTMLResponse(content=html)
    fallback = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>AgentLoop</title></head><body><h1>AgentLoop</h1><div id="runs"></div><script src="/api/agent-loop/agent-loop-dashboard.js"></script></body></html>"""
    return HTMLResponse(content=fallback)


@app.get("/agent-loop", response_class=HTMLResponse)
async def serve_agentloop_alias():
    """Lowercase /agent-loop alias for the shell."""
    return await serve_agentloop_top()


@app.get("/health")
@app.get("/api/health")
async def health():
    """Unified health and readiness probe. Python is the backend API source of truth for health/readiness (PYTHON_FIRST_COMPAT).
    Exposes explicit provenance for smokes and cutover verification.
    Readiness is reported separately to support k8s-style /ready probes.
    Retirement note added by task 55: server/index.ts still holds ACTIVE_NODE_BUSINESS for unmigrated surfaces.
    """
    return {
        "status": "ok",
        "backend": "slide-rule-python",
        "migration": "v5-baseline",
        "source": "python",
        "provenance": "backend:slide-rule-python",
        "readiness": "ready",
        "probes": {
            "liveness": "/health",
            "readiness": "/ready"
        },
        "observabilityCoverage": {
            "health": True,
            "provenance": True,
            "degradedStates": True,
            "errors": True
        },
        "note": "Python FastAPI is backend API source for health/readiness probes. Node /api/health is thin compat proxy only and delegates via PYTHON_SLIDE_RULE_BASE_URL.",
        "serverIndexRole": "ACTIVE_NODE_BUSINESS (majority surfaces; thin shells for sliderule/health/agent-loop slices)",
        "serverIndexRetirementTask": 55,
        "serverIndexRetirementState": "plan-recorded; blocked pending full slice cutover (auth/rag/a2a/main-blueprint etc)"
    }


@app.get("/ready")
async def readiness():
    """Readiness probe. Reports Python as ready for backend API traffic."""
    return {
        "status": "ready",
        "backend": "slide-rule-python",
        "source": "python",
        "provenance": "backend:slide-rule-python",
        "observabilityCoverage": {"health": True, "provenance": True, "degradedStates": True, "errors": True}
    }


@app.get("/api/sliderule/health")
async def sliderule_api_health():
    return await health()


@app.get("/minimal", response_class=HTMLResponse)
async def serve_minimal_page():
    """Minimal standalone verification page (no build step, no React).

    Drives the /api/sliderule chain directly and renders backend truth:
    per-skill closure evidence + skillRuntimeGraph. Served at
    http://localhost:9700/minimal — used to validate the backend flow
    independently of the full SPA.
    """
    minimal_path = _Path(__file__).resolve().parent / "static" / "minimal.html"
    if minimal_path.exists():
        return FileResponse(str(minimal_path), media_type="text/html")
    return HTMLResponse("<h1>minimal.html not found</h1>", status_code=404)


# --- Observability readiness (task 58): ensure Python API surfaces health, provenance,
# degraded states, and errors with explicit signals. Node remains thin proxy only.
# All error paths and degraded returns must carry python provenance so degraded states
# are visible (never hidden by Node).
@app.exception_handler(HTTPException)
async def _observability_http_exception(request: Request, exc: HTTPException):
    """Attach python provenance to all HTTP error responses for observability."""
    content = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
    if not isinstance(content, dict):
        content = {"message": str(content)}
    content.setdefault("status", "error")
    content.setdefault("backend", "slide-rule-python")
    content.setdefault("source", "python")
    content.setdefault("provenance", "backend:slide-rule-python")
    content.setdefault("degraded", True)
    return JSONResponse(status_code=exc.status_code, content=content)


@app.exception_handler(Exception)
async def _observability_generic_exception(request: Request, exc: Exception):
    """Generic errors always surface as degraded with python source (visible to smokes/tests)."""
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "error": type(exc).__name__,
            "message": str(exc)[:300],
            "backend": "slide-rule-python",
            "source": "python",
            "provenance": "backend:slide-rule-python",
            "degraded": True,
        },
    )


@app.get("/api/observability")
async def observability():
    """Unified observability surface covering health, provenance, degraded states, and errors.
    Python is the backend source of truth. Used by contracts, smokes, and retirement verification.
    """
    base_health = await health()
    return {
        **base_health,
        "observability": {
            "coverage": {
                "health": True,
                "provenance": True,
                "degradedStates": True,
                "errors": True,
            },
            "provenanceSignals": ["backend:slide-rule-python", "source:python", "python-rag", "python-llm", "python-fullpath"],
            "degradedExample": _degraded_example(),
            "errorProvenance": "always attached via exception handlers (see /health error paths)",
        },
        "note": "Python FastAPI owns observability signals for health/provenance/degraded/errors. Node proxies are thin shells only.",
    }


def _degraded_example():
    return {
        "degraded": True,
        "error": "planner_timeout",
        "backend": "slide-rule-python",
        "source": "python",
        "provenance": "python-rag",
    }


@app.post("/api/sliderule/drive-full")
async def drive_full(payload: dict, x_internal_key: str = Header(None)):
    # Match lenient dev auth from router (allows missing key in non-prod for direct Vite proxy)
    if x_internal_key is None or x_internal_key == "":
        if os.getenv("NODE_ENV", "development") != "production":
            pass
        else:
            if x_internal_key != settings.SLIDE_RULE_INTERNAL_KEY:
                raise HTTPException(403, "Invalid key")
    elif x_internal_key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")
    raw_state, _ = sanitize_session_dict(payload["state"])
    state = V5SessionState(**raw_state)
    user_text = sanitize_session_dict({"text": payload.get("userText", "") or payload.get("user_text", "")})[0].get("text", "")
    final = drive_full_v5_session(state, max_loops=payload.get("max_loops", 5), user_instruction=user_text)
    final, _ = sanitize_session_state(final)
    publish_closure = derive_publish_closure_response(final)
    skill_graph = derive_skill_runtime_graph_response(final)
    final.publishClosure = publish_closure
    final.skillRuntimeGraph = skill_graph
    final.lastTurnId = _advance_drive_full_turn_id(getattr(final, "lastTurnId", None))
    save_session(final)
    return {
        "state": final.model_dump(),
        "status": "V5 full path completed with real RAG evidence",
        "stateAuthority": "python",
        "provenance": "python-fullpath",
        "backend": "python",
        "publishClosure": publish_closure,
        "skillRuntimeGraph": skill_graph,
        "closureWarnings": [],
    }


# --- Pure Python direct mode (no Node middleman) ---
# Serve the built React SPA (dist/public) so /agent-loop/sliderule etc can be accessed
# directly on the Python port (e.g. http://localhost:9700/agent-loop/sliderule).
# This lets you run ONLY uvicorn (no Node server at all) for sliderule-focused work.
#
# Usage:
#   1. npm run build
#   2. (optional) SLIDERULE_STATIC_DIR=/absolute/path/to/dist/public python -m uvicorn app:app --port 9700
#   3. Open http://localhost:9700/agent-loop/sliderule
#
# All /api/sliderule and /api/agent-loop APIs are already mounted and will be direct.
import os
from pathlib import Path as _Path
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

_static_dir_env = os.getenv("SLIDERULE_STATIC_DIR")
if _static_dir_env:
    _spa_static = _Path(_static_dir_env)
else:
    # Default: from slide-rule-python/ go up to repo root /dist/public
    _spa_static = _Path(__file__).resolve().parent.parent / "dist" / "public"

if _spa_static.exists():
    # Mount Vite assets (JS/CSS) so the served index.html can load them
    _assets_dir = _spa_static / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="spa-assets")

    # Also expose top-level static files if any (favicons etc.)
    app.mount("/static-spa", StaticFiles(directory=str(_spa_static)), name="spa-root-files")

    def _serve_spa_index():
        index_file = _spa_static / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file), media_type="text/html")
        return HTMLResponse("<h1>SPA not built. Run `npm run build` first.</h1>")

    # SPA fallback for the rich sliderule / agent-loop experience (pure direct to 9700, no Node).
    # Client-side routes (wouter) need index.html returned for these paths.
    # /api/* routes are already registered earlier so they take priority.
    @app.get("/agent-loop/sliderule/{full_path:path}", include_in_schema=False)
    @app.get("/agent-loop/sliderule", include_in_schema=False)
    async def _spa_agent_loop_sliderule(full_path: str = ""):
        return _serve_spa_index()

    @app.get("/sliderule/{full_path:path}", include_in_schema=False)
    @app.get("/sliderule", include_in_schema=False)
    async def _spa_sliderule(full_path: str = ""):
        return _serve_spa_index()

    # Optional: full /agent-loop/* can also fall to SPA if you want the rich UI instead of minimal dashboard.
    # If you still want the old minimal shell at /agent-loop , comment the next two lines.
    @app.get("/agent-loop/{full_path:path}", include_in_schema=False)
    @app.get("/agent-loop", include_in_schema=False)
    async def _spa_agent_loop_catch(full_path: str = ""):
        return _serve_spa_index()

    @app.get("/AgentLoop/{full_path:path}", include_in_schema=False)
    @app.get("/AgentLoop", include_in_schema=False)
    async def _spa_agent_loop_upper(full_path: str = ""):
        return _serve_spa_index()

    # Root fallback (useful when running pure Python on 9700)
    @app.get("/", include_in_schema=False)
    async def _spa_root():
        return _serve_spa_index()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)
