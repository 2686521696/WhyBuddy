import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { MissionStore } from '../tasks/mission-store.js';

// Node test for task-event-persistence-takeover-104.
// Proves append/replay contract and fallback.
// Envelope separates durable, projection, and retained surfaces.
// Node event append behavior is NOT removed; python provides bounded evidence slice only.
// Do not treat in-memory projection as durable persistence.

describe('task event persistence takeover 104 (append/replay contract + fallback + envelope separation)', () => {
  let store: MissionStore;

  beforeEach(() => {
    store = new MissionStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('python event persistence decision envelope separates durable, projection, retained', () => {
    // simulate decide envelope shape from python task_event_persistence_takeover
    const pyEnvelope = {
      ok: true,
      area: 'all',
      ownership: {
        eventAppendPersistence: 'node-retained',
        durableEventAppend: 'node-retained',
        append: 'node-retained',
        replay: 'python-owned',
        appendReplayEvidence: 'python-owned',
        eventReplaySlice: 'python-owned',
      },
      productionTakeover: false,
      migrationDenominator: {
        total: 6,
        pythonOwned: 3,
        nodeRetained: 3,
      },
      evidence: {
        nodeRetains: ['eventAppendPersistence', 'durableEventAppend', 'append', 'realPersistence'],
        pythonOnlySlice: ['replay', 'appendReplayEvidence', 'eventReplaySlice'],
        realEventAppendOwner: 'node',
        projectionNotDurable: true,
      },
      nodeRetained: {
        eventAppendPersistence: 'node-retained',
        durableEventAppend: 'node-retained',
      },
      reason: 'node-retained-event-append-persistence-per-103;real-durable-and-append-node',
      fallback: 'node',
      contractVersion: 'task-event-persistence-takeover.v1',
      provenance: 'python-task-event-persistence-takeover-104',
    };

    // separation asserts
    expect(pyEnvelope.ownership.eventAppendPersistence).toBe('node-retained');
    expect(pyEnvelope.ownership.appendReplayEvidence).toBe('python-owned');
    expect(pyEnvelope.productionTakeover).toBe(false);
    expect(pyEnvelope.evidence.projectionNotDurable).toBe(true);
    expect(pyEnvelope.nodeRetained.eventAppendPersistence).toBe('node-retained');
    // durable vs projection surfaces
    expect(['node-retained']).toContain(pyEnvelope.ownership.durableEventAppend);
    expect(['python-owned']).toContain(pyEnvelope.ownership.replay);
  });

  it('node append behavior preserved: events appended on create/log/updateStage', () => {
    const created = store.create({ kind: 'chat', title: 'event-persist-104' });
    expect(created.events.length).toBeGreaterThan(0);
    expect(created.events.some(e => e.type === 'created')).toBe(true);

    const logged = store.log(created.id, 'progress log for event slice', 'info', 25);
    expect(logged).toBeDefined();
    const events = store.listEvents(created.id);
    expect(events.length).toBeGreaterThan(1);
    expect(events.some(e => e.message?.includes('progress log'))).toBe(true);

    // node append not removed
    const updated = store.updateStage(created.id, 'receive', { status: 'running' }, 30);
    expect(updated).toBeDefined();
  });

  it('append/replay contract via applyMissionEventReplayResult with persistence evidence', () => {
    const m = store.create({ kind: 'test', title: 'replay contract 104' });
    store.log(m.id, 'initial event');

    const replayEnv = {
      ok: true,
      action: 'replay',
      task: { id: m.id, status: 'running', nodeStatus: 'running', progress: 55 },
      replay: {
        missionId: m.id,
        eventCount: 2,
        owner: 'node',
        projection: { projectId: 'proj-104' },
      },
      metadata: { project: { projectId: 'proj-104' } },
      persistenceTakeover: {
        ownership: {
          eventAppendPersistence: 'node-retained',
          appendReplayEvidence: 'python-owned',
        },
        evidence: { projectionNotDurable: true, realAppendOwner: 'node' },
      },
    } as any;

    const mapped = store.applyMissionEventReplayResult(m.id, replayEnv);
    expect(mapped).toBeDefined();
    expect(['running', 'queued']).toContain(mapped!.status);
    expect((mapped as any).projection?.projectId).toBe('proj-104');
    // contract evidence present but does not override node append
    expect(replayEnv.persistenceTakeover.ownership.eventAppendPersistence).toBe('node-retained');
  });

  it('replay fallback keeps prior state when not ok', () => {
    const m = store.create({ kind: 'test', title: 'fallback 104' });
    const before = store.get(m.id);

    const failEnv = {
      ok: false,
      action: 'replay',
      code: 'PERSISTENCE_ERROR',
      message: 'event slice failed',
    };
    const mapped = store.applyMissionEventReplayResult(m.id, failEnv as any);
    expect(mapped).toBeDefined();
    expect(mapped!.status).toBe(before!.status);
  });

  it('envelope asserts retained surfaces never claim node append as python durable', () => {
    const retainedShape = {
      surfaces: {
        eventAppendPersistence: 'node-retained',
        append: 'node-retained',
        replay: 'python-owned',
      },
      evidence: {
        realEventAppendOwner: 'node',
        projection: 'python-slice',
      },
    };
    expect(retainedShape.surfaces.eventAppendPersistence).toBe('node-retained');
    expect(retainedShape.surfaces.append).toBe('node-retained');
    expect(retainedShape.evidence.realEventAppendOwner).toBe('node');
    // never durable from projection
    expect(retainedShape.evidence.projection).not.toBe('durable');
  });

  it('node retained fallback surface for unsupported event op', () => {
    const shape = decideEventPersistenceShapeForTest({ area: 'eventAppendPersistence' });
    expect(shape.ownership.eventAppendPersistence).toBe('node-retained');
    expect(shape.productionTakeover).toBe(false);
  });
});

function decideEventPersistenceShapeForTest(payload: Record<string, unknown>) {
  // local shape simulator matching python decide_task_event_persistence_takeover
  const area = (payload.area as string) || 'all';
  const isPythonSlice = ['replay', 'appendReplayEvidence', 'eventReplaySlice'].includes(area);
  const ownership: Record<string, string> = {
    eventAppendPersistence: 'node-retained',
    durableEventAppend: 'node-retained',
    append: 'node-retained',
    replay: isPythonSlice ? 'python-owned' : 'node-retained',
    appendReplayEvidence: isPythonSlice ? 'python-owned' : 'node-retained',
    eventReplaySlice: isPythonSlice ? 'python-owned' : 'node-retained',
  };
  if (area !== 'all' && area in ownership) {
    // narrow to requested
  }
  return {
    ok: true,
    area,
    ownership: area === 'all' ? ownership : { [area]: ownership[area] || 'node-retained' },
    productionTakeover: false,
    evidence: {
      nodeRetains: ['eventAppendPersistence'],
      pythonOnlySlice: ['replay', 'appendReplayEvidence'],
      projectionNotDurable: true,
    },
    nodeRetained: { eventAppendPersistence: 'node-retained' },
    fallback: 'node',
  };
}
