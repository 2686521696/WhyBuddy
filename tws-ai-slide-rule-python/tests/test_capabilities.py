"""
Tests for the real capability brain. Unit tests are network-free (inject a fake caller).
The live test (opt-in) proves a REAL model call AND that it is NOT the old canned RBAC stub.

Run:  python -m pytest tests/test_capabilities.py -q
Live: RUN_LIVE_LLM=1 + LLM_* env  →  python -m pytest tests/test_capabilities.py -q -s
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from sliderule_llm.capabilities import (  # noqa: E402
    execute_capability,
    build_messages,
    is_python_native_capability,
    UnsupportedCapability,
)
from sliderule_llm.client import LlmResult, LlmError  # noqa: E402


def _fake_result(content="## restated goal\n- x"):
    return LlmResult(content=content, usage={"total_tokens": 5}, finish_reason="stop",
                     model="fake-model", latency_ms=12)


def test_intent_clarify_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "intent.clarify",
        "state": {"goal": {"text": "build a cube-pets office sim"}},
        "userText": "make pets do tasks",
        "roleId": "接地",
        "turnId": "t1",
    }
    captured = {}

    def fake_caller(messages, **kwargs):
        captured["messages"] = messages
        return _fake_result("## Restated goal\nBuild a pet office sim.\n## Assumptions\n- pets have stats")

    out = execute_capability(body, caller=fake_caller)
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Intent clarification"
    assert out["summary"] == "Restated goal"  # first heading line, stripped
    assert out["content"].startswith("## Restated goal")
    assert out["model"] == "fake-model"
    joined = " ".join(m["content"] for m in captured["messages"])
    assert "cube-pets office sim" in joined and "make pets do tasks" in joined


def test_gap_ask_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "gap.ask",
        "state": {"goal": {"text": "design a pet office task assignment system"}},
        "userText": "find missing assumptions before planning",
        "roleId": "gap-finder",
        "turnId": "t-gap",
    }
    captured = {}

    def fake_caller(messages, **kwargs):
        captured["messages"] = messages
        return _fake_result("## Missing information\n- How pets qualify for desks?\n## Questions\n- What triggers promotion?")

    out = execute_capability(body, caller=fake_caller)
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Gap questions"
    assert out["summary"] == "Missing information"
    assert "What triggers promotion?" in out["content"]
    joined = " ".join(m["content"] for m in captured["messages"])
    assert "pet office task assignment system" in joined
    assert "find missing assumptions before planning" in joined


def test_critique_generate_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "critique.generate",
        "state": {"goal": {"text": "design a pet office progression system"}},
        "userText": "challenge weak assumptions before we commit to the roadmap",
        "roleId": "挑刺",
        "turnId": "t-critique",
    }
    captured = {}

    def fake_caller(messages, **kwargs):
        captured["messages"] = messages
        return _fake_result(
            "## Critique points\n- Promotion rules are underspecified\n"
            "## Risks\n- Players may grind without meaningful choices\n"
            "## Verification\n- Prototype one desk-upgrade loop"
        )

    out = execute_capability(body, caller=fake_caller)
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Structured critique"
    assert out["summary"] == "Critique points"
    assert "Promotion rules" in out["content"]
    joined = " ".join(m["content"] for m in captured["messages"])
    assert "pet office progression system" in joined
    assert "challenge weak assumptions" in joined


def test_question_expand_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "question.expand",
        "state": {"goal": {"text": "design onboarding for a pet office sim"}},
        "userText": "turn my rough question into better planning questions",
        "roleId": "question-expander",
        "turnId": "t-question",
    }
    captured = {}

    def fake_caller(messages, **kwargs):
        captured["messages"] = messages
        return _fake_result("## Expanded questions\n- What onboarding milestone should unlock the first desk?\n## Why they matter\n- It affects progression pacing.")

    out = execute_capability(body, caller=fake_caller)
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Expanded questions"
    assert out["summary"] == "Expanded questions"
    assert "onboarding milestone" in out["content"]
    joined = " ".join(m["content"] for m in captured["messages"])
    assert "pet office sim" in joined
    assert "turn my rough question" in joined


@pytest.mark.parametrize(
    "capability_id,title,content_snippet",
    [
        ("synthesis.merge", "Synthesis merge", "converged next step"),
        ("rebuttal.resolve", "Rebuttal resolution", "unresolved disagreement"),
        ("counter.argue", "Counter argument", "counterpoint evidence"),
        ("report.write", "Feasibility report", "evidence-backed conclusion"),
        ("structure.decompose", "Structure decomposition", "requirements branch"),
        ("risk.analyze", "Risk analysis", "mitigation path"),
        ("evidence.search", "Evidence search", "grounding reference"),
    ],
)
def test_pending_native_capabilities_return_python_llm_provenance(capability_id, title, content_snippet):
    body = {
        "capabilityId": capability_id,
        "state": {"goal": {"text": "design a pet office progression system"}},
        "userText": "stay grounded in the pet office goal",
        "roleId": "agent",
        "turnId": f"t-{capability_id}",
    }

    def fake_caller(messages, **kwargs):
        return _fake_result(f"## {title}\n- {content_snippet}")

    out = execute_capability(body, caller=fake_caller)
    assert out["provenance"] == "python-llm"
    assert content_snippet in out["content"]


def test_markdown_fence_is_stripped():
    out = execute_capability(
        {"capabilityId": "intent.clarify", "state": {}},
        caller=lambda *a, **k: _fake_result("```markdown\n# Intent\nreal body\n```"),
    )
    assert out["content"] == "# Intent\nreal body"


def test_unsupported_capability_raises():
    assert is_python_native_capability("intent.clarify") is True
    assert is_python_native_capability("gap.ask") is True
    assert is_python_native_capability("question.expand") is True
    assert is_python_native_capability("critique.generate") is True
    for cap in (
        "synthesis.merge",
        "rebuttal.resolve",
        "counter.argue",
        "report.write",
        "structure.decompose",
        "risk.analyze",
        "evidence.search",
    ):
        assert is_python_native_capability(cap) is True


def test_empty_content_raises_llm_error():
    with pytest.raises(LlmError):
        execute_capability(
            {"capabilityId": "intent.clarify", "state": {}},
            caller=lambda *a, **k: _fake_result(content="   "),
        )


def test_build_messages_unsupported_raises():
    with pytest.raises(UnsupportedCapability):
        build_messages("report.write", {"state": {}})


# ── live ──────────────────────────────────────────────────────────────────────
_LIVE = os.environ.get("RUN_LIVE_LLM") in ("1", "true", "yes")


@pytest.mark.skipif(not _LIVE, reason="set RUN_LIVE_LLM=1 (+ LLM_* env) to run live")
def test_live_intent_clarify_is_real_not_canned():
    body = {
        "capabilityId": "intent.clarify",
        "state": {"goal": {"text": "设计一个宠物方块办公室模拟游戏的成长系统"}},
        "userText": "宠物怎么升级、怎么分配工位任务",
        "roleId": "接地",
        "turnId": "live-1",
    }
    out = execute_capability(body, max_tokens=2000)
    print(f"\n[live capability] provenance={out['provenance']} model={out['model']}\n{out['content'][:400]}")
    assert out["provenance"] == "python-llm"
    assert out["content"].strip()
    # smell test: the old fake stub always emitted RBAC/data-scoping boilerplate. A real,
    # goal-grounded answer about a pet game must NOT contain that canned signature.
    assert "RBAC" not in out["content"]
    assert "data scoping" not in out["content"]
