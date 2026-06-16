"""
Unit tests for the ported config + wire selection. Network-free, stdlib-only
(imports only sliderule_llm.config), so it runs on any Python without httpx.

Run:  python -m pytest tests/test_config.py -q
  or: python tests/test_config.py   (has a __main__ runner for envs without pytest)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.config import (  # noqa: E402
    select_wire_api,
    get_llm_config,
    get_pool_config,
)


def test_explicit_chat_completions_is_honored_not_upgraded():
    # Reasoning model + explicit chat_completions → stays chat_completions (the rcouyi/su8 fix).
    assert select_wire_api("chat_completions", "gpt-5.5", "medium") == "chat_completions"
    assert select_wire_api("chat_completions", "ouyi-5-preview-thinking", "high") == "chat_completions"


def test_explicit_responses_is_honored():
    assert select_wire_api("responses", "gpt-4o", None) == "responses"


def test_unset_wire_infers_responses_for_reasoning_models():
    assert select_wire_api(None, "gpt-5.5", "medium") == "responses"
    assert select_wire_api("", "o3-mini", "high") == "responses"
    assert select_wire_api(None, "some-thinking-model", "low") == "responses"


def test_unset_wire_defaults_chat_for_plain_models():
    assert select_wire_api(None, "gpt-4o-mini", None) == "chat_completions"
    assert select_wire_api(None, "gpt-5.5", "none") == "chat_completions"  # reasoning 'none' → not reasoning
    assert select_wire_api(None, "qwen-max", "medium") == "chat_completions"  # not a reasoning-model name


def test_get_llm_config_reads_env(monkeypatch=None):
    _set = os.environ.__setitem__
    _clear = lambda k: os.environ.pop(k, None)
    for k in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_WIRE_API", "LLM_REASONING_EFFORT", "LLM_TIMEOUT_MS"):
        _clear(k)
    _set("LLM_API_KEY", "su8-test")
    _set("LLM_BASE_URL", "https://www.su8.codes/codex/v1/")  # trailing slash trimmed
    _set("LLM_MODEL", "gpt-5.5")
    _set("LLM_WIRE_API", "chat_completions")
    _set("LLM_REASONING_EFFORT", "medium")
    _set("LLM_TIMEOUT_MS", "600000")
    cfg = get_llm_config()
    assert cfg.api_key == "su8-test"
    assert cfg.base_url == "https://www.su8.codes/codex/v1"
    assert cfg.model == "gpt-5.5"
    assert cfg.wire_api == "chat_completions"
    assert cfg.timeout_ms == 600000


def test_get_pool_config_parses_keys_and_labels():
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS"] = "k1, k2 ,k3"
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_LABELS"] = "a,b,c"
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL"] = "https://www.su8.codes/codex/v1"
    os.environ["SLIDERULE_CAPABILITY_POOL_ENABLED"] = "true"
    os.environ["SLIDERULE_POOL_RACE_MODE"] = "parallel"
    pc = get_pool_config()
    assert pc.keys == ("k1", "k2", "k3")
    assert pc.labels == ("a", "b", "c")
    assert pc.enabled is True
    assert pc.race_mode == "parallel"


def test_pool_labels_default_when_mismatched():
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS"] = "k1,k2"
    os.environ["BLUEPRINT_SPEC_DOCS_LLM_POOL_LABELS"] = "only-one"
    pc = get_pool_config()
    assert pc.labels == ("key-1", "key-2")


# Minimal runner so this file works even where pytest isn't installed.
if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
            passed += 1
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {fn.__name__}: {e!r}")
    print(f"\n{passed}/{len(fns)} passed")
    sys.exit(0 if passed == len(fns) else 1)
