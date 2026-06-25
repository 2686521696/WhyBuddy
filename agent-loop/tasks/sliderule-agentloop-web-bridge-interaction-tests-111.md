# SlideRule AgentLoop 111: web bridge interaction tests

## Execution status
- Status: DONE_REVIEWED
- Goal: add behavior-level tests for the main-project AgentLoop browser bridge so the migrated UI is not validated only by helper-level endpoint checks.
- Required gate: `slideruleAgentLoopWebBridgeInteractionTests111Gates`

## Context
The current tests mainly verify exported helpers and a server-side placeholder render. They do not exercise the browser bridge contract between `DashboardApp`, `postCommand`, `window.message`, and the Python-backed adapter behavior. This task should lock the key semantics that were drifting: settings hydration, unsupported secret persistence, cancel placeholder signaling, and artifact-link truth.

## Allowed files
- `client/src/pages/agent-loop/AgentLoopPage.test.tsx`
- `client/src/pages/agent-loop/dashboard/agentLoopApi.ts`
- `client/src/pages/agent-loop/AgentLoopPage.tsx`
- `agent-loop/tasks/sliderule-agentloop-web-bridge-interaction-tests-111.md`
- This task file

## Do not
- Do not only add helper smoke tests.
- Do not depend on live browsers or running workers for this slice.
- Do not assert fake success semantics.
- Do not remove the SSR placeholder test.

## Acceptance criteria
- Add a test named `agentloop web bridge interaction 111 hydrates settings and surfaces unsupported semantics truthfully`.
- Test coverage includes at least: settings hydration through `window.message`, cancel placeholder handling, and truthful artifact or unsupported-action behavior.
- Tests validate user-visible semantics, not only function existence or endpoint strings.
- Existing SSR loading-placeholder coverage remains.
