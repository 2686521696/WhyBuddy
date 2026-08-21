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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from stdio_utf8 import configure_stdio_utf8

# ⚠ 必须赶在任何会 print ⚠ 的 import / 请求之前。Windows 管道默认 GBK，
#   漏钉 = 日志行把自己写成 LLM_GENERATE_FAILED（2026-08-20 Foclip）。
configure_stdio_utf8()

import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware


def _hydrate_env_files() -> None:
    """把根目录与包内 .env 装进 os.environ（不覆盖已有值），与 CWD 无关。

    LLM 客户端（sliderule_llm）与 SLIDERULE_* 开关读的都是 os.environ。
    以前只有 dev 脚本负责注入——绕过脚本手工起 uvicorn 时 key 会静默丢失，
    表现为新颖意图 LLM 生成不可用、发布闭环 fail-closed 0/6（真实事故）。
    根目录 .env 先装（冲突时赢，与 dev-all 的 override 语义一致），包内 .env 补缺。

    pytest 下不水合：测试必须自己控制环境（否则本地 .env 的真 key/开关会
    泄进测试，确定性用例开始真调 LLM——与 Node 侧 isVitestEnvironment 同款守卫）。
    """
    if "pytest" in sys.modules or os.getenv("SLIDERULE_DISABLE_ENV_HYDRATION") == "1":
        return
    package_dir = Path(__file__).resolve().parent
    for env_path in (package_dir.parent / ".env", package_dir / ".env"):
        try:
            text = env_path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


# 必须先于 config.settings / 各服务 import（它们在 import 期就读环境）。
_hydrate_env_files()

from config.settings import settings
from routes.audit import router as audit_router
from routes.blueprint_jobs import router as blueprint_jobs_router
from routes.tasks import router as tasks_router
from routes.executor_events import router as executor_events_router
from routes.executor_dispatch import router as executor_dispatch_router
from routes.permissions import router as permissions_router
from routes.blueprint_spec_docs import router as blueprint_spec_docs_router
from routes.account import router as account_router
from routes.sliderule_full import router as sliderule_full_router
from routes.agent_loop import router as agent_loop_router
from routes.rag import router as rag_router
# 只为触发 import 期自检：种子骨架若引用了未放开生成的区块、或把区块摆进不
# 允许的区域，服务在这里就起不来。跟 schema_legal 里 bindingSchema / 页面预设
# 的自检同一条纪律——坏账本不带病进 Prompt。本轮还没接进推演（下一轮做），
# 但自检要从落地第一天就生效，否则"启动即失败"只是一句写在文档里的话。
from services.app_template import SEED_APP_TEMPLATES as _SEED_APP_TEMPLATES  # noqa: F401
from services.slide_rule_session import save_session
from services.v5_full_driver import drive_full_v5_session
from services.v5_capability_executor import _llm_generate_enabled
from services.v5_publish_closure_response import derive_publish_closure_response
from services.v5_skill_runtime_graph import derive_skill_runtime_graph_response
from services.sliderule_session_sanitizer import sanitize_session_dict, sanitize_session_state
from models.v5_state import V5SessionState


def _llm_readiness() -> dict:
    """LLM 配置就绪度（不含任何密钥明文）——health 与启动日志共用。"""
    key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
    return {
        "keyPresent": bool(key),
        "keyLength": len(key),
        "baseUrl": os.getenv("LLM_BASE_URL") or "",
        "model": os.getenv("LLM_MODEL") or "",
        "generateEnabled": _llm_generate_enabled(),
    }


def _spec_first_readiness() -> dict:
    """spec-first 七步链路的就绪度。

    跟 blockNarrowing 同一个理由：**会静默失效的功能，健康探针里必须有它的
    位置**。这里更甚——它是一条可以整条关掉的替代链路，只看日志分不出
    「没开」和「开了但某个模块导不进来」。effective = 开关开着 ∧ 七个模块都在。
    """
    try:
        from services.spec_first_pipeline import spec_first_readiness

        return spec_first_readiness()
    except Exception as exc:  # noqa: BLE001 — 探针不许因为被探的东西坏了而炸
        return {"effective": False, "error": str(exc)[:120]}


