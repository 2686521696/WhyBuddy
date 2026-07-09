/**
 * Quality Monitor for WebRTC video streams.
 *
 * Periodically polls RTCStatsReport via the connection manager to extract
 * framerate, round-trip time, and bitrate metrics. Implements automatic
 * quality adjustment with hysteresis to prevent rapid oscillation.
 *
 * Tasks 5.1 & 5.2 of the ue-video-stream-player spec.
 */

import type { WebRTCConnectionManager } from './connection-manager';
import type { QualityLevel } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Real-time metrics extracted from RTCStatsReport. */
export interface QualityMetrics {
  /** Current video framerate (frames per second). */
  fps: number;
  /** Round-trip time in milliseconds. */
  rtt: number;
  /** Estimated inbound bitrate in bits per second. */
  bitrate: number;
}

/** Events emitted by the quality monitor. */
export interface QualityMonitorEvents {
  /** Called whenever new metrics are collected. */
  onMetrics?: (metrics: QualityMetrics) => void;
  /** Called when the auto-adjustment algorithm changes quality. */
  onQualityChange?: (quality: QualityLevel) => void;
}

/** Configuration for the quality monitor. */
export interface QualityMonitorConfig {
  /** Polling interval in milliseconds. @default 2000 */
  pollingInterval?: number;
  /** FPS threshold below which quality is downgraded. @default 20 */
  downgradeThreshold?: number;
  /** FPS threshold above which quality is upgraded. @default 25 */
  upgradeThreshold?: number;
  /** Consecutive low-FPS samples required before downgrade. @default 3 */
  downgradeSamples?: number;
  /** Consecutive high-FPS samples required before upgrade. @default 5 */
  upgradeSamples?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLLING_INTERVAL = 2_000;
const DEFAULT_DOWNGRADE_THRESHOLD = 20;
const DEFAULT_UPGRADE_THRESHOLD = 25;
const DEFAULT_DOWNGRADE_SAMPLES = 3;
const DEFAULT_UPGRADE_SAMPLES = 5;

/** Quality levels ordered from lowest to highest. */
const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high'];

// ---------------------------------------------------------------------------
// QualityMonitor
// ---------------------------------------------------------------------------

export class QualityMonitor {
  private manager: WebRTCConnectionManager;
  private events: QualityMonitorEvents;
  private config: Required<QualityMonitorConfig>;

  // -- Polling state --
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;

  // -- Current metrics --
  private _metrics: QualityMetrics = { fps: 0, rtt: 0, bitrate: 0 };

  // -- Previous stats for delta calculations --
  private prevBytesReceived = 0;
  private prevTimestamp = 0;

  // -- Auto quality state --
  private _currentQuality: QualityLevel = 'high';
  private lowFpsCount = 0;
  private highFpsCount = 0;

