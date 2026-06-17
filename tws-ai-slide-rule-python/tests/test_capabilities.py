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


def test_synthesis_merge_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "synthesis.merge",
        "state": {"goal": {"text": "design a pet office progression system"}},
        "userText": "converge critique and counterpoints into one next step",
        "roleId": "综合",
        "turnId": "t-synthesis",
    }
    captured = {}

    def fake_caller(messages, **kwargs):
        captured["messages"] = messages
        return _fake_result(
            "## Synthesized conclusion\n- Keep desk upgrades as the core progression loop\n"
            "## Remaining disagreements\n- Speed-first vs depth-first onboarding is unresolved\n"
            "## Next action\n- Prototype one desk-upgrade loop with two onboarding paths"
        )

    out = execute_capability(body, caller=fake_caller)
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Synthesis merge"
    assert out["summary"] == "Synthesized conclusion"
    assert "desk-upgrade loop" in out["content"]
    joined = " ".join(m["content"] for m in captured["messages"])
    assert "pet office progression system" in joined
    assert "converge critique" in joined


def test_rebuttal_resolve_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "rebuttal.resolve",
        "state": {"goal": {"text": "design a pet office progression system"}},
        "userText": "respond to critique without pretending the disagreement is gone",
        "roleId": "综合",
        "turnId": "t-rebuttal",
    }
    captured = {}

    def fake_caller(messages, **kwargs):
        captured["messages"] = messages
        return _fake_result(
            "## Response points\n- Desk upgrades can stay incremental without blocking onboarding depth\n"
            "## Unresolved disagreements\n- unresolved disagreement on speed-first rollout\n"
            "## Verification\n- Compare two onboarding paths in a one-week prototype"
        )

    out = execute_capability(body, caller=fake_caller)
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Rebuttal resolution"
    assert out["summary"] == "Response points"
    assert "unresolved disagreement" in out["content"]
    joined = " ".join(m["content"] for m in captured["messages"])
    assert "pet office progression system" in joined


def test_counter_argue_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "counter.argue",
        "state": {"goal": {"text": "design a pet office progression system"}},
        "userText": "stress-test the roadmap with counterpoints",
        "roleId": "挑刺",
        "turnId": "t-counter",
    }
    captured = {}

    def fake_caller(messages, **kwargs):
        captured["messages"] = messages
        return _fake_result(
            "## Counterpoints\n- counterpoint evidence that desk upgrades may hide balance issues\n"
            "## Evidence gaps\n- No player retention data for the proposed loop\n"
            "## Rebuttal path\n- Run a short playtest before expanding the skill tree"
        )

    out = execute_capability(body, caller=fake_caller)
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Counter argument"
    assert out["summary"] == "Counterpoints"
    assert "counterpoint evidence" in out["content"]
    joined = " ".join(m["content"] for m in captured["messages"])
    assert "pet office progression system" in joined


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


def test_structure_decompose_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "structure.decompose",
        "state": {"goal": {"text": "decompose a pet office product spec tree"}},
        "userText": "split the goal into requirements, risks, and deliverables",
        "roleId": "架构",
        "turnId": "t-structure",
    }

    out = execute_capability(
        body,
        caller=lambda *a, **k: _fake_result(
            "## Root goal\n- Pet office progression system\n"
            "## Requirements branch\n- requirements branch for desk upgrades\n"
            "## Risks branch\n- onboarding complexity\n"
            "## Deliverables\n- MVP spec tree"
        ),
    )
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Structure decomposition"
    assert "requirements branch" in out["content"]
    assert "RBAC" not in out["content"]


def test_risk_analyze_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "risk.analyze",
        "state": {"goal": {"text": "analyze risks in a pet office progression system"}},
        "userText": "scan risks before we ship the progression loop",
        "roleId": "安全",
        "turnId": "t-risk",
    }

    out = execute_capability(
        body,
        caller=lambda *a, **k: _fake_result(
            "## Risk inventory\n- players may grind without meaningful choices\n"
            "## Impact\n- retention drops if upgrades feel cosmetic\n"
            "## Mitigation path\n- prototype one desk-upgrade loop"
        ),
    )
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Risk analysis"
    assert "mitigation path" in out["content"].lower()
    assert "data scoping" not in out["content"].lower()