def _narrowing_readiness() -> dict:
    """目录窄化的就绪度 —— **它是一个会静默失效的功能，所以必须能远程看出来**。

    2026-08-11 连着踩了两次同一个形状：

      · `rank_bm25` 漏在 requirements.txt 外，而 block_narrowing 对它 fail-open
        （缺了就退回全量目录）。部署上去窄化整个不生效，而 health、日志、
        接口返回值**没有任何一处看得出来**。
      · 修完之后要验证线上到底装没装，发现除了「登服务器敲一行 pip」没有别的
        办法——一个每次生成都在用的功能，它的开关状态在外面完全不可观测。

    窄化不是可有可无的增强：目录里可达的只有前 ~50 个格子，剩下的靠它才够得着
    （对题件被选中 0.67 → 3.25，p=0.00004）。这种"没生效也不报错"的功能，
    健康探针里必须有它的位置——否则每次部署都要靠人记得去查。

    照 `_llm_readiness` 同一个思路：不暴露实现细节，只回答"它现在能不能干活"。
    """
    from services.block_narrowing import narrowing_enabled, narrowing_limit

    try:
        import rank_bm25  # noqa: F401

        scorer = True
    except Exception:  # noqa: BLE001
        scorer = False
    enabled = narrowing_enabled()
    return {
        "enabled": enabled,
        # 依赖装没装。enabled=true + scorerPresent=false = 开关开着但实际退回全量，
        # 也就是"以为在窄化其实没有"——这一条就是给那个状态用的。
        "scorerPresent": scorer,
        "effective": bool(enabled and scorer),
        "limit": narrowing_limit(),
    }


def _turn_seq_for_drive_full(value) -> int:
    if not value:
        return 0
    match = re.search(r"(\d+)", str(value))
    return int(match.group(1)) if match else 0


def _advance_drive_full_turn_id(value) -> str:
    return f"turn-{_turn_seq_for_drive_full(value) + 1}-drive-full"

#: 事件循环默认执行器的线程数。`SLIDERULE_EXECUTOR_THREADS` 可覆盖。
#:
#: ## 为什么必须显式设，不能用默认值（2026-08-21 事故）
#:
#: 用户原话：「多个人使用，第二个人页面一直 loading」。
#:
#: `asyncio.to_thread` 用事件循环的默认执行器，容量 `min(32, cpu_count + 4)`
#: ——线上 4 核就是 **8 槽**。而流式驱动（前端主路径）把每个能力执行都丢进
#: 这个池：
#:
#:     v5_full_driver.drive_full_v5_session_stream:2141
#:         asyncio.gather(*[asyncio.to_thread(_timed_execute, ...) for sel in group])
#:
#: 一组并行能力最多 5 个（v5_full_driver:330「picker caps selection at 5」），
#: 每个跑一次 LLM、30~180 秒。于是 1 个人占 5/8、**2 个人就把池占满**。
#: 池一满，任何还想 to_thread 的请求就排队——包括新用户开页面时那句
#: `await asyncio.to_thread(load_session, sid)`。那是毫秒级操作，却要等别人的
#: LLM 调用还槽，实测换算下来 28~168 秒白屏。
#:
#: ⚠ **`min(32, cpu+4)` 是给 CPU 密集任务定的口径**，这里全是网络等待，
#:   线程绝大部分时间阻塞在 socket 上、不吃 CPU。按核数算线程数是错的尺子。
#:
#: ⚠ 这跟 2026-08-02 那次事故**同因不同路**：那次修的是 `/drive-full`
#:   （改 `def` → 交给 anyio 的 40 槽池，见 routes/sliderule_full.py 头注），
#:   而流式后来才成为主路径，走的是另一个只有 8 槽的池。**两个池互不相通**，
#:   当年算的「40 槽够用」在这条路上不成立。改一半的经典形状。
#:
#: 64 的来历：一组 5 个 × 约 12 个并发推演。不是拍的，但也不是精算——
#: 真到扛不住的那天，正确解法是把推演挪进任务队列（跟 /drive-full 头注
#: 那条「别把 40 调大」同一个判断），不是继续调这个数。
_DEFAULT_EXECUTOR_THREADS = 64


