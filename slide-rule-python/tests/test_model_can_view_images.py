"""模型能看图：view_image / browser_view 截图交给模型，只附在紧接着的那一次调用上。

⚠ 2026-10-07 全量扫描 24 份种子技能：data-visualization-discipline「先把产物真的渲染出来看」、office-skills pptx 的必查
  视觉 QA、sliderule 的截图核对——平台上模型一张图都看不到（services/model_images 头注）。
走真 HTTP 控制回合（ControlHarness），沙盒提供方换成内存里的假的；图是 Pillow 画的真 PNG。
"""

from __future__ import annotations

import base64
import copy
import io
import json

import pytest
from PIL import Image

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from models.v5_state import V5SessionState
from services import model_images
from services import rehearsal_control as control
from services.scratch_sandbox import ScratchSandboxes
from services.workspace_provider import WorkspaceHandle
from sliderule_llm.client import LlmError

TOPIC = "@data-visualization-discipline 把这张月度销售图渲染出来做一遍遮字测试"
CHART = "output/chart.png"


def _png(width=320, height=200, color=(200, 40, 40)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, format="PNG")
    return out.getvalue()


class FakeProvider:
    def __init__(self, files):
        self.files, self.asked = files, []

    def find_workspaces(self, *, workspace_id):
        self.asked.append(workspace_id)
        return [WorkspaceHandle(workspace_id, "sbx-1")]

    def connect(self, handle, *, timeout_seconds=900):
        return handle

    def read_file_bytes(self, handle, path, *, max_bytes):
        if path not in self.files:
            raise FileNotFoundError(path)
        return self.files[path]


@pytest.fixture
def setup(monkeypatch):
    provider = FakeProvider({CHART: _png(), "output/report.pdf": b"%PDF-1.7 not an image"})
    sandboxes = ScratchSandboxes(provider)
    monkeypatch.setattr(control, "_scratch_sandboxes", lambda: sandboxes)
    return ControlHarness(monkeypatch), provider


def _images_in(messages):
    return [part["image_url"]["url"] for m in messages if isinstance(m.get("content"), list)
            for part in m["content"] if part.get("type") == "image_url"]


def _turn(harness, steps, *, refuse_images=False):
    seen, it = [], iter(steps)

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        if refuse_images and _images_in(messages):
            raise LlmError("400 image_url is not supported by this model", status=400, transient=False)
        return next(it)
    harness.llm_impl = impl
    sid = new_sid("view-image")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    _, events = harness.post(six_fields(sid, TOPIC))
    return seen, events


def test_the_image_reaches_the_very_next_model_call(setup):
    harness, _ = setup
    seen, _ = _turn(harness, [llm_tool("view_image", {"path": CHART}, call_id="v-1"), llm_text("图上是一整块红色。")])
    assert _images_in(seen[0]) == []
    [url] = _images_in(seen[1])
    assert url.startswith("data:image/png;base64,")
    assert base64.b64decode(url.split(",", 1)[1]) == _png()          # 就是沙盒里那张图，原样
    reply = next(m for m in seen[1] if m.get("role") == "tool" and m.get("tool_call_id") == "v-1")["content"]
    assert "只给这一次" in reply and "base64" not in reply             # 回执说清楚；图本身不在回执里


def test_the_image_is_not_kept_in_the_conversation(setup):
    """反向：图只附一次——第三次调用、以及循环自己的 messages（检查点整份落库）里都没有它。"""
    harness, _ = setup
    seen, _ = _turn(harness, [llm_tool("view_image", {"path": CHART}, call_id="v-1"),
                              llm_tool("calculate", {"lines": ["1+1"]}, call_id="c-1"), llm_text("好。")])
    assert len(_images_in(seen[1])) == 1 and _images_in(seen[2]) == []
    assert "data:image" not in json.dumps(seen[2], ensure_ascii=False)


def test_a_model_that_cannot_take_images_is_told_it_saw_nothing(setup):
    """§七：看图是增强——这一发的模型收不了图（比如换到了纯文本兜底模型），去掉图重问，照实说没看到。"""
    harness, _ = setup
    seen, events = _turn(harness, [llm_tool("view_image", {"path": CHART}, call_id="v-1"), llm_text("没看到图。")],
                         refuse_images=True)
    assert _images_in(seen[1]) and not _images_in(seen[2])            # 带图那一发被拒，紧接着重问一次
    assert "没能给你看" in json.dumps(seen[2][-1], ensure_ascii=False)
    assert any(e.get("type") == "complete" for e in events)


