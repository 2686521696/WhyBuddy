"""`LLM_MAX_TOKENS` 必须真的通到控制面那一发请求上。

## 事故（2026-09-17，真机 2/2）

gemini-3.7-flash 两趟都死在同一处，报的是"空正文"不是"超预算"：

    finish_reason=stop  max_tokens=2048  completion_tokens=2449
    total_tokens=31708  empty_reason=no_visible_content

思考 token 算进 completion 却**不受 max_tokens 约束**，2048 的额度被思考
吃光，可见正文一个字不剩，整条工程链停住。

根因是 control_client 里写死的 `min(default_max_tokens(), 2048)`——那个 min
让环境变量永远赢不了。而 default_max_tokens() 的 docstring 写着它是
"全链路唯一旋钮"，.env.example 也记着「挂掉的是它俩都管不着的**第三处写死
预算**」。第三处就是那一行。

⚠ 判据打在**真正发出去的那个数**上（§1），不是断言常量等于几——
  只断言常量证明不了它被传下去了（§3：名单里有名字 ≠ 埋点在）。
"""
import os
import re
from pathlib import Path

import pytest

from sliderule_llm.config import clamp_max_tokens, default_max_tokens

SOURCE = Path(__file__).resolve().parents[1] / "sliderule_llm" / "control_client.py"


def _code_without_comments() -> str:
    """⚠ 先剥注释再匹配：上面那段事故说明里写满了 2048 和 min(，
    不剥的话下面那条反向判据会被自己的注释喂饱，变异后照样绿（§2）。"""
    lines = []
    for line in SOURCE.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        lines.append(line.split("  #")[0])
    return "\n".join(lines)


@pytest.mark.parametrize("value,expected", [("8192", 8192), ("40000", 40000), ("65535", 65535)])
def test_环境变量设多少控制面就用多少(monkeypatch, value, expected):
    monkeypatch.setenv("LLM_MAX_TOKENS", value)
    assert default_max_tokens() == expected


def test_默认不再被压到2048(monkeypatch):
    """正向：不设环境变量时也该拿到全局默认，而不是那个写死的 2048。"""
    monkeypatch.delenv("LLM_MAX_TOKENS", raising=False)
    assert default_max_tokens() == 65535
    assert default_max_tokens() > 2048


def test_控制面源码里不许再有写死的输出上限():
    """反向：`min(default_max_tokens(), <数字>)` 这种形状一出现就红。

    这是"第三处写死预算"的守卫——.env.example 说前两处分路旋钮删掉之后
    还剩一处没人管；再冒出第四处，这条会当场抓住。
    """
    code = _code_without_comments()
    assert "2048" not in code, "control_client 里又出现写死的 2048"
    assert not re.search(r"min\(\s*default_max_tokens\(\)\s*,", code), \
        "又给 default_max_tokens() 套了 min()，环境变量会再次失效"
    # 正向配一条：它确实是靠 default_max_tokens() 取值的（§3 正反成对）。
    assert re.search(r"max_tokens\s*=\s*clamp_max_tokens\(\s*max_tokens\s+or\s+default_max_tokens\(\)\s*\)", code)


def test_剥注释这一步本身有效():
    """否则上一条会被事故说明里的 2048 喂饱——本仓被这个形态咬过（§2）。"""
    raw = SOURCE.read_text(encoding="utf-8")
    assert "2048" in raw, "注释里记着事故数字"
    assert "2048" not in _code_without_comments(), "剥注释之后代码里就没有了"


def test_上游开区间仍然兜着():
    """拆掉写死上限不等于放任越界：65536 在 Gemini 口径上是不含的，写了会 400。"""
    assert clamp_max_tokens(65536) == 65535
    assert clamp_max_tokens(10**9) == 65535
    assert clamp_max_tokens(0) == 65535
    assert clamp_max_tokens(8192) == 8192
