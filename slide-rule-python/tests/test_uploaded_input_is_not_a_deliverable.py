"""用户上传的原件不是模型的交付：沙盒里跟原件一字不差的那份不收回产物库。

⚠ 2026-10-01 隔离真机第 174 轮 sr-20261001034539-SHFWQM6FET：上传「销售团队季度业绩.xlsx」要一份 Word 报告。
  第一条命令只是 load_workbook 读了一眼，回执就说「办公文件已收回：销售团队季度业绩.xlsx。这就是交付」，
  产物库多了一份跟上传 sha256（fa3dea45…）一模一样的 xlsx。办公目标的完工闸只问 has_any——光读一眼
  用户自己的表，这道 fail-closed 的闸就算有交付了。

夹具 `fixtures/round174_sales_upload.xlsx` 是那一轮上传的原件。收集走真 worker 方法、真上传库
（put_session_upload → list_session_uploads），收集器给的是 E2B collect_office_files 的原样形状
（相对工作区根的路径 + 字节）。把 worker 里 originals 那个 continue 删掉，第一条变红。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from types import SimpleNamespace

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import persistence
from services.deliverable_kind import OFFICE_FILE
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.project_runtime_worker import _RuntimeTask
from services.project_tools import _command_pointer
from test_office_artifacts import _project_setup

FIXTURES = Path(__file__).parent / "fixtures"
UPLOAD = (FIXTURES / "round174_sales_upload.xlsx").read_bytes()
REPORT = (FIXTURES / "round151_store_report_double_markers.docx").read_bytes()
NAME = "销售团队季度业绩.xlsx"
SID = "sess-upload-not-deliverable"


def _run(tmp_path, monkeypatch, files, *, broken_listing=False):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    state = V5SessionState(sessionId=SID, ownerId="alice", goal={"text": "根据上传的表写 Word 报告"},
                           controlTranscript=approved_plan_rows("写报告", deliverable_kind=OFFICE_FILE))
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(store, SID, owner_id="alice",
                                     approval_ref=approved_reference(state), template_id="react-vite")
    assert store.put_session_upload(SID, owner_id="alice", name=NAME, data=UPLOAD)["name"] == NAME
    if broken_listing:
        def boom(*_a, **_k):
            raise RuntimeError("db down")
        monkeypatch.setattr(store, "list_session_uploads", boom)
    task = SimpleNamespace(
        provider=SimpleNamespace(collect_office_files=lambda _h: files),
        handle=object(), store=store, owner_id="alice",
        original=SimpleNamespace(projectId=project.projectId, sessionId=SID), result={})
    _RuntimeTask._collect_office_artifacts(task)
    office = ProjectOfficeArtifactStore(store)
    paths = [row["path"] for row in office.list(project.projectId, owner_id="alice")]
    present = office.has_any(project.projectId, owner_id="alice")
    store.close()
    blobs._engine.dispose()
    return task.result, paths, present


def test_reading_the_upload_is_not_a_delivery(tmp_path, monkeypatch):
    result, paths, present = _run(tmp_path, monkeypatch, [{"path": NAME, "data": UPLOAD}])
    assert paths == [] and present is False            # 完工闸不因用户自己的表亮绿
    assert NAME not in (result.get("officeFiles") or [])
    hint = _command_pointer({"exitCode": 0, "status": "completed", **result}, "SHEETS ['季度业绩']")["hint"]
    assert "这就是交付" not in hint


def test_the_report_next_to_it_is_collected(tmp_path, monkeypatch):
    """反向：同一条命令写出的报告照收，原件仍不收。"""
    result, paths, present = _run(tmp_path, monkeypatch, [
        {"path": NAME, "data": UPLOAD}, {"path": "output/销售团队季度业绩分析报告.docx", "data": REPORT}])
    assert paths == ["output/销售团队季度业绩分析报告.docx"] and present is True
    assert result["officeFiles"] == ["output/销售团队季度业绩分析报告.docx"]


def test_an_upload_edited_in_place_is_the_models_output(tmp_path, monkeypatch):
    """反向：用户说「帮我改这张表」，模型在原件上改了——字节变了，那就是交付。"""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(UPLOAD)) as src, zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            body = src.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                assert b"<v>120000</v>" in body
                body = body.replace(b"<v>120000</v>", b"<v>121000</v>", 1)   # 销售员1 的 Q1 改一个数
            dst.writestr(item, body)
    result, paths, present = _run(tmp_path, monkeypatch, [{"path": NAME, "data": out.getvalue()}])
    assert paths == [NAME] and present is True and result["officeFiles"] == [NAME]


def test_an_unreadable_upload_list_falls_back_to_collecting(tmp_path, monkeypatch):
    """fail-open：上传清单读不到时照老样子收——宁可多收一份原件，不许少收模型的产出（§七）。"""
    _result, paths, _present = _run(tmp_path, monkeypatch, [{"path": NAME, "data": UPLOAD}], broken_listing=True)
    assert paths == [NAME]


# ── 办公技能的中间底稿（第 175 轮）────────────────────────────────────────────
# ⚠ 2026-10-01 sr-20261001041148-WXKFWTYK33：模型照 office-skills 的约定先写 bridge/01-cleaned-data.xlsx、
#   bridge/03-chart-sources.xlsx，宿主当交付收了，PPT 还没写出来完工闸就能亮。路径是那一轮回执原样。


def test_bridge_working_files_are_not_deliverables(tmp_path, monkeypatch):
    working = [{"path": "bridge/01-cleaned-data.xlsx", "data": UPLOAD},
               {"path": "bridge/03-chart-sources.xlsx", "data": UPLOAD + b""}]
    result, paths, present = _run(tmp_path, monkeypatch, working)
    assert paths == [] and present is False
    assert "officeFiles" not in result


def test_the_deck_in_output_is_collected_next_to_the_bridge(tmp_path, monkeypatch):
    """反向：同一条命令的 output/ 成品照收；名字里带 bridge 的成品也照收（只认顶层目录）。"""
    result, paths, _present = _run(tmp_path, monkeypatch, [
        {"path": "bridge/01-cleaned-data.xlsx", "data": UPLOAD},
        {"path": "output/bridge-年度汇报.docx", "data": REPORT}])
    assert paths == ["output/bridge-年度汇报.docx"]


def test_the_skill_still_says_bridge_is_not_for_the_user():
    """这条规矩是照 office-skills 的约定定的：那份技能哪天不再这么写，这里先红，别让宿主替它记着过期的约定。"""
    import zipfile as _zip
    seed = Path(__file__).resolve().parents[2] / "skills" / "seeds" / "office-skills.zip"
    with _zip.ZipFile(seed) as archive:
        body = archive.read(next(n for n in archive.namelist() if n.endswith("SKILL.md"))).decode()
    assert "`bridge/`: cleaned data" in body and "`output/`: final user-facing artifacts only" in body
