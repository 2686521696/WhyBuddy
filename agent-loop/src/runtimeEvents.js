export const VERSION = 'agentloop.event.v2';

export function createRuntimeEvent({
  runId,
  seq = 0,
  ts,
  source = 'node',
  phase,
  type,
  task = null,
  status = null,
  payload = {},
  artifacts = [],
  redaction = {},
} = {}) {
  const event = {
    version: VERSION,
    runId: runId != null ? String(runId) : '',
    seq: Number.isInteger(Number(seq)) ? Number(seq) : 0,
    ts: ts != null ? String(ts) : new Date().toISOString(),
    source: String(source),
    phase: String(phase || ''),
    type: String(type || ''),
    task: task != null ? String(task) : null,
    status: status != null ? String(status) : null,
    payload: { ...(payload || {}) },
    artifacts: Array.isArray(artifacts) ? [...artifacts] : [],
    redaction: { ...(redaction || {}) },
  };
  return event;
}

export function buildQueueStartedEvent(opts = {}) {
  const { runId, task, seq = 0, ts, status = 'RUNNING' } = opts;
  return createRuntimeEvent({
    runId,
    seq,
    ts,
    source: 'node',
    phase: 'queue',
    type: 'QUEUE_STARTED',
    task,
    status,
    payload: {},
  });
}

export function buildTaskStartedEvent(opts = {}) {
  const { runId, task, seq = 0, ts } = opts;
  return createRuntimeEvent({
    runId,
    seq,
    ts,
    source: 'node',
    phase: 'probe',
    type: 'TASK_STARTED',
    task,
    payload: {},
  });
}

export function buildGateResultEvent(opts = {}) {
  const { runId, task, seq = 0, ts, ok, summary, phase = 'gate', type = 'GATE_RESULT' } = opts;
  return createRuntimeEvent({
    runId,
    seq,
    ts,
    source: 'node',
    phase,
    type,
    task,
    payload: {
      ok: ok != null ? Boolean(ok) : null,
      summary: summary != null ? String(summary) : null,
    },
  });
}

export function buildReviewResultEvent(opts = {}) {
  const { runId, task, seq = 0, ts, verdict = null, confidence, source = 'node' } = opts;
  const payload = {};
  if (verdict != null) payload.verdict = verdict;
  if (confidence != null) payload.confidence = confidence;
  return createRuntimeEvent({
    runId,
    seq,
    ts,
    source,
    phase: 'review',
    type: 'REVIEW_RESULT',
    task,
    payload,
  });
}

export function buildRunFinalizedEvent(opts = {}) {
  const { runId, task, seq = 0, ts, status = 'DONE', artifacts = [] } = opts;
  return createRuntimeEvent({
    runId,
    seq,
    ts,
    source: 'node',
    phase: 'finalize',
    type: 'RUN_FINALIZED',
    task,
    status,
    payload: { status: status != null ? String(status) : 'DONE' },
    artifacts: Array.isArray(artifacts) ? [...artifacts] : [],
  });
}

export function isV2Event(event) {
  return (
    event != null &&
    event.version === VERSION &&
    typeof event.runId === 'string' &&
    typeof event.seq === 'number' &&
    typeof event.ts === 'string' &&
    typeof event.source === 'string' &&
    typeof event.phase === 'string' &&
    typeof event.type === 'string'
  );
}
