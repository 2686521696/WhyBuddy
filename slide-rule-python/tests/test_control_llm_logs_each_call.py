"""控制面每发请求一行耗时和 token（control_client._log_call 头注）。

⚠ 2026-10-02 隔离真机第 182 轮：规划一发 5 分钟、下一发 10 分钟，同一网关一句话 2～3 秒，日志里只有 POST 200。
走真 call_control_llm，只换 HTTP 传输（install_response，同 test_control_provider_termination）。
把 _log_call 那一行调用删掉，第一条红。
"""

import pytest

from test_control_provider_termination import install_response, sample


def test_a_successful_call_says_how_long_and_how_big(monkeypatch, capsys):
    install_response(monkeypatch, {
        "model": "fixture-model",
        "choices": [{"message": {"content": "", "tool_calls": [{
            "id": "c1", "type": "function", "function": {"name": "skill", "arguments": "{\"name\":\"postmortem-writing\"}"}}]},
            "finish_reason": "tool_calls"}],
        "usage": {"prompt_tokens": 18342, "completion_tokens": 91, "total_tokens": 18433,
                  "completion_tokens_details": {"reasoning_tokens": 64}},
    })
    sample()
    line = next(l for l in capsys.readouterr().out.splitlines() if l.startswith("[control-llm]"))
    assert "in=18342" in line and "out=91" in line and "reasoning=64" in line and "calls=1" in line
    assert "ms=" in line and "attempt=1" in line


def test_a_provider_without_usage_still_gets_a_line(monkeypatch, capsys):
    """反向：网关不回 usage 也照样打一行，不许因为诊断把采样弄挂。"""
    install_response(monkeypatch, {"model": "fixture-model",
                                   "choices": [{"message": {"content": "好的。"}, "finish_reason": "stop"}]})
    sample()
    assert any(l.startswith("[control-llm]") and "in=?" in l for l in capsys.readouterr().out.splitlines())
