"""收回的办公文件里到底有什么，宿主量出来交给模型——描述文件要有据。

⚠ 2026-09-26 隔离真机 sr-20260926043506-7B49NNSE1M：交付语是「三个关键指标及
  可编辑图表」「内容与图表均为可编辑元素」。文件里 ppt/charts/ 一个都没有，
  指标图是矩形拼的。模型唯一的核验是 len(p.slides)，图表那半句没有工具结果撑着。

夹具 `fixtures/q3_review_shapes_not_charts.pptx` 是那一轮收回的原样文件
（sha256 0c68c064…）。四跳各钉一条：量 → worker 记 → 快照白名单 → 回执那句话。
把 worker 里记 officeFacts 那段删掉，第二组变红；把 operation_snapshot 的转抄
删掉，第三组变红。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from types import SimpleNamespace

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import persistence
from services.deliverable_kind import OFFICE_FILE, office_facts, office_facts_sentence
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_runtime_worker import _RuntimeTask
from services.project_tools import _command_pointer, operation_snapshot
from test_office_artifacts import _project_setup

DECK = (Path(__file__).parent / "fixtures" / "q3_review_shapes_not_charts.pptx").read_bytes()


def _zip(parts: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("[Content_Types].xml", b"<Types/>")
        for name, body in parts.items():
            archive.writestr(name, body)
    return buf.getvalue()


# ── 一、量 ────────────────────────────────────────────────────────────────


def test_the_real_deck_has_ten_slides_and_no_native_chart():
    assert office_facts(DECK, "2026年第三季度产品复盘.pptx") == {
        "slides": 10, "charts": 0, "pictures": 0, "tables": 0}


def test_a_native_chart_a_picture_and_a_table_are_counted():
    """反向：真有原生图表 / 图片 / 表格时要数得出来，否则「0 个」也只是个常数。"""
    deck = _zip({
        "ppt/slides/slide1.xml": b"<p:sld><a:tbl></a:tbl></p:sld>",
        "ppt/slides/slide2.xml": b"<p:sld/>",
        "ppt/charts/chart1.xml": b"<c:chartSpace/>",
        "ppt/charts/style1.xml": b"<cs:chartStyle/>",  # 图表样式不是图表
        "ppt/media/image1.png": b"\x89PNG",
    })
    assert office_facts(deck, "a.pptx") == {"slides": 2, "charts": 1, "pictures": 1, "tables": 1}
    sheet = _zip({"xl/worksheets/sheet1.xml": b"<w/>", "xl/worksheets/sheet2.xml": b"<w/>",
                  "xl/charts/chart1.xml": b"<c/>"})
    assert office_facts(sheet, "b.xlsx") == {"sheets": 2, "charts": 1, "pictures": 0}
    doc = _zip({"word/document.xml": b"<w:body><w:tbl></w:tbl><w:tbl></w:tbl></w:body>"})
    assert office_facts(doc, "c.docx") == {"tables": 2, "charts": 0, "pictures": 0}


def test_what_cannot_be_measured_is_not_invented():
    """fail-open：量不出来就不给，不编一组数。"""
    assert office_facts(b"not a zip", "a.pptx") is None
    assert office_facts(DECK, "deck.py") is None
    assert office_facts(b"PK\x03\x04garbage", "a.pptx") is None


# ── 二、worker 在收回时记下 ─────────────────────────────────────────────────


def _collect(tmp_path, monkeypatch, batches):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-office-facts"
    state = V5SessionState(sessionId=sid, ownerId="alice", goal={"text": "做个PPT"},
                           controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE))
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(store, sid, owner_id="alice",
                                     approval_ref=approved_reference(state), template_id="react-vite")
    results = []
    for files in batches:
        task = SimpleNamespace(
            provider=SimpleNamespace(collect_office_files=lambda _h, files=files: files),
            handle=object(), store=store, owner_id="alice",
            original=SimpleNamespace(projectId=project.projectId), result={})
        _RuntimeTask._collect_office_artifacts(task)
        results.append(task.result)
    store.close()
    blobs._engine.dispose()
    return results


def test_a_newly_collected_file_carries_its_facts(tmp_path, monkeypatch):
    first, again = _collect(tmp_path, monkeypatch, [
        [{"path": "复盘.pptx", "data": DECK}],
        [{"path": "复盘.pptx", "data": DECK}],  # 同一份字节再扫一遍
    ])
    assert first["officeFiles"] == ["复盘.pptx"]
    assert first["officeFacts"] == {"复盘.pptx": {"slides": 10, "charts": 0, "pictures": 0, "tables": 0}}
    # 反向：没变的旧文件不是这条命令的产出，不重复报一遍
    assert again["officeFilesHeld"] == ["复盘.pptx"]
    assert "officeFacts" not in again


# ── 三、快照白名单 → 回执那句话 ─────────────────────────────────────────────


def _snapshot(saved):
    operation = SimpleNamespace(operationId="pop-1", kind="runtime.exec", status="completed",
                                expectedRevision="prv-1", cancelRequested=False, result=saved)
    return operation_snapshot({"operation": operation, "lastSeq": 3})


def test_the_receipt_states_the_measured_facts():
    saved = {"exitCode": 0, "officeFiles": ["复盘.pptx"],
             "officeFacts": {"复盘.pptx": office_facts(DECK, "复盘.pptx")}}
    snap = _snapshot(saved)
    assert snap["officeFacts"] == {"复盘.pptx": {"slides": 10, "charts": 0, "pictures": 0, "tables": 0}}
    hint = _command_pointer(snap, "saved 10")["hint"]
    assert office_facts_sentence("复盘.pptx", snap["officeFacts"]["复盘.pptx"]) in hint
    assert "原生图表 0 个" in hint and "以这些数为准" in hint


def test_no_facts_no_sentence():
    """反向：没量（旧文件、量失败）就不出这句，不拿空数凑。"""
    hint = _command_pointer(_snapshot({"exitCode": 0, "officeFiles": ["复盘.pptx"]}), "")["hint"]
    assert "文件实况" not in hint