def configure_event_loop_executor() -> int:
    """把默认执行器换成够大的池，返回实际线程数。

    幂等：重复调用只会再换一个池，不会出错。判据 tests/test_thread_pool_not_starved.py
    直接调它，保证测的跟线上跑的是同一条路。
    """
    import asyncio as _asyncio
    from concurrent.futures import ThreadPoolExecutor as _TPE

    raw = (os.environ.get("SLIDERULE_EXECUTOR_THREADS") or "").strip()
    try:
        n = int(raw) if raw else _DEFAULT_EXECUTOR_THREADS
        if n <= 0:
            raise ValueError
    except ValueError:
        # 配错一个数就让服务起不来，比用默认值糟得多（同 default_max_tokens 那条）。
        print(f"[startup] ⚠ SLIDERULE_EXECUTOR_THREADS={raw!r} 不是正整数，回退 {_DEFAULT_EXECUTOR_THREADS}")
        n = _DEFAULT_EXECUTOR_THREADS
    _asyncio.get_running_loop().set_default_executor(
        _TPE(max_workers=n, thread_name_prefix="sliderule")
    )
    return n


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[startup] SlideRule V5 Python Backend starting...")
    # ⚠ 必须在这里、且在任何 to_thread 之前：默认执行器一旦被首次 to_thread
    #   建出来，后面再 set 也换不掉已经排在旧池上的任务。
    _threads = configure_event_loop_executor()
    print(
        f"[startup] event-loop executor: {_threads} threads "
        f"(默认 min(32, cpu+4)={min(32, (os.cpu_count() or 1) + 4)}，"
        f"流式推演一组占 5 槽——不显式放大则 2 人并发即排队)"
    )
    # 启动即亮牌：LLM 配置就绪度一行可见（缺 key 时新颖意图必然 0/6，
    # 这必须在启动日志里喊出来，而不是等用户撞上 blocked 再排查）。
    llm = _llm_readiness()
    print(
        f"[startup] LLM readiness: keyPresent={llm['keyPresent']} (len={llm['keyLength']}) "
        f"base={llm['baseUrl'] or '(unset)'} model={llm['model'] or '(unset)'} "
        f"generateEnabled={llm['generateEnabled']}"
    )
    if llm["generateEnabled"] and not llm["keyPresent"]:
        print(
            "[startup] WARNING: SLIDERULE_LLM_GENERATE_ENABLED=1 but no LLM_API_KEY in this "
            "process environment — novel intents WILL fail-closed to blocked 0/6. "
            "Put LLM_API_KEY in the repo-root .env (or slide-rule-python/.env) and restart."
        )
    # ⚠ 2026-08-19：这里曾经 `load_all()` 把库里每一条会话 blob 拉进进程。
    # 34 条就要 5.2 MB / 2.3s（sliderule_full 事故注释）；现在 80 条还要
    # 叠 HTTPS 网关。这条又在 slide_rule_session **import** 时跑过一遍，
    # `--reload` 下 worker 再来一次。dev:all 卡在 Application startup complete
    # 就是在等这个。payload 改到第一次 GET /sessions 再拉。
    print("[startup] session archive: payloads deferred until first request")
    # skill.invoke / mcp.call production runtimes (node-bridge strangler; see
    # services/node_bridge_runtime.py). Without this the executor degrades.
    from services.node_bridge_runtime import configure_node_bridge_runtimes

    if configure_node_bridge_runtimes():
        print("[startup] node-bridge skill/mcp runtimes configured.")
    # TODO: init vector DB, knowledge like original Python project for RAG
    yield
    # 关停时绝不 save_all：启动快照从不随运行更新，整体覆写会把运行期间
    # 落盘的所有新会话回滚到启动时刻（实测踩过：每次重启丢当轮全部推演）。
    # 所有写入已在变更时刻按单条守卫式落盘，关停无事可做。

