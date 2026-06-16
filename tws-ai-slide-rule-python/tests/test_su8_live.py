"""
LIVE integration test against the real LLM endpoint (su8, etc.). Opt-in only.

Enable with:
    RUN_LIVE_LLM=1  + LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_WIRE_API set
    (e.g. load the main project's .env first).

Run:  RUN_LIVE_LLM=1 python -m pytest tests/test_su8_live.py -q -s
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from sliderule_llm import call_llm, call_llm_json, call_pool, get_llm_config, get_pool_config  # noqa: E402

_LIVE = os.environ.get("RUN_LIVE_LLM") in ("1", "true", "yes")
pytestmark = pytest.mark.skipif(not _LIVE, reason="set RUN_LIVE_LLM=1 (+ LLM_* env) to run live")


def test_high_model_real_call():
    cfg = get_llm_config()
    assert cfg.api_key, "LLM_API_KEY not set"
    res = call_llm(
        [
            {"role": "system", "content": "You reply with exactly one short word."},
            {"role": "user", "content": "Say hi."},
        ],
        max_tokens=2000,
    )
    print(f"\n[high] model={res.model} wire={cfg.wire_api} latency={res.latency_ms}ms content={res.content!r}")
    assert res.content.strip()


def test_high_model_json():
    obj, res = call_llm_json(
        [{"role": "user", "content": 'Reply with ONLY this JSON: {"ok": true}'}],
        max_tokens=2000,
    )
    print(f"\n[json] {obj} ({res.latency_ms}ms)")
    assert obj.get("ok") is True


def test_pool_real_call():
    pc = get_pool_config()
    if not pc.enabled or not pc.keys:
        pytest.skip("pool not enabled / no keys")
    res = call_pool([{"role": "user", "content": "Say hi in one word."}], max_tokens=2000)
    assert res is not None, "pool returned None (all keys failed)"
    print(f"\n[pool] {len(pc.keys)} keys, mode={pc.race_mode}, model={res.model}, {res.latency_ms}ms -> {res.content!r}")
    assert res.content.strip()
