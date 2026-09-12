"""Versioned resource limits for one control run, distinct from context size.

The 2026-08-27 M1 cap was for pre-ignition conversation. The real 2026-09-12
project sample spent 10,505 provider tokens before its first patch; each request
resent about 3,000 input tokens. Internal project-v1 allows a bounded edit/check
and repair sequence, with a separate cumulative token and wall-time ceiling.
These initial limits are checked by the live combined-edit/single-turn smokes;
they do not promise that arbitrary projects fit. Legacy limits stay unchanged.

Like grok's prompt usage ledger and goal budget, cumulative spend is separate
from its context/compaction threshold. A restored run keeps its saved policy;
deploying a larger policy must not grant an old run another budget.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ControlBudget:
    profile: str
    max_rounds: int
    max_tokens: int
    max_wall_seconds: float

    def to_wire(self) -> dict:
        return {"profile": self.profile, "maxRounds": self.max_rounds,
                "maxTokens": self.max_tokens, "maxWallSeconds": self.max_wall_seconds}


# About 3k repeated input/request in the real fixture, plus growing tool history
# and source output. Sixteen rounds bound useful read/edit/check and one repair;
# token/time caps can stop earlier. Recalibrate and version future changes.
PROJECT_BUDGET = ControlBudget("project-v1", 16, 64_000, 180.0)


def restore_budget(snapshot, legacy: ControlBudget) -> ControlBudget:
    """Old checkpoints had only cheapTokens, and retain the old ceiling."""
    if snapshot is None:
        return legacy
    if not isinstance(snapshot, dict):
        raise ValueError("invalid_control_budget_policy")
    policy = PROJECT_BUDGET if snapshot.get("profile") == PROJECT_BUDGET.profile else legacy
    if (set(snapshot) != set(policy.to_wire())
            or type(snapshot.get("maxRounds")) is not int
            or type(snapshot.get("maxTokens")) is not int
            or type(snapshot.get("maxWallSeconds")) not in (int, float)
            or snapshot != policy.to_wire()):
        raise ValueError("invalid_control_budget_policy")
    return policy
