# Backend Python `skill.invoke` boundary audit

This document audits the **current** boundary of the SlideRule V5 `skill.invoke` capability on the Node and Python sides. It answers what exists today and what provenance each path returns. It does **not** implement skill runtime migration and does **not** declare `skill.invoke` migrated.

## Executive summary

| Question | Answer |
| --- | --- |
| Is `skill.invoke` a Python native LLM capability today? | **No.** It is absent from `CAPABILITY_PROMPTS` and `STRUCTURED_JSON_CAPABILITIES` in `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`. |
| Does Node delegate `skill.invoke` to Python in default mode? | **Yes.** `SLIDERULE_V5_BACKEND=python` (default) includes `skill.invoke` in the Python V5 whitelist in `server/routes/sliderule.ts`. |
| Does Python execute a real registered skill for `skill.invoke`? | **No.** Python routes through the mapped/stub path and returns keyword-baseline RAG output with `provenance: python-rag`. No skill registry lookup, no `SkillRegistryDependency`, no script invocation. |
| Does Node execute a real registered skill for `skill.invoke`? | **No.** Node does not call Blueprint `runtime.skill.invoke()` or `SkillRegistryDependency.loadForRole()` for the SlideRule `skill.invoke` capability id. Real skill infrastructure exists elsewhere but is not wired to this capability id. |
| Can `skill.invoke` count toward Python native LLM completion? | **No.** Confirmed against code and tests. Aligns with `docs/backend-python-rag-inventory.md`. |

## Runtime classification

### Real runtime (exists, but not on `skill.invoke` capability path)

Node has production-grade skill infrastructure that is **not** connected to SlideRule `skill.invoke`:

| Component | Path | Role |
| --- | --- | --- |
| Role skill API | `server/routes/blueprint/role-container-loader/` (see `loader.test.ts`) | `runtime.skill.invoke(skillId, input)` loads a skill handle via `SkillRegistryDependency.loadForRole()`. |
| Skill tool routing | `server/routes/blueprint/role-agent-runtime/lite-agent-runtime.ts` | Routes `skill.*` tool ids through `skillRegistry.loadForRole()` → `handle.invoke()`. |
| Skill tool proxy | `server/routes/blueprint/role-agent-runtime/tool-proxy-server.ts` | HTTP proxy for `skill.*` tools with timeout and error shapes (`skill_registry_not_available`, `skill_not_found`). |
| Skill tool registration | `server/routes/blueprint/role-agent-runtime/tool-registration.ts` | Emits `skill.{skillId}` tool definitions from `roleCtx.skill.list()`. |
| Skills binder | `server/routes/blueprint/role-container-loader/skills-binder.js` | Binds role capability packages to skill registry entries. |
| Parity guard scripts | `skills/sliderule/sliderule/scripts/**` | Hard-gate enforcement scripts referenced by `parity-contract.ts`; separate from SlideRule execute-capability. |

These are **real runtime** for Blueprint role agents and parity enforcement. They must not be cited as proof that SlideRule `skill.invoke` is migrated.

### Fallback (current `skill.invoke` execution path)

When Node delegates `skill.invoke` to Python (default mode), Python does **not** use `sliderule_llm.capabilities.execute_capability()`. It falls back to the mapped executor chain:

```
Node server/routes/sliderule.ts
  -> POST /api/sliderule/execute-capability
  -> tws-ai-slide-rule-python/routes/sliderule.py or sliderule_full.py
  -> is_python_native_capability("skill.invoke") == False
  -> execute_mapped_capability()
  -> capability_maps.execute_mcp_or_skill()
  -> services/slide_rule_executor.execute_capability()
```

`execute_mcp_or_skill()` is shared with `mcp.call`. That executor treats `skill.invoke` like `mcp.call` / `evidence.search`: keyword retrieval plus templated generation. This is a **fallback/mapped** path, not native LLM and not real skill invocation.

In legacy Node mode (`SLIDERULE_V5_BACKEND=legacy`), `skill.invoke` is not LLM-backed and is not handled by mapped structure/delivery/visual handlers. The route throws `Server LLM provider does not handle capability: skill.invoke` (HTTP 400). Legacy mode therefore has **no working `skill.invoke` executor**.

