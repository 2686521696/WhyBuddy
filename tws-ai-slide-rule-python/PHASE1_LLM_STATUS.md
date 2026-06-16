# Phase 1 — LLM layer (REAL, not a stub)

Faithful port of the Node LLM stack. This is the only trustworthy part of this Python project;
the older `services/*.py` + the grand `FINAL_MIGRATION_STATUS.md` are a non-running stub (canned
`random.sample` "RAG", broken `ask_question` import) — ignore/treat as throwaway.

## What's here
| File | Ports from (Node) | Notes |
|------|-------------------|-------|
| `sliderule_llm/config.py` | `server/core/ai-config.ts` | env + wire selection. Stdlib only. |
| `sliderule_llm/client.py` | `server/core/llm-client.ts` | real `httpx` calls (chat_completions + responses), error normalize, JSON parse |
| `sliderule_llm/pool.py` | `server/sliderule/pool-json-llm.ts` | multi-key parallel/sequential; None on exhaustion |
| `tests/test_config.py` | — | network-free unit tests |
| `tests/test_su8_live.py` | — | opt-in live endpoint test |

Proxy: `httpx.Client(trust_env=True)` (default) reads `HTTP_PROXY/HTTPS_PROXY/NO_PROXY` natively —
no custom dispatcher, so the Node undici-version-skew "invalid onRequestStart" bug cannot happen.

## Verification done
- **Config/wire logic: 7/7 unit tests PASS** on real Python 3.12.
- **Live client: proven correct** — it reproduces curl exactly. (When su8 returned 200 to curl,
  the path was identical; when su8 started returning **404 to curl**, httpx got the **same 404**.
  i.e. the client faithfully reports the endpoint; instability is the endpoint, not the client.)

> Note: a working interpreter was not installed on this machine (only the Windows Store stub +
> a broken venv pointing at another user's path). A throwaway `.venv` was created from the Codex
> runtime python just to run these tests. For real work, install Python properly (e.g.
> `winget install Python.Python.3.12`).

## How to run
```powershell
# from tws-ai-slide-rule-python/
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-llm.txt

# unit tests (no network):
.\.venv\Scripts\python -m pytest tests/test_config.py -q

# live test against a real endpoint (set env or load the main .env first):
$env:RUN_LIVE_LLM=1
$env:LLM_API_KEY="<key>"; $env:LLM_BASE_URL="<base>/v1"; $env:LLM_MODEL="gpt-5.5"; $env:LLM_WIRE_API="chat_completions"
$env:HTTP_PROXY="http://127.0.0.1:7890"; $env:HTTPS_PROXY="http://127.0.0.1:7890"
.\.venv\Scripts\python -m pytest tests/test_su8_live.py -q -s
```

## Next phases (not started)
2. capability execution map (evidence/risk/structure/...) + JSON-LLM call
3. orchestrate-plan (prompt build + `validateProposedPlan` + GCOV) — port `shared/blueprint/sliderule-plan-validation.ts`, `sliderule-coverage-gate.ts`
4. session store + drive loop + FastAPI routes matching the Node API contract 1:1
5. cut the React client over to the Python API

Each phase ships with real tests; no "100% done, sleep well" reports.
