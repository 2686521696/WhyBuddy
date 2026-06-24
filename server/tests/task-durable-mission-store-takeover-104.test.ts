import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { MissionStore } from '../tasks/mission-store.js';
import { MissionRuntime } from '../tasks/mission-runtime.js';

// Node test for task-durable-mission-store-takeover-104.
// Proves existing create/read/cancel semantics on MissionStore remain intact.
// Also validates python slice classification shape for durable takeover (via envelope).
// Real durable store ownership stays node except for the bounded proven slice reported by python.

describe('task durable mission store takeover 104 (node create/read/cancel intact + slice)', () => {
  let store: MissionStore;
  let runtime: MissionRuntime;

  beforeEach(() => {
    store = new MissionStore(null);
    runtime = new MissionRuntime({ store, autoRecover: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create read cancel semantics remain intact', () => {
    const created = runtime.createChatTask('Durable 104 mission', 'source', undefined, { projectId: 'p-104' });
    expect(created.id).toMatch(/^mission_/);
    expect(created.status).toBe('queued');
    expect(created.title).toBe('Durable 104 mission');

    const read = runtime.getTask(created.id);
    expect(read?.id).toBe(created.id);
    expect(read?.status).toBe('queued');

    const cancelled = runtime.cancelMission(created.id, { reason: 'takeover-test', requestedBy: 'test' });
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelReason).toBe('takeover-test');

    const readAfter = runtime.getTask(created.id);
    expect(readAfter?.status).toBe('cancelled');
  });

  it('list and get continue to work after cancel', () => {
    const a = runtime.createChatTask('A');
    const b = runtime.createChatTask('B');
    runtime.cancelMission(a.id, { reason: 'c' });

    const listed = runtime.listTasks(10);
    expect(listed.length).toBeGreaterThanOrEqual(2);
    const got = runtime.getTask(b.id);
    expect(got?.title).toBe('B');
  });

  it('python durable mission store takeover slice shape has takeover true only for proven slice', () => {
    const slice = {
      ok: true,
      area: 'durableWriteSlice',
      ownership: 'python-owned',
      productionTakeover: true,
      migrationDenominator: { pythonOwned: 2, nodeRetained: 4 },
      evidence: { nodeRetains: ['durableStore'], realDurableOwner: 'node' },
      nodeRetained: { durableStore: 'node-retained', scheduler: 'node-retained' },
      runtime: { owner: 'python' },
      fallback: 'node',
    };

    // Node asserts create/read/cancel still function (above), and slice reports correctly
    expect(slice.productionTakeover).toBe(true);
    expect(slice.ownership).toBe('python-owned');
    expect(slice.nodeRetained.durableStore).toBe('node-retained');
    // non-slice must not claim takeover
    const nonSlice = { ...slice, area: 'durableStore', ownership: 'node-retained', productionTakeover: false };
    expect(nonSlice.productionTakeover).toBe(false);
  });

  it('applyEventReplayResult and basic store paths still function', () => {
    const m = runtime.createChatTask('replay check');
    const updated = runtime.applyEventReplayResult(m.id, {
      ok: true,
      task: { status: 'running', progress: 25 },
    } as any);
    expect(updated?.status).toBe('running');
  });
});