### Simulated / stub (what the fallback actually runs)

| Layer | Path | Behavior |
| --- | --- | --- |
| Keyword retrieval | `tws-ai-slide-rule-python/services/rag_service.py` | `retrieve_evidence()` scores a hard-coded `KNOWLEDGE_BASE` by keyword overlap. No skill script, no registry, no external fetch. |
| Stub generation | `tws-ai-slide-rule-python/services/rag_service.py` | `generate_with_rag()` formats retrieved snippets into prose. It simulates LLM output; it does not call a configured model endpoint for `skill.invoke`. |
| Forced provenance | `tws-ai-slide-rule-python/routes/sliderule_full.py` | For `mcp.call`, `skill.invoke`, `evidence.search`, sets `summary = "检索了外部证据"` and `provenance = "python-rag"`. |
| Display metadata only | `tws-ai-slide-rule-python/services/slide_rule_executor.py` | Sets `skillName = "skill.invoke"` (the capability id string), not a registered skill id from `roleCtx.skill.list()`. |

Returned shape may include `skillName`, but that field mirrors the capability id for labeling only. No `skillId` resolution, no `loadForRole()`, no script execution occurs.

## Node path detail

### Default Python-delegation path

File: `server/routes/sliderule.ts`

- `skill.invoke` is in `isPythonV5Cap` alongside native LLM caps.
- Delegation target: `POST /api/sliderule/execute-capability` on the Python service.
- On Python failure: returns HTTP 502 with `provenance: python-delegated-failed` (explicit degraded shape, not fake success).
- Node never invokes `runtime.skill.invoke()` or `SkillRegistryDependency` for this capability id.

### Separate real skill surfaces (not `skill.invoke`)

- Blueprint role runtime exposes `runtime.skill.invoke(skillId, input)` for `runtime_capability` stage containers (`shared/blueprint/contracts.ts` maps that stage to `["mcp.call", "skill.invoke"]` at the **stage** level, but the SlideRule execute-capability handler does not bridge into role runtime).
- Role-agent `skill.*` tool ids (`skill.code-review`, etc.) route through `tool-proxy-server.ts` / `lite-agent-runtime.ts`.
- `skills/sliderule/sliderule/scripts/*.py` are parity-guard artifacts, not invoked by SlideRule `skill.invoke`.
- UI labels in `shared/blueprint/capability-process-labels.ts` describe `skill.invoke` as a live skill action (`skillName`), but the executor does not perform that action today. Label parsing expects `exec.title` to match `/:\s*(.+)$/`, while the stub returns `{capability_id} via stable RAG` with no skill name suffix.

## Python path detail

### Native LLM gate (rejects `skill.invoke`)

File: `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`

```python
def is_python_native_capability(capability_id: str) -> bool:
    return capability_id in CAPABILITY_PROMPTS or capability_id in STRUCTURED_JSON_CAPABILITIES
```

`skill.invoke` is in neither set. `execute_capability()` raises `UnsupportedCapability` if called directly.

Test evidence: `tws-ai-slide-rule-python/tests/test_capabilities.py` asserts native coverage for 18 capabilities (including `evidence.search`) and does **not** include `skill.invoke`.

### Mapped executor (actual handler)

Files:

- `tws-ai-slide-rule-python/services/capability_maps.py` — maps `"skill.invoke": execute_mcp_or_skill`
- `tws-ai-slide-rule-python/services/slide_rule_executor.py` — shared stub for `mcp.call`, `skill.invoke`, `evidence.search`

Output contract today:

| Field | Value | Meaning |
| --- | --- | --- |
| `title` | `{capability_id} via stable RAG` | Label only; no `skillId:` suffix for UI label parsing |
| `summary` | `检索了外部证据` | Marketing-stable summary, not proof of skill execution |
| `content` | RAG-formatted text | From stub generator |
| `provenance` | `python-rag` | Keyword/stub baseline, **not** `python-llm`, **not** `skill:*` |
| `sources` | keyword hits | From in-memory knowledge base |
| `skillName` | `skill.invoke` when cap is `skill.invoke` | Display metadata only; not a registry skill id |

