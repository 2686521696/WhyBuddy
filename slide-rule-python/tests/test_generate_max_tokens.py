"""生成调用的输出上限可配（2026-08-03）。

## 为什么需要这个旋钮

原来硬编码 8000，那是给**非推理模型**定的。推理模型（deepseek-v4 / o 系 /
gpt-5 thinking 等）的思考 token 和正文**共用同一个 max_tokens**：实测
deepseek-v4-flash 在五系统生成这条链路上，8000 全被思考吃光，正文一个字都没有，
finish_reason=length，客户端收到的是 `empty content from LLM (stream)`。

那条错误信息看着像"服务商坏了"，实际是预算不够——**这正是它危险的地方**：
换模型的人会去查网关、查网络、怀疑 key，而不会想到调 max_tokens。
所以这个默认值必须能改，且改法要写在错误信息够得着的地方（见模块头注释）。
"""

from __future__ import annotations

from services.v5_llm_generate import (
    _DEFAULT_GENERATE_MAX_TOKENS,
    _generate_max_tokens,
)


def test_default_when_unset(monkeypatch):
    monkeypatch.delenv("LLM_GENERATE_MAX_TOKENS", raising=False)
    assert _generate_max_tokens() == _DEFAULT_GENERATE_MAX_TOKENS


def test_env_override(monkeypatch):
    monkeypatch.setenv("LLM_GENERATE_MAX_TOKENS", "32000")
    assert _generate_max_tokens() == 32000


def test_whitespace_is_treated_as_unset(monkeypatch):
    # compose 的 ${VAR:-default} 会把空值原样传进来，别让它变成 0
    monkeypatch.setenv("LLM_GENERATE_MAX_TOKENS", "   ")
    assert _generate_max_tokens() == _DEFAULT_GENERATE_MAX_TOKENS


def test_garbage_falls_back_instead_of_raising(monkeypatch):
    # 配错一个字符不该让整条推演在运行时炸掉——回默认值，链路照跑
    monkeypatch.setenv("LLM_GENERATE_MAX_TOKENS", "32k")
    assert _generate_max_tokens() == _DEFAULT_GENERATE_MAX_TOKENS


def test_non_positive_falls_back(monkeypatch):
    # 0 或负数传给网关就是 400，且错误信息跟本地配置八竿子打不着
    for bad in ("0", "-1"):
        monkeypatch.setenv("LLM_GENERATE_MAX_TOKENS", bad)
        assert _generate_max_tokens() == _DEFAULT_GENERATE_MAX_TOKENS


def test_both_call_sites_read_the_knob():
    """两条通道（流式主路 + 结构化救场通道）都要读它。

    只改一条的话，主路失败后救场通道仍用 8000，症状变成"偶尔能出、偶尔空"，
    比稳定失败更难查。
    """
    import inspect

    from services import v5_llm_generate

    src = inspect.getsource(v5_llm_generate)
    assert src.count("max_tokens=_generate_max_tokens()") == 2
    assert "max_tokens=8000" not in src
