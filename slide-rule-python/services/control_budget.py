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
    #: 单**发** LLM 请求的读超时。跟上面三个不是一回事：那三个量的是一整个
    #: 回合（累计），这个量的是一次 HTTP 请求能等多久。
    #:
    #: ⚠ 2026-09-14 真机（artifacts/control-real-model/67d437a8）：读窗放宽之后
    #:   模型一轮把六个源文件全读完了，下一发请求带着 ~32K 字源码，推理模型
    #:   想了 45 秒还没回，被客户端掐成 `llm_unavailable`：
    #:
    #:       ReadTimeout after 45.2s (budget 45s)   源码改动：0 处
    #:
    #:   45 秒是 `control_client.py` 里 `min(cfg.timeout_ms or 60000, 45_000)`
    #:   的硬上限，对「一句话聊天」够用，对「读完整份源码再想怎么改」不够。
    #:   所以它跟着 profile 走：对话档还是 45 秒，工程档 120 秒。
    #:
    #: ⚠ **故意不进 `to_wire()`。** to_wire 是**校验**契约——`restore_budget`
    #:   拿 `set(snapshot) != set(policy.to_wire())` 卡存档。往里加一个字段，
    #:   所有**已经存在的 checkpoint** 会当场变成 `invalid_control_budget_policy`
    #:   → `control_reconciliation_required`，正在跑的 run 全部被判成需要人工
    #:   对账。而 restore_budget 返回的是 PROJECT_BUDGET / legacy 这两个**规范
    #:   对象本身**，不是重建出来的，所以不进 wire 也照样拿得到这个值。
    #:   判据：`test_control_llm_timeout_follows_budget.py::test_老存档不许因为多了这个字段而失效`。
    max_request_seconds: float = 45.0

    def to_wire(self) -> dict:
        return {"profile": self.profile, "maxRounds": self.max_rounds,
                "maxTokens": self.max_tokens, "maxWallSeconds": self.max_wall_seconds}

    def request_timeout_ms(self) -> int:
        return int(self.max_request_seconds * 1000)


# About 3k repeated input/request in the real fixture, plus growing tool history
# and source output. Sixteen rounds bound useful read/edit/check and one repair;
# token/time caps can stop earlier. Recalibrate and version future changes.
#: ⚠ 单发请求 120 秒的连带账，改这个数之前先算一遍：
#:   `call_control_llm` 单次调用最多重试 3 发，回合累计重试上限
#:   `MAX_RETRIES_PER_TURN = 10`（`sliderule_llm/retry_budget.py`），
#:   窗口 600 秒。120 × 10 = 1200 > 600，所以真抖起来是**那个 600 秒窗口**
#:   先兜住，不是重试次数。120 也仍然小于本档 180 秒的回合墙钟
#:   （判据 `test_单发超时必须装得进回合墙钟` 钉着这条）。
PROJECT_BUDGET = ControlBudget("project-v1", 16, 64_000, 180.0, 120.0)


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