@pytest.mark.parametrize("path,error", [("output/report.pdf", "not_an_image"), ("output/nope.png", "file_not_found")])
def test_what_is_not_an_image_is_said_not_shown(setup, path, error):
    harness, _ = setup
    seen, _ = _turn(harness, [llm_tool("view_image", {"path": path}, call_id="v-1"), llm_text("好。")])
    assert _images_in(seen[1]) == []
    assert error in next(m for m in seen[1] if m.get("tool_call_id") == "v-1")["content"]


def test_with_a_project_it_reads_the_project_sandbox(setup):
    _, provider = setup
    token = model_images.begin()
    try:
        state = V5SessionState(sessionId="sr-img", ownerId="alice", goal={"text": TOPIC})
        assert control._view_workspace_image(state, CHART)["ok"]
        state.projectId = "prj-7"
        assert control._view_workspace_image(state, CHART)["ok"]
    finally:
        model_images.end(token)
    assert provider.asked == ["scratch-sr-img", "ws-prj-7"]          # 没工程读临时沙盒，有工程读工程沙盒


def test_a_huge_render_is_shrunk_before_it_is_sent():
    token = model_images.begin()
    try:
        summary = model_images.attach(_png(4000, 2500), "big.png")
        [image] = model_images.take()
    finally:
        model_images.end(token)
    shown = Image.open(io.BytesIO(base64.b64decode(image["url"].split(",", 1)[1])))
    assert max(shown.size) == model_images.MAX_SIDE and summary["width"] == shown.size[0]   # 回执报的是模型看到的尺寸


class _Store:
    def put_preview_snapshot(self, *a, **kw):
        pass


@pytest.mark.parametrize("source,attached", [("browser_view", True), ("browser_interact", False)])
def test_the_browser_screenshot_goes_to_the_model_too(source, attached):
    """browser_view 的截图原来只落成缩略图；点击之类的动作不自动附（看就显式 browser_view），省 token。"""
    from services.project_tools import ProjectTools
    fake = type("P", (), {"store": _Store(), "owner_id": "alice"})()
    project = type("Pr", (), {"projectId": "prj-7", "currentRevision": "r1"})()
    token = model_images.begin()
    try:
        result = {"screenshot": base64.b64encode(_png()).decode(), "revision": "r1"}
        ProjectTools._keep_preview_snapshot(fake, project, result, source=source)
        taken = model_images.take()
    finally:
        model_images.end(token)
    assert bool(taken) is attached
    if attached:
        assert "只给这一次" in result["screenshotForModel"]


def test_known_on_both_sides_and_safe_to_retry():
    from pathlib import Path
    from services.closed_tools import CLOSED_TOOLS
    from services.control_goal_continuation import READ_ONLY_TOOLS
    assert "view_image" in CLOSED_TOOLS and "view_image" in READ_ONLY_TOOLS
    ts = (Path(__file__).resolve().parents[2] / "client/src/lib/factory-hops.ts").read_text("utf-8")
    assert '"view_image"' in ts and 'tool === "view_image"' in ts


@pytest.mark.parametrize("path", ["../../etc/passwd", "/etc/passwd", "output/../../x.png", "a\x00b.png", "C:/x.png"])
def test_reading_stays_inside_the_workspace(path):
    """只读工作区根下的相对路径：不许跳出去读沙盒里别的东西。"""
    from services.e2b_workspace_provider import E2BWorkspaceProvider
    provider = E2BWorkspaceProvider.__new__(E2BWorkspaceProvider)
    provider._sandbox = lambda handle: pytest.fail("越界路径不该走到沙盒")
    with pytest.raises(ValueError):
        provider.read_file_bytes(WorkspaceHandle("ws-prj-7", "sbx-1"), path, max_bytes=1024)


def test_the_absolute_workspace_form_is_read_as_relative():
    from services.e2b_workspace_provider import PROJECT_ROOT, E2BWorkspaceProvider
    asked = []
    files = type("F", (), {"read": lambda self, p, format: asked.append(p) or b"\x89PNG\r\n\x1a\nxx"})()
    provider = E2BWorkspaceProvider.__new__(E2BWorkspaceProvider)
    provider._sandbox = lambda handle: type("S", (), {"files": files})()
    provider.read_file_bytes(WorkspaceHandle("ws-prj-7", "sbx-1"), f"{PROJECT_ROOT}/output/a.png", max_bytes=1024)
    assert asked == [f"{PROJECT_ROOT}/output/a.png"]