def test_evidence_search_returns_sources_with_python_llm_provenance():
    body = {
        "capabilityId": "evidence.search",
        "state": {"goal": {"text": "find evidence for a pet office progression system"}},
        "userText": "ground the roadmap with references",
        "roleId": "接地",
        "turnId": "t-evidence",
    }

    out = execute_capability(
        body,
        caller=lambda *a, **k: _fake_result(
            "## Grounding references\n- grounding reference from prior desk-upgrade experiments\n"
            "## Why they matter\n- validates progression pacing assumptions\n"
            "## Gaps\n- no live retention benchmark yet"
        ),
    )
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Evidence search"
    assert "grounding reference" in out["content"]
    assert out.get("sources")
    assert out["sources"][0]["provenance"] == "python-llm"


def _fake_report_json(messages, **kwargs):
    content = (
        "结论：evidence-backed conclusion for the pet office roadmap\n"
        "支撑证据：desk-upgrade playtests show pacing works\n"
        "反证/挑战：speed-first rollout may hide balance issues\n"
        "风险：players grind without meaningful choices\n"
        "分歧：depth-first onboarding still debated\n"
        "收敛决策：prototype one desk-upgrade loop before expanding\n"
        "未解缺口：no retention benchmark yet\n"
        "下一步工程化分支：ship MVP desk loop and measure retention\n"
        "provenance / upstream refs：native-llm-report-write"
    )
    return (
        {
            "title": "Feasibility report",
            "summary": "evidence-backed conclusion",
            "content": content,
        },
        LlmResult(
            content=content,
            usage={"total_tokens": 80},
            finish_reason="stop",
            model="fake-report-json",
            latency_ms=12,
        ),
    )


def test_report_write_returns_v5_shape_with_python_llm_provenance():
    body = {
        "capabilityId": "report.write",
        "state": {"goal": {"text": "design a pet office feasibility report"}},
        "userText": "write the final feasibility report",
        "roleId": "综合",
        "turnId": "t-report",
    }

    out = execute_capability(body, json_caller=_fake_report_json)
    assert out["provenance"] == "python-llm"
    assert out["title"] == "Feasibility report"
    assert "evidence-backed conclusion" in out["content"]
    assert "支撑证据" in out["content"]
    assert "收敛决策" in out["content"]
    assert "RBAC" not in out["content"]


PENDING_NATIVE_CAPABILITIES: tuple[str, ...] = ()


@pytest.mark.parametrize("capability_id", PENDING_NATIVE_CAPABILITIES)
def test_pending_capabilities_remain_unsupported_until_migrated(capability_id):
    body = {
        "capabilityId": capability_id,
        "state": {"goal": {"text": "design a pet office progression system"}},
        "userText": "stay grounded in the pet office goal",
        "roleId": "agent",
        "turnId": f"t-{capability_id}",
    }

    assert is_python_native_capability(capability_id) is False
    with pytest.raises(UnsupportedCapability):
        execute_capability(body, caller=lambda *a, **k: _fake_result("should not run"))


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
    assert is_python_native_capability("synthesis.merge") is True
    assert is_python_native_capability("rebuttal.resolve") is True
    assert is_python_native_capability("counter.argue") is True
    assert is_python_native_capability("structure.decompose") is True
    assert is_python_native_capability("risk.analyze") is True
    assert is_python_native_capability("evidence.search") is True
    assert is_python_native_capability("report.write") is True
    for cap in PENDING_NATIVE_CAPABILITIES:
        assert is_python_native_capability(cap) is False
        with pytest.raises(UnsupportedCapability):
            execute_capability({"capabilityId": cap, "state": {}}, caller=lambda *a, **k: _fake_result())


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
