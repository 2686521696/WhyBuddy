# SlideRule AgentLoop 110: Node event adapter

## Execution status
- Status: pending
- Goal: add a Node-side event adapter that can emit v2 runtime events without removing the current runner.
- Required gate: `slideruleAgentLoopNodeEventAdapter110Gates`

## Context
Node remains the mutation owner in the bridge phase. The v2 migration needs a narrow adapter so run-queue and loop lifecycle points can emit normalized events later without broad runner rewrites.

## Allowed files
- `agent-loop/src/runtimeEvents.js`
- `agent-loop/src/runQueue.js`
- `agent-loop/src/loop.js`
- `agent-loop/test/runtime-event-adapter.test.js`
- `agent-loop/tasks/sliderule-agentloop-node-event-adapter-110.md`
- This task file

## Do not
- Do not remove existing `state.json` writes.
- Do not change worker prompts.
- Do not change queue scheduling semantics.
- Do not write Python code in this task.

## Acceptance criteria
- Add a Node test named `agentloop node event adapter 110 emits v2 events from runner lifecycle`.
- Adapter can build v2 events for queue start, task start, gate result, review result, and run finalize.
- Events are serializable JSON and compatible with the Python envelope.
- Existing queue tests continue to pass.
