"""会话日志工具行：白名单收、大字段不许进。

抄 OpenHands / AI SDK：UI 看见的工具事件必须能收成一行。
反向：project_patch 全文不许出现在这一行里。
"""

from services.control_transcript_log import tool_transcript_entry


def test_start_and_result_become_transcript_rows():
    start = tool_transcript_entry({
        "type": "control_tool_start",
        "tool": "project_patch",
        "summary": "src/App.tsx",
        "content": "<html>整页</html>",
        "arguments": {"files": [{"path": "src/App.tsx", "content": "SECRET"}]},
    })
    assert start == {
        "role": "assistant",
        "kind": "tool_start",
        "tool": "project_patch",
        "summary": "src/App.tsx",
    }
    result = tool_transcript_entry({
        "type": "control_tool_result",
        "tool": "inspect_model",
        "ok": True,
        "digest": "x" * 4000,
        "content": "五系统原文",
        "human": "已看过当前模型",
        "operationId": "op-1",
    })
    assert result == {
        "role": "assistant",
        "kind": "tool_result",
        "tool": "inspect_model",
        "ok": True,
        "detail": "已看过当前模型",
        "operationId": "op-1",
    }
    dumped = str(start) + str(result)
    assert "SECRET" not in dumped
    assert "五系统原文" not in dumped
    assert "content" not in start
    assert "digest" not in result


def test_non_tool_events_are_ignored():
    assert tool_transcript_entry({"type": "control_text", "text": "你好"}) is None
    assert tool_transcript_entry({"type": "control_tool_start", "tool": ""}) is None
    assert tool_transcript_entry({"type": "complete"}) is None


def test_派发出口都套了会话日志():  # noqa: RUF001
    """`_dispatch_tool(` 与 `_logged_tool_events(` 必须同数。

    定义各一，出口各四。多一个没套的 dispatch，就是 forced / 超限
    那条漏写（§4）。先剥注释，免得标识符只活在 docstring 里。
    """
    import re
    from pathlib import Path

    raw = Path(__file__).resolve().parents[1].joinpath(
        "services", "rehearsal_control.py"
    ).read_text(encoding="utf-8")
    src = re.sub(r'""".*?"""', "", raw, flags=re.S)
    src = re.sub(r"#.*", "", src)
    assert src.count("_dispatch_tool(") == src.count("_logged_tool_events(")
