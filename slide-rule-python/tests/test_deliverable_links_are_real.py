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


# ⚠ 2026-09-27 隔离真机第 68 轮 sr-20260927200602-F9YJD14NHC（门店销售 Excel 追问透视表）：
#   模型抄了回执里的真地址，却在前面加了 sandbox:。按文件名配不上（末段是 art-id），
#   原样交给用户，点不开。收尾原话、地址原样。
ROUND68_BOOK = "门店销售明细.xlsx"
ROUND68_URL = "/api/sliderule/projects/prj-d78277eeecab5db2b95c6444fd1053d2/artifacts/art-ee926db0f73071d34b0a559a893f563267e9688e"
ROUND68_CLOSING = f"已核验：工作簿包含 3 个工作表、30 行销售明细、6 条产品月份汇总记录；汇总公式、格式和表格结构正确。\n\n[下载更新后的门店销售明细.xlsx](sandbox:{ROUND68_URL})"


def test_a_real_link_with_a_sandbox_prefix_is_repaired():
    out = rewrite_deliverable_links(ROUND68_CLOSING, {ROUND68_BOOK: ROUND68_URL})
    assert f"[下载更新后的门店销售明细.xlsx]({ROUND68_URL})" in out
    assert "sandbox:" not in out


def test_a_sandbox_prefixed_address_the_host_never_gave_is_left_alone():
    """反向：去掉 sandbox: 之后不是宿主给过的那串（这里 art-id 被改了一位），不猜。"""
    forged = f"[下载](sandbox:{ROUND68_URL[:-1]}0)"
    assert rewrite_deliverable_links(forged, {ROUND68_BOOK: ROUND68_URL}) == forged



# ⚠ 2026-09-29 隔离真机第 119 轮 sr-20260929114248-GE1TQ9N3T8（新员工入职培训 PPT）：收尾最后一行原样。相对地址前面多了 `https://`，
#   主机名成了 `api`。把 rewrite_deliverable_links 里 urlsplit 那一段删掉，下面第一条变红。
ROUND119_URL = "/api/sliderule/projects/prj-862f14649fc65b53982563b384fbefbe/artifacts/art-d965f1b6fa4e3fb9826ab489d26500ef8c7ad840"
ROUND119_CLOSING = ("- 几何、可访问性和 OOXML 包检查均通过。\n\n"
                    "[下载最终 PPTX](https://api/sliderule/projects/prj-862f14649fc65b53982563b384fbefbe/"
                    "artifacts/art-d965f1b6fa4e3fb9826ab489d26500ef8c7ad840)")


def test_the_round119_scheme_glued_onto_a_relative_link_is_repaired():
    out = rewrite_deliverable_links(ROUND119_CLOSING, {"output/onboarding_training_deck.pptx": ROUND119_URL})
    assert out.endswith(f"[下载最终 PPTX]({ROUND119_URL})") and "https://api" not in out


@pytest.mark.parametrize("target", [
    "https://example.com/api/sliderule/projects/prj-862f14649fc65b53982563b384fbefbe/artifacts/x",   # 真外链
    "https://api/sliderule/projects/prj-other/artifacts/art-other",                                    # 宿主没给过
    "https://docs.python.org/3/",
])
def test_links_that_are_not_ours_are_left_as_written(target):
    """反向：只有逐字等于宿主给过的地址才换，真外链和编出来的都不碰。"""
    text = f"[看这里]({target})"
    assert rewrite_deliverable_links(text, {"output/onboarding_training_deck.pptx": ROUND119_URL}) == text



# ⚠ 2026-09-29 隔离真机第 131 轮 sr-20260929164809-ATK2F34V0B（IT 设备领用须知 Word，追问「PDF 第一页加 logo 占位」）：PDF 交不出去，
#   收尾写 `[下载 PDF](…/art-2a8e…)`——那是原来那份 .docx。夹具是那一轮收尾原样（含 `\\/api` 转义斜杠）。
#   把 rewrite_deliverable_links 里 _honest_format 那一层拿掉，下面第一条变红。
import json as _json
from pathlib import Path as _Path

ROUND131_CLOSING = _json.loads((_Path(__file__).parent / "fixtures" / "round131_pdf_link_closing.json").read_text("utf-8"))
ROUND131_DOWNLOADS = {
    "output/新员工IT设备领用须知.docx": "/api/sliderule/projects/prj-7a8ef95d28bc5b64999eb77f155a6dbb/artifacts/art-2a8eb32a98a66ecca03b9178e1d9cd94a3b6a1a1",
    "output/新员工IT设备领用须知_2.docx": "/api/sliderule/projects/prj-7a8ef95d28bc5b64999eb77f155a6dbb/artifacts/art-a5cc1123e4b607f53d76ece94d83c6344d1e89ad",
}


def test_the_round131_pdf_link_to_a_word_file_is_taken_down():
    out = rewrite_deliverable_links(ROUND131_CLOSING, ROUND131_DOWNLOADS)
    assert "[下载 PDF](" not in out                                  # 点了拿错文件的链接没了
    assert "下载 PDF（没有这个文件：这个链接其实是 新员工IT设备领用须知.docx）" in out
    assert "[下载更新后的 DOCX](" in out and "art-a5cc1123e4b607f53d76ece94d83c6344d1e89ad" in out   # 对的那条不动
    assert out.startswith("已完成：在 PDF 第一页标题区域上方")          # 其余一个字不动


@pytest.mark.parametrize("label", ["下载 Word 文档", "新员工IT设备领用须知.docx", "下载文件", "点这里"])
def test_a_label_that_matches_or_names_no_format_is_left_alone(label):
    """反向：文字说的格式对得上、或者根本没说格式，链接原样。"""
    url = ROUND131_DOWNLOADS["output/新员工IT设备领用须知.docx"]
    text = f"[{label}]({url})"
    assert rewrite_deliverable_links(text, ROUND131_DOWNLOADS) == text


def test_a_link_the_host_did_not_give_is_not_judged():
    """反向：不是宿主给的地址（外链），不拿它的文字对格式。"""
    text = "[PDF 版说明](https://example.com/guide.docx)"
    assert rewrite_deliverable_links(text, ROUND131_DOWNLOADS) == text