  constructor(
    manager: WebRTCConnectionManager,
    events: QualityMonitorEvents = {},
    config: QualityMonitorConfig = {},
  ) {
    this.manager = manager;
    this.events = events;
    this.config = {
      pollingInterval: config.pollingInterval ?? DEFAULT_POLLING_INTERVAL,
      downgradeThreshold:
        config.downgradeThreshold ?? DEFAULT_DOWNGRADE_THRESHOLD,
      upgradeThreshold: config.upgradeThreshold ?? DEFAULT_UPGRADE_THRESHOLD,
      downgradeSamples: config.downgradeSamples ?? DEFAULT_DOWNGRADE_SAMPLES,
      upgradeSamples: config.upgradeSamples ?? DEFAULT_UPGRADE_SAMPLES,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Whether the monitor is actively polling. */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Latest collected metrics. */
  get metrics(): QualityMetrics {
    return { ...this._metrics };
  }

  /** Current quality level determined by the auto-adjustment algorithm. */
  get currentQuality(): QualityLevel {
    return this._currentQuality;
  }

  /** Start periodic stats collection and auto quality adjustment. */
  start(): void {
    if (this._isRunning) return;
    this._isRunning = true;
    this.resetCounters();
    this.pollingTimer = setInterval(
      () => this.poll(),
      this.config.pollingInterval,
    );
  }

  /** Stop polling and reset internal counters. */
  stop(): void {
    if (!this._isRunning) return;
    this._isRunning = false;
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.resetCounters();
  }

  /**
   * Manually set the quality level. Resets auto-adjustment counters
   * so the algorithm starts fresh from this level.
   */
  setQuality(quality: QualityLevel): void {
    this._currentQuality = quality;
    this.resetCounters();
    this.manager.setQuality(quality);
  }

  /** Release resources. */
  destroy(): void {
    this.stop();
  }

  // ---------------------------------------------------------------------------
  // Stats collection (Task 5.1)
  // ---------------------------------------------------------------------------

  /** Single poll cycle: collect stats and run auto-adjustment. */
  private async poll(): Promise<void> {
    try {
      const report = await this.manager.getStats();
      this.extractMetrics(report);
      this.events.onMetrics?.(this.metrics);
      this.evaluateQuality();
    } catch {
      // Connection may not be active — silently skip this cycle.
    }
  }

  /**
   * Extract fps, rtt, and bitrate from an RTCStatsReport.
   *
   * - fps: from `inbound-rtp` stats with `kind === 'video'`
   * - rtt: from `candidate-pair` stats (currentRoundTripTime)
   * - bitrate: delta of bytesReceived over time from `inbound-rtp`
   */
  private extractMetrics(report: RTCStatsReport): void {
    let fps = 0;
    let rtt = 0;
    let bytesReceived = 0;
    let timestamp = 0;

    report.forEach((stat) => {
      // Framerate from inbound-rtp video
      if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
        fps = stat.framesPerSecond ?? 0;
        bytesReceived = stat.bytesReceived ?? 0;
        timestamp = stat.timestamp ?? 0;
      }

      // RTT from candidate-pair
      if (
        stat.type === 'candidate-pair' &&
        stat.state === 'succeeded' &&
        stat.currentRoundTripTime != null
      ) {
        rtt = stat.currentRoundTripTime * 1_000; // seconds → ms
      }
    });

    // Calculate bitrate from byte delta
    let bitrate = 0;
    if (this.prevTimestamp > 0 && timestamp > this.prevTimestamp) {
      const deltaBytes = bytesReceived - this.prevBytesReceived;
      const deltaSeconds = (timestamp - this.prevTimestamp) / 1_000;
      bitrate = deltaSeconds > 0 ? (deltaBytes * 8) / deltaSeconds : 0;
    }

    this.prevBytesReceived = bytesReceived;
    this.prevTimestamp = timestamp;

    this._metrics = { fps, rtt, bitrate };
  }

  // ---------------------------------------------------------------------------
  // Auto quality adjustment (Task 5.2)
  // ---------------------------------------------------------------------------

  /**
   * Evaluate current metrics and adjust quality if thresholds are met.
   *
   * Downgrade: fps < downgradeThreshold for `downgradeSamples` consecutive polls.
   * Upgrade:   fps > upgradeThreshold for `upgradeSamples` consecutive polls.
   *
   * Hysteresis is achieved by:
   * 1. Different thresholds for upgrade vs downgrade (25 vs 20).
   * 2. Different sample counts (5 vs 3).
   * 3. Resetting the opposite counter when a direction is detected.
   */
  private evaluateQuality(): void {
    const { fps } = this._metrics;
    const {
      downgradeThreshold,
      upgradeThreshold,
      downgradeSamples,
      upgradeSamples,
    } = this.config;

    if (fps > 0 && fps < downgradeThreshold) {
      this.lowFpsCount++;
      this.highFpsCount = 0; // Reset upgrade counter
    } else if (fps >= upgradeThreshold) {
      this.highFpsCount++;
      this.lowFpsCount = 0; // Reset downgrade counter
    } else {
      // In the dead zone between thresholds — reset both counters.
      this.lowFpsCount = 0;
      this.highFpsCount = 0;
    }

    // Downgrade
    if (this.lowFpsCount >= downgradeSamples) {
      const downgraded = this.downgradeQuality();
      if (downgraded) {
        this.lowFpsCount = 0;
        this.highFpsCount = 0;
      }
    }

    // Upgrade
    if (this.highFpsCount >= upgradeSamples) {
      const upgraded = this.upgradeQuality();
      if (upgraded) {
        this.highFpsCount = 0;
        this.lowFpsCount = 0;
      }
    }
  }

  /** Attempt to lower quality by one step. Returns true if changed. */
  private downgradeQuality(): boolean {
    const currentIndex = QUALITY_ORDER.indexOf(this._currentQuality);
    if (currentIndex <= 0) return false; // Already at lowest

    const newQuality = QUALITY_ORDER[currentIndex - 1];
    this._currentQuality = newQuality;
    this.manager.setQuality(newQuality);
    this.events.onQualityChange?.(newQuality);
    return true;
  }

  /** Attempt to raise quality by one step. Returns true if changed. */
  private upgradeQuality(): boolean {
    const currentIndex = QUALITY_ORDER.indexOf(this._currentQuality);
    if (currentIndex >= QUALITY_ORDER.length - 1) return false; // Already at highest

    const newQuality = QUALITY_ORDER[currentIndex + 1];
    this._currentQuality = newQuality;
    this.manager.setQuality(newQuality);
    this.events.onQualityChange?.(newQuality);
    return true;
  }

  private resetCounters(): void {
    this.lowFpsCount = 0;
    this.highFpsCount = 0;
    this.prevBytesReceived = 0;
    this.prevTimestamp = 0;
  }
}
