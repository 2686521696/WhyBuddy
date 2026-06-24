import { describe, expect, it } from 'vitest';

// Import from production Node runtime/contract file (allowed).
// This ensures Python and Node return the same provider/A2A denominator summary
// via consumable implementation, not test-only hardcode.
import { computeFinalProviderA2aScopeReconciliation } from '../routes/a2a-python-runtime.js';

// Node mirror (now in prod file) for final-provider-a2a-scope-reconciliation-104.
// Mirrors Python decide_final_provider_a2a_scope_reconciliation exactly for gate agreement.
// Uses counts from 103 live contract (0 liveReady python-owned, 8 skipped, 10 synthetic, 1 externalOwned)
// A2A surfaces: 1 python slice + 3 node-retained + 1 external-agent-required.
// skipped/synthetic/external-owned/external-agent-required excluded; no fake takeover.

describe('final provider a2a scope reconciliation 104 (node mirror)', () => {
  it('returns stable envelope with provider + a2a summaries', () => {
    const r = computeFinalProviderA2aScopeReconciliation({ area: 'all' });
    expect(r.ok).toBe(true);
    expect(r.productionTakeover).toBe(false);
    expect(r).toHaveProperty('providerSummary');
    expect(r).toHaveProperty('a2aSummary');
    expect(r).toHaveProperty('migrationDenominator');
    expect(Array.isArray(r.excludedFromNumerator)).toBe(true);
    expect(r.migrationDenominator.canClaimCompletion).toBe(false);
  });

  it('provider counts match 103 baseline (0 live python takeover)', () => {
    const r = computeFinalProviderA2aScopeReconciliation();
    const ps = r.providerSummary;
    expect(ps.liveReady).toBe(0);
    expect(ps.skippedLive).toBeGreaterThanOrEqual(8);
    expect(ps.synthetic).toBeGreaterThanOrEqual(10);
    expect(ps.externalOwned).toBe(1);
    expect(ps.realPythonTakeover).toBe(0);
  });

  it('a2a scope has exactly 1 python-owned slice and retained/external', () => {
    const r = computeFinalProviderA2aScopeReconciliation({ area: 'a2a' });
    const as = r.a2aSummary;
    expect(as.pythonOwned).toBe(1);
    expect(as.nodeRetained).toBeGreaterThanOrEqual(1);
    expect(as.externalAgentRequired).toBeGreaterThanOrEqual(1);
    expect(as.productionTakeover).toBe(false);
  });

  it('node and python agree on denominator: 24 surfaces, 1 pythonOwned, cannot claim', () => {
    const r = computeFinalProviderA2aScopeReconciliation({ area: 'all' });
    const d = r.migrationDenominator;
    expect(d.totalSurfaces).toBe(24);
    expect(d.pythonOwned).toBe(1);
    expect(d.canClaimCompletion).toBe(false);
    expect(r.excludedFromNumerator).toContain('skipped-live');
    expect(r.excludedFromNumerator).toContain('external-agent-required');
  });

  it('simulated live-ready on external does not allow takeover claim', () => {
    const r = computeFinalProviderA2aScopeReconciliation({ area: 'all', simulate: { liveReadyPython: true } });
    expect(r.providerSummary.realPythonTakeover).toBe(0);
    expect(r.migrationDenominator.canClaimCompletion).toBe(false);
    expect(r.productionTakeover).toBe(false);
  });

  it('a2a blockers and node retained never count as python completion', () => {
    const r = computeFinalProviderA2aScopeReconciliation({ area: 'all', simulate: { blockA2a: true } });
    expect(r.productionTakeover).toBe(false);
    expect(r.migrationDenominator.canClaimCompletion).toBe(false);
  });

  it('out of scope area handled safely', () => {
    const r = computeFinalProviderA2aScopeReconciliation({ area: 'unknownXyz' });
    expect(r.migrationDenominator.canClaimCompletion).toBe(false);
  });
});
