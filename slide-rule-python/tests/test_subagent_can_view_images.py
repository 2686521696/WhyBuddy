"""子代理也能看图：派出去「独立读图」的子代理真的拿到那张图，没看到就照实说。

⚠ 2026-10-07 真机 r85 sr-20261007155747-HMKAPNJ7WK（@data-visualization-discipline 遮字测试）：子代理只有读文本的工具，
  filesRead=README.md、draw_chart.py，filesMissing=那张遮字 PNG，交回的却是一段读图结论（services/subagent.VIEW_IMAGE_TOOL 头注）。
走真 ControlRunService 回合（同 test_subagent_tool）；图放进产物库（交付后的 output/ PNG 就在那儿）；图是 Pillow 画的真 PNG。
"""

from __future__ import annotations

import asyncio
import base64
import io
import json

from PIL import Image

from control_turn_support import llm_text, llm_tool, six_fields
from services import rehearsal_control as control
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from sliderule_llm.client import LlmError
from test_control_run_service import env, settled  # noqa: F401  （夹具）

MASKED = "output/门店上半年销售额趋势-遮字测试.png"
PROMPT = "只看 output/门店上半年销售额趋势-遮字测试.png 这张遮字图：哪条线增长最快？说出你从图上读到的几何关系。"


def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (320, 200), (240, 240, 240)).save(out, format="PNG")
    return out.getvalue()


def _images(messages):
    return [p["image_url"]["url"] for m in messages if isinstance(m.get("content"), list)
            for p in m["content"] if p.get("type") == "image_url"]


def _run(env, monkeypatch, sub_script, *, put_image=True, refuse=False):
    project = create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref,
                                     template_id="react-vite")
    if put_image:
        ProjectOfficeArtifactStore(env.project).put(project.projectId, owner_id=env.owner, path=MASKED, data=_png())
    monkeypatch.setattr(control, "_scratch_sandboxes", lambda: None)      # 沙盒读不到：只靠产物库
    main_calls, sub_calls, sub_tools = [], [], []
    main = iter([llm_tool("subagent", {"description": "独立遮字读图", "prompt": PROMPT}, call_id="call-sub"),
                 llm_text("收到。")])
    sub = iter(sub_script)

    async def model(messages, **kwargs):
        names = {t["function"]["name"] for t in kwargs.get("tools") or []}
        if names <= {"read_file", "list_files", "search_files", "view_image"} and "read_file" in names:
            sub_calls.append(json.loads(json.dumps(messages, ensure_ascii=False)))
            sub_tools.append(names)
            if refuse and _images(messages):
                raise LlmError("400 image_url not supported", status=400, transient=False)
            return next(sub)
        main_calls.append(json.loads(json.dumps(messages, ensure_ascii=False)))
        return next(main)
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    record = env.store.submit(env.state.sessionId, env.owner, "sub-img", six_fields(env.state.sessionId, "画图并做遮字测试"))

    async def run():
        service = env.service()
        await service.start()
        try:
            return await settled(service, record["runId"])
        finally:
            await service.shutdown()
    asyncio.run(run())
    back = next(m for m in main_calls[-1] if m.get("role") == "tool" and m.get("tool_call_id") == "call-sub")
    return sub_calls, sub_tools, json.loads(back["content"]) if back["content"].startswith("{") else back["content"]


def test_the_subagent_sees_the_masked_chart(env, monkeypatch):
    sub_calls, sub_tools, back = _run(env, monkeypatch, [
        llm_tool("view_image", {"path": MASKED}, call_id="s-1"), llm_text("看到了：一张浅灰底的图。")])
    assert "view_image" in sub_tools[0]
    [url] = _images(sub_calls[1])
    assert base64.b64decode(url.split(",", 1)[1]) == _png()               # 就是产物库里那张
    assert MASKED in json.dumps(back, ensure_ascii=False)                  # 回给主代理的 filesRead 里有它
    assert not _images(sub_calls[0])


def test_a_missing_image_is_reported_missing(env, monkeypatch):
    """反向：图不在——不附图，回执说没有，filesMissing 里点名（主代理据此知道它没看到）。"""
    sub_calls, _tools, back = _run(env, monkeypatch, [
        llm_tool("view_image", {"path": MASKED}, call_id="s-1"), llm_text("没看到图。")], put_image=False)
    assert not _images(sub_calls[1])
    assert MASKED in back.get("filesMissing", [])


def test_a_model_that_cannot_take_images_is_told(env, monkeypatch):
    sub_calls, _tools, back = _run(env, monkeypatch, [
        llm_tool("view_image", {"path": MASKED}, call_id="s-1"), llm_text("没能看到图。")], refuse=True)
    assert _images(sub_calls[1]) and not _images(sub_calls[2])
    assert "没能给你看" in json.dumps(sub_calls[2][-1], ensure_ascii=False)
    assert back.get("ok") is True


def test_an_image_named_up_front_is_shown_not_reported_missing(env, monkeypatch):
    """r93：主代理把图放进 files 预先附上——第一次就带着图，不进 filesMissing。"""
    project = create_session_project(env.project, env.state.sessionId, owner_id=env.owner, approval_ref=env.ref,
                                     template_id="react-vite")
    ProjectOfficeArtifactStore(env.project).put(project.projectId, owner_id=env.owner, path=MASKED, data=_png())
    monkeypatch.setattr(control, "_scratch_sandboxes", lambda: None)
    sub_calls, main_calls = [], []
    main = iter([llm_tool("subagent", {"description": "独立复核", "prompt": PROMPT, "files": [MASKED]}, call_id="call-sub"),
                 llm_text("好。")])
    sub = iter([llm_text("浅灰底，一张图。")])

    async def model(messages, **kwargs):
        names = {t["function"]["name"] for t in kwargs.get("tools") or []}
        if names <= {"read_file", "list_files", "search_files", "view_image"} and "read_file" in names:
            sub_calls.append(json.loads(json.dumps(messages, ensure_ascii=False)))
            return next(sub)
        main_calls.append(json.loads(json.dumps(messages, ensure_ascii=False)))
        return next(main)
    monkeypatch.setattr(control, "_invoke_control_llm", model)
    record = env.store.submit(env.state.sessionId, env.owner, "sub-img-up", six_fields(env.state.sessionId, "复核"))

    async def run():
        service = env.service()
        await service.start()
        try:
            return await settled(service, record["runId"])
        finally:
            await service.shutdown()
    asyncio.run(run())
    assert len(_images(sub_calls[0])) == 1
    back = json.loads(next(m for m in main_calls[-1] if m.get("tool_call_id") == "call-sub")["content"])
    assert MASKED in back["filesRead"] and MASKED not in back.get("filesMissing", [])
