"""Test for SlideRule AgentLoop 110 SSE stream v2.

agentloop sse stream v2 110 streams incremental normalized events
"""

from services.agent_loop_events import (
    iter_agent_loop_v2_sse_frames,
    format_sse_frame,
)
from services.agent_loop_state_reducer import reduce_run_events


def test_agentloop_sse_stream_v2_110_streams_incremental_normalized_events():
    """agentloop sse stream v2 110 streams incremental normalized events

    Verifies:
    - replays incremental normalized v2 events as stable 'event' frames
    - emits final 'snapshot' frame
    - uses compact JSON
    - finite generator only (no sleeps, no infinite)
    """
    sample_events = [
        {
            "version": "agentloop.event.v2",
            "seq": 0,
            "ts": "2026-01-01T00:00:00Z",
            "runId": "test-run-110",
            "type": "RUN_STARTED",
            "source": "test",
            "phase": "start",
            "payload": {"status": "RUNNING"},
        },
        {
            "version": "agentloop.event.v2",
            "seq": 1,
            "ts": "2026-01-01T00:00:01Z",
            "runId": "test-run-110",
            "type": "AGENT_LOG",
            "source": "agent",
            "phase": "think",
            "payload": {"msg": "step"},
        },
        {
            "version": "agentloop.event.v2",
            "seq": 2,
            "ts": "2026-01-01T00:00:02Z",
            "runId": "test-run-110",
            "type": "RUN_FINALIZED",
            "source": "test",
            "phase": "done",
            "payload": {"status": "DONE"},
        },
    ]

    frames = list(iter_agent_loop_v2_sse_frames(sample_events))

    # replays all 3 events + 1 snapshot
    assert len(frames) == 4

    # stable event name for incremental events
    assert frames[0].startswith("event: event\n")
    assert '"type":"RUN_STARTED"' in frames[0]
    assert '"runId":"test-run-110"' in frames[0]

    assert frames[1].startswith("event: event\n")
    assert '"type":"AGENT_LOG"' in frames[1]

    assert frames[2].startswith("event: event\n")
    assert '"type":"RUN_FINALIZED"' in frames[2]

    # final snapshot frame
    assert frames[3].startswith("event: snapshot\n")
    assert '"finalized":true' in frames[3]
    assert '"status":"DONE"' in frames[3]

    # compact JSON (no pretty spaces)
    assert ',"' in frames[0]  # separators use ,
    assert '":"' in frames[0]

    # verify the reducer snapshot matches what stream emits for last
    computed = reduce_run_events(sample_events)
    snap_frame = format_sse_frame("snapshot", computed)
    assert frames[3] == snap_frame

    # ensure finite: no generator left open, just list it
    assert isinstance(frames, list)
