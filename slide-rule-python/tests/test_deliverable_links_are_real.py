"""模型给了一个用户点不开的文件地址，宿主换成真下载地址。

⚠ 2026-09-27 隔离真机 sr-20260927055919-BC2H6NDWZT：回执里写着真链接和
  「不要写沙盒里的路径」，模型收尾照样给了 `sandbox:/mnt/data/…pptx`（路径也是编的）。
  前端把它画成不可点的字，用户在收尾那句话里拿不到文件。

第一组用那一轮收尾原话；第二组走真控制循环（工程已建、库里有收回的 pptx），
量流出去的 control_text 和落库的 transcript 两处。
把 rehearsal_control 里 _with_deliverable_links 的调用删掉，第二组变红。
"""

from __future__ import annotations

import pytest

from conftest import TEST_USER_ID
from project_actor_support import project_actor  # noqa: F401  （夹具）
from control_turn_support import ControlHarness, llm_text
from services.project_creation import create_session_project
from services.project_office_artifacts import (
    ProjectOfficeArtifactStore, office_artifact_download_url, rewrite_deliverable_links)
from services.slide_rule_session import load_session
from test_control_project_tools import post, setup  # noqa: F401  （夹具）
from test_office_artifacts import minimal_pptx

ROUND22_CLOSING = '已完成并检查文件可正常打开，共 10 页，面向管理层设计，包含示例数据标识、三个关键指标、两项成果、两项未达成事项及下季度三项优先工作。\n\n下载文件：[2026_Q3_Product_Review.pptx](sandbox:/mnt/data/2026_Q3_Product_Review.pptx)'
DECK = "2026_Q3_Product_Review.pptx"
URL = "/api/sliderule/projects/prj-1/artifacts/art-1"


def test_the_real_closing_line_gets_the_real_link():
    out = rewrite_deliverable_links(ROUND22_CLOSING, {DECK: URL})
    assert f"[{DECK}]({URL})" in out
    assert "sandbox:" not in out
    assert out.startswith("已完成并检查文件可正常打开")  # 其余一个字不动


@pytest.mark.parametrize("target", [
    f"sandbox:/home/user/workspace/{DECK}", f"/home/user/workspace/{DECK}", DECK, f"./{DECK}",
    f"sandbox:/mnt/data/{DECK.replace('_', '%5F')}",
])
def test_every_local_spelling_of_the_same_file_is_swapped(target):
    assert rewrite_deliverable_links(f"[下载]({target})", {DECK: URL}) == f"[下载]({URL})"


@pytest.mark.parametrize("text", [
    "[下载](sandbox:/mnt/data/other.pptx)",        # 对不上的不猜
    "[官网](https://example.com/2026_Q3_Product_Review.pptx)",
    f"[下载]({URL})",
    "没有链接的一句话",
])
def test_what_does_not_match_is_left_alone(text):
    assert rewrite_deliverable_links(text, {DECK: URL}) == text


def test_on_the_live_loop_both_the_stream_and_the_stored_line_carry_the_real_link(setup, monkeypatch):
    project = create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID,
                                     approval_ref=setup.ref)
    meta = ProjectOfficeArtifactStore(setup.store).put(
        project.projectId, owner_id=TEST_USER_ID, path=DECK, data=minimal_pptx())
    real = office_artifact_download_url(project.projectId, meta["artifactId"])
    harness = ControlHarness(monkeypatch)
    harness.llm_impl = lambda *a, **kw: llm_text(ROUND22_CLOSING)

    events = post(setup.state)

    said = [e["text"] for e in events if e.get("type") == "control_text"]
    assert said and all("sandbox:" not in t for t in said), said
    assert any(f"({real})" in t for t in said), said
    stored = [r["text"] for r in load_session(setup.state.sessionId).controlTranscript
              if r.get("kind") == "control_text"]
    assert stored and all("sandbox:" not in t for t in stored) and any(f"({real})" in t for t in stored)


# ── message_notify_user：同一段话只说一遍，而且落库 ─────────────────────────
#: sr-20260927055919-BC2H6NDWZT 那一轮的原话。
NOTIFY = "我将按已批准结构生成可编辑的 10 页 PowerPoint，内容中的数值会明确标注为示例数据，并在生成后检查文件可打开性与页数。"


def test_a_notification_is_said_once_and_survives_a_reload(setup, monkeypatch):
    """⚠ 真机里这段话在左栏出现两遍：开场事件的 summary 画成「通知用户」那行的明细，
    紧跟的 control_text 又画成一段开口；而 control_text 不落库，刷新后只剩明细那份。
    把 notify 分支改回带 summary / 不落库，这条变红。"""
    create_session_project(setup.store, setup.state.sessionId, owner_id=TEST_USER_ID, approval_ref=setup.ref)
    from control_turn_support import llm_tool
    harness = ControlHarness(monkeypatch)
    harness.llm_impl = lambda messages, **kw: (
        llm_text("好了。") if any(m["role"] == "tool" for m in messages)
        else llm_tool("message_notify_user", {"text": NOTIFY}))

    events = post(setup.state)

    start = [e for e in events if e.get("type") == "control_tool_start" and e.get("tool") == "message_notify_user"]
    assert start and all(NOTIFY not in str(e.get("summary") or "") for e in start), start
    assert [e["text"] for e in events if e.get("type") == "control_text"].count(NOTIFY) == 1
    rows = load_session(setup.state.sessionId).controlTranscript
    assert [r.get("text") for r in rows if r.get("kind") == "control_text"].count(NOTIFY) == 1
    assert all(NOTIFY not in str(r.get("summary") or "") for r in rows if r.get("kind") == "tool_start")
