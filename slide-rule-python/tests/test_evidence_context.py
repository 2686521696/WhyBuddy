"""E17 证据上下文管道：装箱器纯函数 + prompt 注入 + 并行屏障。

回归目标：「综合各方结论」综合的必须是各方结论——上游过门产物
进 prompt、只喂过门的、省略要留痕、综合/报告在并行批里是屏障。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.evidence_context import (  # noqa: E402
    DEFAULT_BUDGET_CHARS,
    build_evidence_context,
    evidence_context_enabled,
)
from sliderule_llm.capabilities import (  # noqa: E402
    build_messages,
    build_report_write_messages,
)
from services.v5_full_driver import _split_parallel_segments  # noqa: E402


def _art(kind: str, i: int = 0, trust: str = "gated_pass", **over):
    return {
        "id": f"a-{kind}-{i}",
        "kind": kind,
        "trustLevel": trust,
        "title": f"{kind} 产物 {i}",
        "summary": f"{kind} 的结论摘要 {i}",
        "content": f"{kind} 的完整内容 {i} " + "详" * 50,
        "status": "active",
        **over,
    }


# ── 准入：信任门说了算 ────────────────────────────────────────────────


def test_only_gated_artifacts_admitted():
    arts = [
        _art("risk", 1),
        _art("evidence", 2, trust="untrusted"),  # 没过门 → 拒
        _art("decision", 3, trust="audited"),
        _art("synthesis", 4, status="superseded"),  # 已被取代 → 拒
    ]
    out = build_evidence_context(arts, set(), capability_id="synthesis.merge")
    assert "risk 产物 1" in out
    assert "decision 产物 3" in out
    assert "evidence 产物 2" not in out
    assert "synthesis 产物 4" not in out


def test_stale_ids_excluded_and_empty_returns_blank():
    arts = [_art("risk", 1)]
    assert build_evidence_context(arts, {"a-risk-1"}, capability_id="report.write") == ""
    assert build_evidence_context([], set(), capability_id="report.write") == ""
    assert (
        build_evidence_context(
            [_art("risk", 9, summary="", content="")], set(), capability_id="x"
        )
        == ""
    )


# ── 优先级：按能力族排序，同级新者先 ──────────────────────────────────


def test_priority_order_for_synthesis_and_report():
    arts = [_art("clarification", 1), _art("evidence", 2), _art("risk", 3), _art("synthesis", 4)]
    syn = build_evidence_context(arts, set(), capability_id="synthesis.merge")
    assert syn.index("risk 产物 3") < syn.index("evidence 产物 2") < syn.index("clarification 产物 1")
    rep = build_evidence_context(arts, set(), capability_id="report.write")
    assert rep.index("synthesis 产物 4") < rep.index("risk 产物 3") < rep.index("evidence 产物 2")


def test_same_kind_newer_first():
    arts = [_art("risk", 1), _art("risk", 2)]
    out = build_evidence_context(arts, set(), capability_id="synthesis.merge")
    assert out.index("risk 产物 2") < out.index("risk 产物 1")


# ── 装箱：预算截止 + 诚实留痕 ─────────────────────────────────────────


def test_budget_drops_low_priority_with_honest_note():
    arts = [_art("risk", i, content="长" * 380) for i in range(12)] + [
        _art("clarification", 99)
    ]
    out = build_evidence_context(arts, set(), capability_id="synthesis.merge")
    assert len(out) <= DEFAULT_BUDGET_CHARS + 120  # 预算 + 留痕行
    assert "件低优先级上游产物因预算未注入" in out
    assert "clarification 产物 99" not in out  # 最低优先级被丢


def test_per_item_content_truncated():
    arts = [_art("evidence", 1, content="超" * 2000)]
    out = build_evidence_context(arts, set(), capability_id="x")
    assert len(out) < 900  # 单件 400 字符截断生效


# ── 开关 ──────────────────────────────────────────────────────────────


def test_switch_off(monkeypatch):
    monkeypatch.setenv("SLIDERULE_EVIDENCE_CONTEXT", "off")
    assert evidence_context_enabled() is False
    monkeypatch.setenv("SLIDERULE_EVIDENCE_CONTEXT", "on")
    assert evidence_context_enabled() is True


# ── prompt 注入 ───────────────────────────────────────────────────────


def test_build_messages_injects_upstream_section():
    body = {
        "capabilityId": "synthesis.merge",
        "state": {"goal": {"text": "宠物医院预约"}},
        "userText": "宠物医院预约",
        "roleId": "综合",
        "turnId": "loop-1",
        "upstreamEvidence": "【risk · 风险清单】数据泄露风险……",
    }
    user = build_messages("synthesis.merge", body)[1]["content"]
    assert "UPSTREAM_EVIDENCE" in user and "风险清单" in user
    # 没有上游 → 不加空段
    body.pop("upstreamEvidence")
    assert "UPSTREAM_EVIDENCE" not in build_messages("synthesis.merge", body)[1]["content"]


def test_report_write_messages_inject_upstream_section():
    body = {
        "state": {"goal": {"text": "x"}},
        "userText": "x",
        "upstreamEvidence": "【synthesis · 收敛结论】方向已定……",
    }
    user = build_report_write_messages(body)[1]["content"]
    assert "UPSTREAM_EVIDENCE" in user and "收敛结论" in user


# ── 并行屏障 ──────────────────────────────────────────────────────────


def test_synthesis_and_report_are_parallel_barriers():
    selected = [
        {"capabilityId": "risk.analyze"},
        {"capabilityId": "evidence.search"},
        {"capabilityId": "synthesis.merge"},
        {"capabilityId": "clarify.ask"},
        {"capabilityId": "report.write"},
    ]
    segments = _split_parallel_segments(selected)
    flat = [[s["capabilityId"] for s in seg] for seg in segments]
    assert flat == [
        ["risk.analyze", "evidence.search"],
        ["synthesis.merge"],
        ["clarify.ask"],
        ["report.write"],
    ]
