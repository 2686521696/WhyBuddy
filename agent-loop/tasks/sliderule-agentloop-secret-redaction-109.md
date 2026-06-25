# SlideRule AgentLoop 109: secret redaction rescue

## Execution status
- Status: pending
- Goal: rescue the Python AgentLoop redaction layer for commands, logs, settings, and health output after the 108 Grok 403 halt.
- Required gate: `slideruleAgentLoopSecretRedaction109Gates`

## Context
AgentLoop touches provider keys, proxy URLs, bearer tokens, environment variables, command receipts, and worker stderr. The Python control plane must redact before returning anything to the browser or tests.

## Allowed files
- `tws-ai-slide-rule-python/services/agent_loop_redaction.py`
- `tws-ai-slide-rule-python/services/agent_loop_runs.py`
- `tws-ai-slide-rule-python/services/agent_loop_bridge.py`
- `tws-ai-slide-rule-python/services/agent_loop_provider_health.py`
- `tws-ai-slide-rule-python/tests/test_agent_loop_secret_redaction.py`
- `agent-loop/tasks/sliderule-agentloop-secret-redaction-109.md`
- This task file

## Do not
- Do not log raw keys while testing.
- Do not use provider-specific redaction logic in multiple places.
- Do not redact so broadly that normal task ids and run ids disappear.
- Do not store or expose real provider credentials.

## Acceptance criteria
- Add a test named `agentloop secret redaction 109 masks keys tokens proxy credentials and env output`.
- Redaction covers API keys, bearer tokens, proxy credentials, env lines, command receipts, and health output.
- Redaction helper is reused by run readers, bridge receipts, and provider health.
- Tests prove raw secret samples never appear in JSON responses.