app = FastAPI(
    title="SlideRule V5 Python Backend (baseline)",
    description="Python V5 baseline for /api/sliderule (sessions, orchestrate, execute via mapped caps + RAG). See status docs for current coverage and gaps vs. full historical Node V5.",
    lifespan=lifespan,
)

# CORS：**白名单，没配就整个不装**（2026-08-04）。
#
# 原来是 allow_origins=["*"] + allow_credentials=True。Starlette 对这个组合的
# 处理不是"返回 *"，而是**回显请求方的 Origin**（cors.py:167），实测
# `curl -H "Origin: https://evil.example"` 拿回的就是那个域名 +
# `access-control-allow-credentials: true`。当时没被打穿，只是因为登录 Cookie
# 带 samesite=lax、浏览器不会在跨站 fetch 上带它——整条防线押在一个 Cookie
# 属性上，CORS 这层零防御。
#
# 现在按 full-stack-fastapi-template 的做法（main.py:28 `if
# settings.all_cors_origins:`）：**有白名单才装中间件**。前端与后端同源部署
# （Node/Vite 代理到这里），所以默认空 = 只允许同源 = 浏览器默认行为，
# 不需要任何配置。真要跨域时配 BACKEND_CORS_ORIGINS。
_cors_origins = settings.cors_origins
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    print("[cors] 未配置 BACKEND_CORS_ORIGINS：只允许同源访问（跨站请求会被浏览器拦下）")

# Full V5 API - this is the takeover
# 账号接口挂在 sliderule 前缀下：复用已验证的 Node→Python 代理。
# （/api/auth 那套 —— Node 的遗留账号体系和这边的桥接桩 —— 已于 2026-08-03
# 整体删除，现在全站只有这一套身份。）
app.include_router(account_router, prefix="/api/sliderule")
app.include_router(sliderule_full_router, prefix="/api/sliderule")
app.include_router(blueprint_spec_docs_router, prefix="/api/blueprint/spec-documents")
app.include_router(blueprint_jobs_router, prefix="/api/blueprint/jobs")

# Permissions / audit takeover services have an HTTP skin (task 55/60).
# Thin delegation to services/permission_*, audit_*.
app.include_router(permissions_router, prefix="/api/permissions")
app.include_router(audit_router, prefix="/api/audit")

# Task (mission) store surface: first Python slice of Node routes/tasks.ts
# (CRUD + events + cancel on services/task_store.py; executor dispatch,
# projection/session views, decisions, operator-actions, artifacts stay Node-owned).
app.include_router(tasks_router, prefix="/api/tasks")

# Executor callback event -> mission action projection: first Python slice of
# the Node POST /api/executor/events executor face (state-changing decisions
# only; HMAC/heartbeat/persistence/Socket.IO streaming stay Node-owned).
app.include_router(executor_events_router, prefix="/api/executor/events")

# Executor face slice 2: dispatch / cancel decision surface (pure decisions;
# ExecutorClient transport, retries and heartbeat stay Node-owned; Node wires
# these behind EXECUTOR_DISPATCH_PYTHON_DECISIONS, default OFF).
app.include_router(executor_dispatch_router, prefix="/api/executor")

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
        # LLM 配置就绪度（无密钥明文）：keyPresent=false + generateEnabled=true
        # 意味着新颖意图必然 blocked 0/6 —— 让 health 一眼可诊断。
        "llm": _llm_readiness(),
        # 目录窄化就绪度：enabled=true 而 scorerPresent=false 意味着"开关开着但
        # 实际退回全量目录"——那是个不报错、不留日志的失效态，只能靠这里看出来。
        "blockNarrowing": _narrowing_readiness(),
        "specFirst": _spec_first_readiness(),
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