### Route surfaces

| Route module | Behavior for `skill.invoke` |
| --- | --- |
| `routes/sliderule.py` | Non-native -> `execute_mapped_capability()` |
| `routes/sliderule_full.py` | Same, plus explicit provenance rewrite for tool/evidence caps |

Both routes are thin proxies; neither adds skill registry or script runner code.

### Orchestrator and coverage pressure

- `tws-ai-slide-rule-python/services/slide_rule_orchestrator.py` can pick `skill.invoke` in plan output (`why: "Use skill-style synthesis evidence"`).
- `tws-ai-slide-rule-python/services/slide_rule_coverage.py` requires `mcp.call` and `skill.invoke` for coverage satisfaction.
- `tws-ai-slide-rule-python/tests/test_v5_smoke.py` asserts smoke plans include `skill.invoke`.

These paths treat `skill.invoke` as a required V5 capability id, but they do not verify real skill execution.

## Provenance matrix

| Path | Trigger | Provenance | Real skill? | Count as `python-llm`? |
| --- | --- | --- | --- | --- |
| Python mapped stub | Default Node delegation | `python-rag` | No | No |
| Python native LLM | Not reachable for `skill.invoke` | N/A | No | No |
| Blueprint role runtime | `runtime_capability` stage containers | adapter-specific | Yes (for those containers) | No |
| Role-agent `skill.*` tools | Lite agent / tool proxy | tool-proxy specific | Yes (when registry injected) | No |
| Parity guard scripts | Runtime enablement parity checks | script-specific | Partial (offline gate scripts) | No |
| Node legacy mode | `SLIDERULE_V5_BACKEND=legacy` | error / none | No | No |
| Python delegation failure | Python down | `python-delegated-failed` | No | No |

## Risks

1. **False completion signal:** Node delegation plus `python-rag` provenance can look like migration progress even though no skill registry or script is invoked.
2. **README drift:** `tws-ai-slide-rule-python/README.md` claims "real tool/skill execution" for `mcp.call` / `skill.invoke`. Code evidence contradicts that for `skill.invoke`.
3. **UI label mismatch:** `capability-process-labels.ts` shows live skill-call wording (`正在调用技能 …`) while the backend returns stub evidence and `skillName` defaults to "未命名" because the title lacks a skill suffix.
4. **Coverage gate pressure:** `slide_rule_coverage.py` and shared coverage gates still require `skill.invoke`, so sessions can mark coverage satisfied without external skill evidence.
5. **Conflation with Blueprint skill runtime:** `runtime.skill.invoke()` and `skill.*` tool routing are real paths but use different entry points and capability ids; they must not be rolled into SlideRule `skill.invoke` completion metrics.
6. **Shared stub with `mcp.call`:** Any future `skill.invoke` contract must distinguish skill-specific inputs (`skillId`, directive, artifacts) from generic MCP tool fields.

## What is done vs pending

### Done (narrow, honest)

- Node thin proxy can forward `skill.invoke` to Python execute-capability.
- Python returns a stable V5-shaped payload so sessions do not hard-fail on picker/coverage requirements.
- Python native LLM registry **explicitly excludes** `skill.invoke` (test-locked via 18-cap matrix).
- Node Blueprint skill registry / role runtime stack exists for non-SlideRule-capability use cases.

### Not done (must stay out of native LLM counts)

- Real skill selection, `skillId` resolution, registry lookup, or script invocation inside `skill.invoke`.
- Python skill client or bridge to Node `SkillRegistryDependency` / `runtime.skill.invoke()`.
- Provenance that honestly reports `skill:{skillId}` on success or structured skill failure.
- Contract tests proving skill invocation boundaries (inputs, outputs, allowed degraded shapes).
- Vector/real external retrieval backing skill evidence.

## Can `skill.invoke` count toward Python native LLM completion?

**No.** Rationale with code evidence:

1. `is_python_native_capability("skill.invoke")` is `False` (`capabilities.py`).
2. `test_capabilities.py` native matrix covers 18 caps and omits `skill.invoke`.
3. Actual execution uses `python-rag` stub retrieval/generation via `slide_rule_executor.py`, not `sliderule_llm` model calls.
4. `docs/backend-python-rag-inventory.md` and `docs/sliderule-python-native-capability-audit.md` already classify `skill.invoke` as delegated-but-not-native; this audit **confirms** that judgment.

