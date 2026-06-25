"""
SlideRule AgentLoop 110: v2 runtime SSOT design tests.

Marker: agentloop v2 ssot 110 defines event sourced runtime architecture
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "AGENT_LOOP_V2_RUNTIME_SSOT.md"


def test_agentloop_v2_ssot_110_defines_event_sourced_runtime_architecture():
    """agentloop v2 ssot 110 defines event sourced runtime architecture."""
    assert DOC.exists(), "AGENT_LOOP_V2_RUNTIME_SSOT.md must exist"
    content = DOC.read_text(encoding="utf-8")
    lower = content.lower()

    assert "runtime event store (ssot)" in lower
    assert "append-only runtime event log is the single source of truth" in lower
    assert "state.json is a cache" in lower.replace("`", "")
    assert "node orchestrator" in lower
    assert "python runtime gateway" in lower
    assert "web console" in lower
    assert "grok worker" in lower
    assert "codex reviewer" in lower
    assert "python worker adapter" in lower

    for event_type in [
        "QUEUE_STARTED",
        "TASK_STARTED",
        "AGENT_LOG",
        "REVIEW_RESULT",
        "RUN_FINALIZED",
        "QUEUE_FINISHED",
    ]:
        assert event_type in content

    for task_id in [
        "sliderule-agentloop-event-envelope-110",
        "sliderule-agentloop-event-store-110",
        "sliderule-agentloop-state-reducer-110",
        "sliderule-agentloop-web-route-shell-110",
        "sliderule-agentloop-replay-release-readiness-110",
    ]:
        assert task_id in content
