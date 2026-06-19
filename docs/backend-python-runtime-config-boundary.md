# Backend Python runtime config boundary

This document freezes the small runtime contract between the Node backend and
the migrated Python SlideRule service. It is intentionally narrow: it documents
how Node finds Python, how calls are authenticated, how timeouts work, and how
health failures are diagnosed. It does not migrate new business capabilities.

## Python service defaults

The Python service is `tws-ai-slide-rule-python/app.py`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | `9700` | Local FastAPI port for the Python backend. |
| `SLIDE_RULE_INTERNAL_KEY` | `dev-slide-rule-internal` | Shared internal key expected on protected Python POST routes. |
| `QDRANT_URL` | `http://localhost:6333` | Vector store endpoint for future real retrieval. |
| `DB_*` | local development defaults | Persistence connection inputs. Production values must come from env, not source. |

The public health endpoint is:

```text
GET /health
```

It does not require `X-Internal-Key`. Protected delegation routes such as
`/api/sliderule/execute-capability` and `/api/blueprint/spec-documents/generate-one`
do require `X-Internal-Key`.

## Node delegation defaults

Node resolves the Python runtime through `server/sliderule/python-delegation.ts`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PYTHON_SLIDE_RULE_BASE_URL` | `http://localhost:9700` | Python service base URL; trailing slashes are trimmed. |
| `PYTHON_SLIDE_RULE_INTERNAL_KEY` | `dev-slide-rule-internal` | Sent as `X-Internal-Key` for protected POST delegation calls. |
| `PYTHON_SLIDE_RULE_TIMEOUT_MS` | `120000` | Timeout for Node-to-Python fetch calls. Invalid or non-positive values fall back to the default. |
| `SLIDERULE_V5_BACKEND` | `python` | Uses Python for the listed V5 capability surface; set `legacy` to force old Node paths. |

Proxy behavior is deliberately not implemented inside the delegation helper.
Node fetch uses environment-level proxy behavior, such as `HTTP_PROXY`,
`HTTPS_PROXY`, `NO_PROXY`, and `NODE_USE_ENV_PROXY`. Local Python URLs should
normally stay direct through `NO_PROXY=localhost,127.0.0.1`.

## Failure classes

The runtime boundary tests lock the failure shapes:

- service unavailable: fetch rejects, health returns `ok: false`, and delegation
  errors include the connection failure text.
- contract/auth failure: non-2xx Python responses include the endpoint and HTTP
  status.
- invalid response shape: JSON parse or shape failures are separate from service
  reachability failures.

These errors are diagnostic only. They must not be converted into fake success
payloads that look like retrieved Python evidence.

## Verification

The migration queue uses `runtimeConfigGates`:

```powershell
cd tws-ai-slide-rule-python; & "tws-ai-slide-rule-python/.venv/Scripts/python.exe" -m pytest tests/test_runtime_config_boundary.py tests/test_config.py -q --tb=short
pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/python-runtime-config-boundary.test.ts --reporter=dot
pnpm exec tsc --noEmit --pretty false
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-runtime-config-boundary.md docs/backend-python-runtime-config-boundary.md tws-ai-slide-rule-python/tests/test_runtime_config_boundary.py server/routes/__tests__/python-runtime-config-boundary.test.ts
```