Delegating to Python is transport migration, not skill runtime migration.

## Recommended next steps (no implementation in this task)

1. **Contract first:** Add a narrow `skill.invoke` contract doc/test defining required inputs (`skillId` or `skillName`, directive, artifact refs), success provenance (`skill:*`), and allowed degraded shapes.
2. **Bridge design:** Decide whether Python calls Node `SkillRegistryDependency` over internal HTTP, whether Node keeps skill execution and Python only synthesizes evidence summaries, or whether `skill.invoke` becomes a thin wrapper around role-runtime `runtime.skill.invoke()`.
3. **Provenance honesty:** Stop rewriting skill caps to `python-rag` once a real or explicit-fallback path exists; surface `skill_not_found` / `skill_registry_not_available` shapes consistent with `tool-proxy-server.ts`.
4. **Separate metrics:** Track `skill.invoke` under skill-runtime migration, not `python-llm` or `python-rag` completion percentages.
5. **Do not expand scope here:** Do not modify `orchestrate-plan.ts`, `pool-json-llm.ts`, or `capabilities.py` in the same slice as runtime implementation.

## Code evidence index

| Claim | Primary evidence |
| --- | --- |
| Node delegates `skill.invoke` in default Python mode | `server/routes/sliderule.ts` (`isPythonV5Cap`, `v5Backend === 'python'`) |
| Not Python native LLM | `tws-ai-slide-rule-python/sliderule_llm/capabilities.py` (`is_python_native_capability`), `tws-ai-slide-rule-python/tests/test_capabilities.py` (18-cap matrix omits `skill.invoke`) |
| Mapped fallback handler | `tws-ai-slide-rule-python/services/capability_maps.py` (`"skill.invoke": execute_mcp_or_skill`), `tws-ai-slide-rule-python/routes/sliderule.py` (`execute_mapped_capability`) |
| Stub RAG execution (no skill registry) | `tws-ai-slide-rule-python/services/slide_rule_executor.py`, `tws-ai-slide-rule-python/services/rag_service.py` |
| Forced `python-rag` provenance on tool caps | `tws-ai-slide-rule-python/routes/sliderule_full.py` (lines 80-82) |
| Node does not call skill registry for `skill.invoke` | `server/routes/sliderule.ts` (delegation branch only; no `skillRegistry` / `runtime.skill` on this cap) |
| Real skill stack exists elsewhere | `server/routes/blueprint/role-agent-runtime/lite-agent-runtime.ts`, `tool-proxy-server.ts`, `role-container-loader/loader.test.ts` |
| Stage maps `skill.invoke` at contract level | `shared/blueprint/contracts.ts` (`runtime_capability: ["mcp.call", "skill.invoke"]`) |
| Legacy Node mode has no `skill.invoke` executor | `server/routes/sliderule.ts` (non-delegated path throws for unhandled caps) |
| Python delegation failure shape | `server/routes/sliderule.ts` (`provenance: 'python-delegated-failed'`, HTTP 502) |
| Coverage still requires `skill.invoke` | `tws-ai-slide-rule-python/services/slide_rule_coverage.py` |
| README overclaims real skill execution | `tws-ai-slide-rule-python/README.md` (contradicted by stub path above) |
| UI labels imply live skill call | `shared/blueprint/capability-process-labels.ts` (`skill.invoke` process labels) |
| Prior inventory agrees: not native LLM | `docs/backend-python-rag-inventory.md`, `docs/sliderule-python-native-capability-audit.md` |

## Verification

Migration queue gate `skillBoundaryAuditGates`:

```powershell
if (!(Test-Path docs/backend-python-skill-invoke-boundary-audit.md)) { throw 'missing docs/backend-python-skill-invoke-boundary-audit.md' }
node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-skill-invoke-boundary-audit.md docs/backend-python-skill-invoke-boundary-audit.md
```

This audit documents boundaries only. It does **not** declare `skill.invoke` fully migrated to Python or to real skill runtime.