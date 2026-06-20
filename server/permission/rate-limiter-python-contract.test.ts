import { describe, expect, it } from "vitest";
import type { PermissionRateLimitDecision } from "../../shared/permission/contracts.js";
import { RATE_LIMIT_WINDOW_MS, SlidingWindowRateLimiter } from "./rate-limiter.js";

describe("permission rate limit Python contract compatibility", () => {
  it("matches allow deny reset and retryAfter contract semantics", () => {
    let time = 0;
    const limiter = new SlidingWindowRateLimiter(() => time);
    const key = "agent-1:api:/v1/users";

    const first: PermissionRateLimitDecision = limiter.checkDetailed(key, 3);
    expect(first).toEqual({
      allowed: true,
      limit: 3,
      remaining: 3,
      retryAfterMs: 0,
      resetAtMs: null,
      reason: "allowed",
    });
    limiter.record(key);

    expect(limiter.checkDetailed(key, 3)).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      retryAfterMs: 0,
      resetAtMs: null,
      reason: "allowed",
    });
    limiter.record(key);

    expect(limiter.checkDetailed(key, 3)).toEqual({
      allowed: true,
      limit: 3,
      remaining: 1,
      retryAfterMs: 0,
      resetAtMs: null,
      reason: "allowed",
    });
    limiter.record(key);

    expect(limiter.checkDetailed(key, 3)).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      retryAfterMs: RATE_LIMIT_WINDOW_MS,
      resetAtMs: RATE_LIMIT_WINDOW_MS,
      reason: "rate_limit_exceeded",
    });
    expect(limiter.check(key, 3)).toBe(false);

    time = 30_000;
    expect(limiter.checkDetailed(key, 3)).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      retryAfterMs: 30_000,
      resetAtMs: RATE_LIMIT_WINDOW_MS,
      reason: "rate_limit_exceeded",
    });

    time = RATE_LIMIT_WINDOW_MS;
    expect(limiter.checkDetailed(key, 3).allowed).toBe(true);

    limiter.reset();
    expect(limiter.checkDetailed(key, 3)).toEqual({
      allowed: true,
      limit: 3,
      remaining: 3,
      retryAfterMs: 0,
      resetAtMs: null,
      reason: "allowed",
    });
  });

  it("treats invalid rate limit contract values as deny not allow fallback", () => {
    let time = 5_000;
    const limiter = new SlidingWindowRateLimiter(() => time);
    const key = "agent-2:api:/admin";

    expect(limiter.checkDetailed(key, 0)).toEqual({
      allowed: false,
      limit: 0,
      remaining: 0,
      retryAfterMs: RATE_LIMIT_WINDOW_MS,
      resetAtMs: time + RATE_LIMIT_WINDOW_MS,
      reason: "invalid_limit",
    });
    expect(limiter.check(key, 0)).toBe(false);
    expect(limiter.getCount(key)).toBe(0);

    time += RATE_LIMIT_WINDOW_MS;
    expect(limiter.checkDetailed(key, -1).allowed).toBe(false);
  });
});
