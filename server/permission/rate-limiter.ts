/**
 * SlidingWindowRateLimiter — 滑动窗口速率限制器
 *
 * Tracks request timestamps per key (e.g. agentId:resourceType or agentId:endpoint).
 * Uses a sliding window of 60 seconds (1 minute) to enforce maxPerMinute limits.
 */

import type { PermissionRateLimitDecision } from "../../shared/permission/contracts.js";

export const RATE_LIMIT_WINDOW_MS = 60_000;

export class SlidingWindowRateLimiter {
  /** key → sorted array of timestamps (ms) */
  private windows = new Map<string, number[]>();

  /** Provide a custom time source for testing; defaults to Date.now */
  private now: () => number;

  constructor(nowFn?: () => number) {
    this.now = nowFn ?? (() => Date.now());
  }

  /**
   * Check whether the key is under the rate limit.
   * Does NOT record a new request — call `record()` separately after a successful check.
   * @returns true if under limit, false if exceeded
   */
  check(key: string, maxPerMinute: number): boolean {
    return this.checkDetailed(key, maxPerMinute).allowed;
  }

  checkDetailed(key: string, maxPerMinute: number): PermissionRateLimitDecision {
    const now = this.now();
    if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) {
      return {
        allowed: false,
        limit: maxPerMinute,
        remaining: 0,
        retryAfterMs: RATE_LIMIT_WINDOW_MS,
        resetAtMs: now + RATE_LIMIT_WINDOW_MS,
        reason: "invalid_limit",
      };
    }

    const timestamps = this.windows.get(key);
    if (!timestamps) {
      return {
        allowed: true,
        limit: maxPerMinute,
        remaining: maxPerMinute,
        retryAfterMs: 0,
        resetAtMs: null,
        reason: "allowed",
      };
    }

    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    // Count timestamps within the window
    let count = 0;
    let oldestActive: number | null = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] > cutoff) {
        count++;
        oldestActive = timestamps[i];
      } else {
        break; // sorted ascending, so everything before is also expired
      }
    }
    if (count < maxPerMinute) {
      return {
        allowed: true,
        limit: maxPerMinute,
        remaining: maxPerMinute - count,
        retryAfterMs: 0,
        resetAtMs: null,
        reason: "allowed",
      };
    }

    const resetAtMs = (oldestActive ?? now) + RATE_LIMIT_WINDOW_MS;
    return {
      allowed: false,
      limit: maxPerMinute,
      remaining: 0,
      retryAfterMs: Math.max(0, resetAtMs - now),
      resetAtMs,
      reason: "rate_limit_exceeded",
    };
  }

  /** Record a request timestamp for the given key. */
  record(key: string): void {
    const now = this.now();
    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }
    timestamps.push(now);
  }

  /** Remove expired timestamps (older than 60s) from all keys. */
  cleanup(): void {
    const cutoff = this.now() - RATE_LIMIT_WINDOW_MS;
    this.windows.forEach((timestamps, key) => {
      // Find first index within the window
      let firstValid = timestamps.length;
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] > cutoff) {
          firstValid = i;
          break;
        }
      }
      if (firstValid === timestamps.length) {
        this.windows.delete(key);
      } else if (firstValid > 0) {
        timestamps.splice(0, firstValid);
      }
    });
  }

  /** Get the current count of requests within the window for a key. */
  getCount(key: string): number {
    const now = this.now();
    const timestamps = this.windows.get(key);
    if (!timestamps) return 0;
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] > cutoff) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /** Reset all tracked data. */
  reset(): void {
    this.windows.clear();
  }
}
