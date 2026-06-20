"""Permission rate limit contract for the Python migration boundary.

This file locks the contract shape and semantics the future Python runtime must
preserve before any Node fallback is considered.
"""
from dataclasses import dataclass, field


WINDOW_MS = 60_000


@dataclass
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after_ms: int
    reset_at_ms: int | None
    reason: str


@dataclass
class ContractRateLimiter:
    now_ms: int = 0
    windows: dict[str, list[int]] = field(default_factory=dict)

    def check(self, key: str, max_per_minute: int) -> RateLimitDecision:
        if max_per_minute <= 0:
            return RateLimitDecision(
                allowed=False,
                limit=max_per_minute,
                remaining=0,
                retry_after_ms=WINDOW_MS,
                reset_at_ms=self.now_ms + WINDOW_MS,
                reason="invalid_limit",
            )

        active = [timestamp for timestamp in self.windows.get(key, []) if timestamp > self.now_ms - WINDOW_MS]
        if len(active) < max_per_minute:
            return RateLimitDecision(
                allowed=True,
                limit=max_per_minute,
                remaining=max_per_minute - len(active),
                retry_after_ms=0,
                reset_at_ms=None,
                reason="allowed",
            )

        reset_at_ms = min(active) + WINDOW_MS
        return RateLimitDecision(
            allowed=False,
            limit=max_per_minute,
            remaining=0,
            retry_after_ms=max(0, reset_at_ms - self.now_ms),
            reset_at_ms=reset_at_ms,
            reason="rate_limit_exceeded",
        )

    def record(self, key: str) -> None:
        self.windows.setdefault(key, []).append(self.now_ms)

    def reset(self) -> None:
        self.windows.clear()


def test_permission_rate_limit_contract_allows_until_limit_then_denies_with_retry_after():
    limiter = ContractRateLimiter(now_ms=0)
    key = "agent-1:api:/v1/users"

    first = limiter.check(key, 3)
    assert first == RateLimitDecision(True, 3, 3, 0, None, "allowed")
    limiter.record(key)

    second = limiter.check(key, 3)
    assert second == RateLimitDecision(True, 3, 2, 0, None, "allowed")
    limiter.record(key)

    third = limiter.check(key, 3)
    assert third == RateLimitDecision(True, 3, 1, 0, None, "allowed")
    limiter.record(key)

    denied = limiter.check(key, 3)
    assert denied == RateLimitDecision(False, 3, 0, WINDOW_MS, WINDOW_MS, "rate_limit_exceeded")

    limiter.now_ms = 30_000
    retry_later = limiter.check(key, 3)
    assert retry_later.allowed is False
    assert retry_later.retry_after_ms == 30_000
    assert retry_later.reset_at_ms == WINDOW_MS

    limiter.now_ms = WINDOW_MS
    reopened = limiter.check(key, 3)
    assert reopened.allowed is True
    assert reopened.retry_after_ms == 0


def test_permission_rate_limit_contract_reset_clears_prior_denials():
    limiter = ContractRateLimiter(now_ms=10_000)
    key = "agent-2:network"

    assert limiter.check(key, 1).allowed is True
    limiter.record(key)
    assert limiter.check(key, 1).allowed is False

    limiter.reset()

    after_reset = limiter.check(key, 1)
    assert after_reset == RateLimitDecision(True, 1, 1, 0, None, "allowed")


def test_permission_rate_limit_contract_invalid_limit_is_deny_not_allow_fallback():
    limiter = ContractRateLimiter(now_ms=5_000)

    denied = limiter.check("agent-3:api:/admin", 0)

    assert denied.allowed is False
    assert denied.reason == "invalid_limit"
    assert denied.retry_after_ms == WINDOW_MS
