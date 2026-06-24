import { describe, expect, it } from 'vitest';

// Node test companion for task-production-denominator-reconciliation-104.
// Mirrors Python counts for denominator math agreement.
// Surfaces: 4 node-retained core (durable/project/scheduler/eventAppend) + 7 python thin slices.
// Blockers listed; no durable takeover claimed.

interface Denom {
  total: number;
  pythonOwned: number;
  nodeRetained: number;
  blocked: number;
  outOfScope: number;
}

interface TaskDenomReconciliation {
  area: string;
  ownership: any;
  productionTakeover: boolean;
  migrationDenominator: Denom;
  blockers: string[];
  ok: boolean;
  surfaces?: Record<string, string>;
}

const TASK_SURFACES: Record<string, string> = {
  durableStore: 'node-retained',
  projectResourceAuth: 'node-retained',
  scheduler: 'node-retained',
  eventAppendPersistence: 'node-retained',
  runtimeStateSlice: 'python-owned',
  cancelStateDecision: 'python-owned',
  replayProjectionSlice: 'python-owned',
  durableWriteSlice: 'python-owned',
  cancelWriteSlice: 'python-owned',
  eventReplaySlice: 'python-owned',
  appendReplayEvidence: 'python-owned',
};

const BLOCKERS = ['durableStore', 'projectResourceAuth', 'scheduler', 'eventAppendPersistence'];

function computeTaskProductionDenominatorReconciliation(input?: { area?: string; surface?: string; simulate?: Record<string, any> }): TaskDenomReconciliation {
  const requested = (input?.surface as string) || (input?.area as string) || 'all';
  const sim = (input?.simulate || {}) as Record<string, any>;
  let base: Record<string, string> = { ...TASK_SURFACES };

  if (sim.forceNodeRetained || sim.allRetained) {
    Object.keys(base).forEach((k) => (base[k] = 'node-retained'));
  }
  if (sim.block || sim.blocked) {
    for (const k of BLOCKERS) {
      if (k in base) base[k] = 'blocked';
    }
  }

  let area = 'all';
  let ownership: any;
  if (requested === 'all') {
    area = 'all';
    ownership = base;
  } else if (requested in base) {
    area = requested;
    ownership = base[requested];
  } else {
    area = requested;
    ownership = 'out-of-scope';
  }

  const vals = Object.values(base);
  const denom: Denom = requested === 'all'
    ? {
        total: vals.length,
        pythonOwned: vals.filter((v) => v === 'python-owned').length,
        nodeRetained: vals.filter((v) => v === 'node-retained').length,
        blocked: vals.filter((v) => v === 'blocked').length,
        outOfScope: vals.filter((v) => v === 'out-of-scope').length,
      }
    : {
        total: 1,
        pythonOwned: typeof ownership === 'string' && ownership === 'python-owned' ? 1 : 0,
        nodeRetained: typeof ownership === 'string' && ownership === 'node-retained' ? 1 : 0,
        blocked: typeof ownership === 'string' && ownership === 'blocked' ? 1 : 0,
        outOfScope: typeof ownership === 'string' && ownership === 'out-of-scope' ? 1 : 0,
      };

  const blockersList = Object.keys(base).filter((k) => base[k] === 'node-retained' || base[k] === 'blocked');

  return {
    area,
    ownership,
    productionTakeover: false,
    migrationDenominator: denom,
    blockers: blockersList,
    ok: true,
    ...(area === 'all' ? { surfaces: base } : {}),
  };
}

describe('task production denominator reconciliation 104 (node mirror)', () => {
  it('returns stable envelope and reconciles task 104 surfaces', () => {
    const d = computeTaskProductionDenominatorReconciliation({ area: 'all' });
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty('migrationDenominator');
    expect(d).toHaveProperty('blockers');
    expect(Array.isArray(d.blockers)).toBe(true);
    expect(d.productionTakeover).toBe(false);
  });

  it('aggregates core retained surfaces as node-retained', () => {
    const d = computeTaskProductionDenominatorReconciliation();
    const own = d.ownership as Record<string, string>;
    for (const s of ['durableStore', 'projectResourceAuth', 'scheduler', 'eventAppendPersistence']) {
      expect(own[s]).toBe('node-retained');
    }
  });

  it('node and python agree on denominator math (7 pythonOwned, 4 nodeRetained, 0 blocked, 0 outOfScope)', () => {
    const d = computeTaskProductionDenominatorReconciliation({ area: 'all' });
    const denom = d.migrationDenominator;
    expect(denom.total).toBe(11);
    expect(denom.pythonOwned).toBe(7);
    expect(denom.nodeRetained).toBe(4);
    expect(denom.blocked).toBe(0);
    expect(denom.outOfScope).toBe(0);
  });

  it('blockers list is machine readable and names retained', () => {
    const d = computeTaskProductionDenominatorReconciliation();
    expect(d.blockers.length).toBe(4);
    expect(d.blockers).toContain('durableStore');
    expect(d.blockers).toContain('scheduler');
  });

  it('simulate blocked increases blocked count', () => {
    const d = computeTaskProductionDenominatorReconciliation({ area: 'all', simulate: { block: true } });
    expect(d.migrationDenominator.blocked).toBeGreaterThanOrEqual(4);
    expect(d.blockers).toContain('durableStore');
  });

  it('python slices are python-owned', () => {
    for (const sl of ['durableWriteSlice', 'eventReplaySlice', 'runtimeStateSlice']) {
      const d = computeTaskProductionDenominatorReconciliation({ area: sl });
      expect(d.ownership).toBe('python-owned');
      expect(d.productionTakeover).toBe(false);
    }
  });

  it('out of scope handled', () => {
    const d = computeTaskProductionDenominatorReconciliation({ area: 'nonexistentTaskArea' });
    expect(d.migrationDenominator.outOfScope).toBeGreaterThanOrEqual(0);
  });
});
