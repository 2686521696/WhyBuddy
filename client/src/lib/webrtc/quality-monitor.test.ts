/**
 * Unit tests for QualityMonitor.
 *
 * Tests stats collection (Task 5.1) and auto quality adjustment (Task 5.2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QualityMonitor } from './quality-monitor';
import type { QualityMetrics, QualityMonitorConfig } from './quality-monitor';
import type { QualityLevel } from './types';

// ---------------------------------------------------------------------------
// Mock connection manager
// ---------------------------------------------------------------------------

function createMockManager(statsFactory?: () => RTCStatsReport) {
  const setQualityCalls: QualityLevel[] = [];

  const manager = {
    getStats: vi.fn(async () => {
      if (statsFactory) return statsFactory();
      return new Map() as unknown as RTCStatsReport;
    }),
    setQuality: vi.fn((q: QualityLevel) => {
      setQualityCalls.push(q);
    }),
    _setQualityCalls: setQualityCalls,
  };

  return manager as any;
}

/** Build a fake RTCStatsReport with given fps, rtt, and bytes. */
function buildStatsReport(opts: {
  fps?: number;
  rtt?: number;
  bytesReceived?: number;
  timestamp?: number;
}): RTCStatsReport {
  const entries: [string, any][] = [];

  entries.push([
    'inbound-rtp-video',
    {
      type: 'inbound-rtp',
      kind: 'video',
      framesPerSecond: opts.fps ?? 0,
      bytesReceived: opts.bytesReceived ?? 0,
      timestamp: opts.timestamp ?? Date.now(),
    },
  ]);

  if (opts.rtt != null) {
    entries.push([
      'candidate-pair-1',
      {
        type: 'candidate-pair',
        state: 'succeeded',
        currentRoundTripTime: opts.rtt / 1_000, // ms → seconds
      },
    ]);
  }

  const map = new Map(entries);
  return map as unknown as RTCStatsReport;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QualityMonitor', () => {
  describe('lifecycle', () => {
    it('starts in stopped state', () => {
      const manager = createMockManager();
      const monitor = new QualityMonitor(manager);
      expect(monitor.isRunning).toBe(false);
    });

    it('starts and stops polling', () => {
      const manager = createMockManager();
      const monitor = new QualityMonitor(manager);

      monitor.start();
      expect(monitor.isRunning).toBe(true);

      monitor.stop();
      expect(monitor.isRunning).toBe(false);
    });

    it('does not double-start', () => {
      const manager = createMockManager();
      const monitor = new QualityMonitor(manager);

      monitor.start();
      monitor.start(); // Should be a no-op
      expect(monitor.isRunning).toBe(true);

      monitor.destroy();
    });

    it('defaults to high quality', () => {
      const manager = createMockManager();
      const monitor = new QualityMonitor(manager);
      expect(monitor.currentQuality).toBe('high');
    });
  });

  describe('stats collection (Task 5.1)', () => {
    it('extracts fps from inbound-rtp stats', async () => {
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 30, timestamp: 1000 }),
      );

      const collectedMetrics: QualityMetrics[] = [];
      const monitor = new QualityMonitor(manager, {
        onMetrics: (m) => collectedMetrics.push({ ...m }),
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(collectedMetrics.length).toBeGreaterThanOrEqual(1);
      expect(collectedMetrics[0].fps).toBe(30);

      monitor.destroy();
    });

    it('extracts rtt from candidate-pair stats', async () => {
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 30, rtt: 50, timestamp: 1000 }),
      );

      const collectedMetrics: QualityMetrics[] = [];
      const monitor = new QualityMonitor(manager, {
        onMetrics: (m) => collectedMetrics.push({ ...m }),
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(collectedMetrics[0].rtt).toBe(50);

      monitor.destroy();
    });

    it('calculates bitrate from byte deltas', async () => {
      let callCount = 0;
      const manager = createMockManager(() => {
        callCount++;
        // First call: 0 bytes at t=1000
        // Second call: 125000 bytes at t=2000 → 1Mbps
        return buildStatsReport({
          fps: 30,
          bytesReceived: callCount === 1 ? 0 : 125_000,
          timestamp: callCount === 1 ? 1000 : 2000,
        });
      });

      const collectedMetrics: QualityMetrics[] = [];
      const monitor = new QualityMonitor(manager, {
        onMetrics: (m) => collectedMetrics.push({ ...m }),
      });

      monitor.start();

      // First poll
      await vi.advanceTimersByTimeAsync(2_000);
      // Second poll
      await vi.advanceTimersByTimeAsync(2_000);

      // First poll has no previous data, so bitrate = 0
      expect(collectedMetrics[0].bitrate).toBe(0);
      // Second poll should have calculated bitrate
      expect(collectedMetrics[1].bitrate).toBe(1_000_000); // 125000 bytes * 8 / 1 second

      monitor.destroy();
    });

    it('uses configurable polling interval', async () => {
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 30, timestamp: Date.now() }),
      );

      const monitor = new QualityMonitor(manager, {}, { pollingInterval: 500 });

      monitor.start();
      await vi.advanceTimersByTimeAsync(1_500);

      // With 500ms interval, should have polled ~3 times in 1500ms
      expect(manager.getStats).toHaveBeenCalledTimes(3);

      monitor.destroy();
    });

    it('silently skips poll when getStats throws', async () => {
      const manager = createMockManager();
      manager.getStats.mockRejectedValue(new Error('No active peer connection'));

      const monitor = new QualityMonitor(manager);

      monitor.start();
      // Should not throw
      await vi.advanceTimersByTimeAsync(2_000);

      expect(monitor.isRunning).toBe(true);
      monitor.destroy();
    });
  });

  describe('auto quality adjustment (Task 5.2)', () => {
    const fastConfig: QualityMonitorConfig = {
      pollingInterval: 100,
      downgradeSamples: 3,
      upgradeSamples: 5,
      downgradeThreshold: 20,
      upgradeThreshold: 25,
    };

    it('downgrades quality after consecutive low-fps samples', async () => {
      // Always return 15 fps (below downgrade threshold of 20)
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 15, timestamp: Date.now() }),
      );

      const qualityChanges: QualityLevel[] = [];
      const monitor = new QualityMonitor(
        manager,
        { onQualityChange: (q) => qualityChanges.push(q) },
        fastConfig,
      );

      expect(monitor.currentQuality).toBe('high');

      monitor.start();

      // Need 3 consecutive low-fps samples to trigger downgrade
      await vi.advanceTimersByTimeAsync(100 * 4);

      expect(qualityChanges).toContain('medium');
      expect(monitor.currentQuality).toBe('medium');

      monitor.destroy();
    });

    it('downgrades from medium to low on continued low fps', async () => {
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 10, timestamp: Date.now() }),
      );

      const qualityChanges: QualityLevel[] = [];
      const monitor = new QualityMonitor(
        manager,
        { onQualityChange: (q) => qualityChanges.push(q) },
        fastConfig,
      );

      monitor.start();

      // First downgrade: high → medium (3 samples)
      await vi.advanceTimersByTimeAsync(100 * 4);
      expect(monitor.currentQuality).toBe('medium');

      // Second downgrade: medium → low (3 more samples)
      await vi.advanceTimersByTimeAsync(100 * 4);
      expect(monitor.currentQuality).toBe('low');

      monitor.destroy();
    });

    it('does not downgrade below low', async () => {
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 5, timestamp: Date.now() }),
      );

      const qualityChanges: QualityLevel[] = [];
      const monitor = new QualityMonitor(
        manager,
        { onQualityChange: (q) => qualityChanges.push(q) },
        fastConfig,
      );

      monitor.start();

      // Downgrade to low
      await vi.advanceTimersByTimeAsync(100 * 10);

      // Should have gone high → medium → low, but not further
      expect(monitor.currentQuality).toBe('low');
      const lowCount = qualityChanges.filter((q) => q === 'low').length;
      expect(lowCount).toBe(1);

      monitor.destroy();
    });

    it('upgrades quality after consecutive high-fps samples', async () => {
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 30, timestamp: Date.now() }),
      );

      const qualityChanges: QualityLevel[] = [];
      const monitor = new QualityMonitor(
        manager,
        { onQualityChange: (q) => qualityChanges.push(q) },
        fastConfig,
      );

      // Start at low quality
      monitor.setQuality('low');
      expect(monitor.currentQuality).toBe('low');

      monitor.start();

      // Need 5 consecutive high-fps samples to trigger upgrade
      await vi.advanceTimersByTimeAsync(100 * 6);

      expect(qualityChanges).toContain('medium');
      expect(monitor.currentQuality).toBe('medium');

      monitor.destroy();
    });

    it('does not upgrade above high', async () => {
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 60, timestamp: Date.now() }),
      );

      const qualityChanges: QualityLevel[] = [];
      const monitor = new QualityMonitor(
        manager,
        { onQualityChange: (q) => qualityChanges.push(q) },
        fastConfig,
      );

      // Already at high
      expect(monitor.currentQuality).toBe('high');

      monitor.start();
      await vi.advanceTimersByTimeAsync(100 * 10);

      // Should not have emitted any quality change
      expect(qualityChanges).toHaveLength(0);

      monitor.destroy();
    });

    it('resets counters when fps is in the dead zone', async () => {
      let fps = 15; // Start low
      const manager = createMockManager(() =>
        buildStatsReport({ fps, timestamp: Date.now() }),
      );

      const qualityChanges: QualityLevel[] = [];
      const monitor = new QualityMonitor(
        manager,
        { onQualityChange: (q) => qualityChanges.push(q) },
        fastConfig,
      );

      monitor.start();

      // 2 low-fps samples (not enough for downgrade)
      await vi.advanceTimersByTimeAsync(100 * 2);

      // Switch to dead zone (between 20 and 25)
      fps = 22;
      await vi.advanceTimersByTimeAsync(100);

      // Back to low fps — counter should have been reset
      fps = 15;
      await vi.advanceTimersByTimeAsync(100 * 2);

      // Should NOT have downgraded yet (only 2 consecutive, not 3)
      expect(qualityChanges).toHaveLength(0);

      monitor.destroy();
    });

    it('applies quality to connection manager on downgrade', async () => {
      const manager = createMockManager(() =>
        buildStatsReport({ fps: 10, timestamp: Date.now() }),
      );

      const monitor = new QualityMonitor(manager, {}, fastConfig);

      monitor.start();
      await vi.advanceTimersByTimeAsync(100 * 4);

      expect(manager.setQuality).toHaveBeenCalledWith('medium');

      monitor.destroy();
    });

    it('setQuality resets counters and applies to manager', () => {
      const manager = createMockManager();
      const monitor = new QualityMonitor(manager);

      monitor.setQuality('low');

      expect(monitor.currentQuality).toBe('low');
      expect(manager.setQuality).toHaveBeenCalledWith('low');
    });
  });
});
