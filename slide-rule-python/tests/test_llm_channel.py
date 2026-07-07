"""推演 LLM 通道运行时配置（设置中心「推演通道」）的单元测试。

覆盖：掩码规则、override 写入即生效（os.environ）、置空回退 .env 基线、
持久化文件往返、GET 永不泄漏明文、test 端点注入假通道 ok/fail 两态。
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import services.llm_channel as ch  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_channel(tmp_path, monkeypatch):
    """每个测试独立的 override 文件与 env 基线。"""
    monkeypatch.setattr(ch, "OVERRIDE_PATH", tmp_path / "override.json")
    monkeypatch.setattr(ch, "_env_baseline", None)
    monkeypatch.setenv("LLM_API_KEY", "sk-env-baseline-key-123456")
    monkeypatch.setenv("LLM_BASE_URL", "https://env.example.com/v1")
    monkeypatch.setenv("LLM_MODEL", "env-model")
    yield


def test_mask_key_rules():
    assert ch.mask_key("") == ""
    assert ch.mask_key("short") == "*****"
    assert ch.mask_key("sk-1234567890abcdef") == "sk-1…cdef"


def test_status_reads_env_and_masks_key():
    status = ch.get_channel_status()
    assert status["baseUrl"] == "https://env.example.com/v1"
    assert status["model"] == "env-model"
    assert status["keyPresent"] is True
    assert "sk-env-baseline-key-123456" not in json.dumps(status)  # 明文永不出
    assert status["overriddenFields"] == []


def test_set_channel_overrides_env_immediately_and_persists():
    result = ch.set_channel({"model": "override-model", "apiKey": "sk-override-key-abcdef00"})
    assert os.environ["LLM_MODEL"] == "override-model"
    assert os.environ["LLM_API_KEY"] == "sk-override-key-abcdef00"
    assert set(result["overriddenFields"]) == {"apiKey", "model"}
    # 持久化文件可恢复
    saved = json.loads(ch.OVERRIDE_PATH.read_text(encoding="utf-8"))
    assert saved["model"] == "override-model"
    # baseUrl 未传 → 保持 .env
    assert os.environ["LLM_BASE_URL"] == "https://env.example.com/v1"


def test_clear_field_falls_back_to_env_baseline():
    ch.set_channel({"model": "override-model"})
    assert os.environ["LLM_MODEL"] == "override-model"
    result = ch.set_channel({"model": ""})  # 置空 = 清除 override
    assert os.environ["LLM_MODEL"] == "env-model"  # 回退基线
    assert result["overriddenFields"] == []
    assert not ch.OVERRIDE_PATH.exists()  # 空 override 不留文件


def test_apply_override_on_startup_restores_persisted_values():
    ch.OVERRIDE_PATH.write_text(json.dumps({"baseUrl": "https://ov.example.com/v1"}), encoding="utf-8")
    ch.apply_override_to_env()
    assert os.environ["LLM_BASE_URL"] == "https://ov.example.com/v1"
    status = ch.get_channel_status()
    assert status["overriddenFields"] == ["baseUrl"]


def test_malformed_override_file_is_ignored():
    ch.OVERRIDE_PATH.write_text("not json", encoding="utf-8")
    assert ch.load_override() == {}
    ch.OVERRIDE_PATH.write_text(json.dumps({"model": 42, "evil": "x"}), encoding="utf-8")
    assert ch.load_override() == {}  # 非法类型与未知字段全部剔除


def test_test_channel_ok_and_fail(monkeypatch):
    class FakeResult:
        model = "gpt-test"
        latency_ms = 321

    import sliderule_llm.client as client_mod

    monkeypatch.setattr(client_mod, "call_llm", lambda *a, **k: FakeResult())
    ok = ch.test_channel()
    assert ok["ok"] is True and ok["model"] == "gpt-test" and ok["latencyMs"] == 321

    def boom(*a, **k):
        raise client_mod.LlmError("connection refused")

    monkeypatch.setattr(client_mod, "call_llm", boom)
    fail = ch.test_channel()
    assert fail["ok"] is False and fail["code"] == "LLM_TEST_FAILED"
    assert "connection refused" in fail["detail"]
