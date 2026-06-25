import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VERSION,
  createRuntimeEvent,
  buildQueueStartedEvent,
  buildTaskStartedEvent,
  buildGateResultEvent,
  buildReviewResultEvent,
  buildRunFinalizedEvent,
  isV2Event,
} from '../src/runtimeEvents.js';

test('agentloop node event adapter 110 emits v2 events from runner lifecycle', () => {
  const runId = '2026-06-25T12-00-00-000Z';
  const task = 'agent-loop/tasks/sliderule-agentloop-node-event-adapter-110.md';

  // queue start
  const q = buildQueueStartedEvent({ runId, task, seq: 0 });
  assert.equal(q.version, 'agentloop.event.v2');
  assert.equal(q.source, 'node');
  assert.equal(q.phase, 'queue');
  assert.equal(q.type, 'QUEUE_STARTED');
  assert.equal(q.task, task);
  assert.equal(q.status, 'RUNNING');
  assert.equal(q.seq, 0);
  assert.ok(isV2Event(q));

  // task start
  const t = buildTaskStartedEvent({ runId, task, seq: 1 });
  assert.equal(t.type, 'TASK_STARTED');
  assert.equal(t.phase, 'probe');
  assert.equal(t.source, 'node');
  assert.ok(isV2Event(t));

  // gate result (supports baseline/post variants)
  const g = buildGateResultEvent({
    runId,
    task,
    seq: 2,
    ok: true,
    summary: 'baseline green',
    type: 'BASELINE_GATE_RESULT',
  });
  assert.equal(g.type, 'BASELINE_GATE_RESULT');
  assert.equal(g.phase, 'gate');
  assert.equal(g.payload.ok, true);
  assert.equal(g.payload.summary, 'baseline green');
  assert.ok(isV2Event(g));

  // review result (from runner lifecycle)
  const r = buildReviewResultEvent({
    runId,
    task,
    seq: 3,
    verdict: 'approved',
    source: 'codex',
  });
  assert.equal(r.type, 'REVIEW_RESULT');
  assert.equal(r.phase, 'review');
  assert.equal(r.payload.verdict, 'approved');
  assert.ok(isV2Event(r));

  // run finalize
  const f = buildRunFinalizedEvent({
    runId,
    task,
    seq: 4,
    status: 'DONE',
    artifacts: [{ kind: 'diff', path: 'x.patch' }],
  });
  assert.equal(f.type, 'RUN_FINALIZED');
  assert.equal(f.phase, 'finalize');
  assert.equal(f.payload.status, 'DONE');
  assert.ok(Array.isArray(f.artifacts) && f.artifacts.length === 1);
  assert.ok(isV2Event(f));

  // all are serializable JSON and roundtrip stable (Python envelope compatible shape)
  const events = [q, t, g, r, f];
  for (const ev of events) {
    const json = JSON.stringify(ev);
    const back = JSON.parse(json);
    assert.deepEqual(back, ev);
    assert.equal(back.version, VERSION);
    assert.equal(typeof json, 'string');
  }

  // general builder also produces valid envelope
  const custom = createRuntimeEvent({
    runId,
    seq: 5,
    source: 'node',
    phase: 'gate',
    type: 'GATE_RESULT',
    task,
    payload: { ok: false, summary: 'fail' },
  });
  assert.ok(isV2Event(custom));
  const r2 = JSON.parse(JSON.stringify(custom));
  assert.deepEqual(r2, custom);
});
