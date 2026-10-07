"""右栏预览 / 卡片缩略图画的那份 xlsx：没存结果的公式，宿主按公式补上存值；下载的原件一个字节不动。

⚠ 2026-10-07 真机 r55 / r56 sr-20261007062152-HKXEC83K48（报销 Excel 追问）：openpyxl load→改→save，汇总页 12 个公式
  的存值全空。@silurus/ooxml 只认存值，用户在右栏和缩略图里看到一整列空白（Excel 打开会重算、是对的）。
  ⚠ 第一版补算接在 office_preview_payload 上——那是库里存的 JSON 预览，不是用户看的两处（§一），本文件钉的是字节那条路。

夹具：reimbursement_r55_resaved_uncached.xlsx（12 格全空，那一轮交付原样）、reimbursement_r51_cached.xlsx（同一张表
XlsxWriter 带值写的，上一版原样）——补出来的数必须跟 r51 存的一模一样。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from routes import project_sources as route
from services import persistence
from services.deliverable_kind import OFFICE_FILE, _xlsx_evaluator, office_facts, xlsx_preview_bytes
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.project_store import ProjectStore
from services.session_blob_store import SqlSessionBlobStore

FIXTURES = Path(__file__).parent / "fixtures"
UNCACHED = (FIXTURES / "reimbursement_r55_resaved_uncached.xlsx").read_bytes()
CACHED = (FIXTURES / "reimbursement_r51_cached.xlsx").read_bytes()
ROOT = Path(__file__).resolve().parents[2]


def _stored(data: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        cells, _ = _xlsx_evaluator(archive, archive.namelist())
    return {key: value for key, (formula, value) in cells.items() if formula}


def test_the_filled_values_are_exactly_what_the_previous_version_stored():
    out = xlsx_preview_bytes(UNCACHED)
    facts = office_facts(out, "a.xlsx")
    assert facts["formulas"] == 12 and facts["formulasUncached"] == 0 and facts["formulasWrong"] == 0
    assert _stored(out) == _stored(CACHED)                      # 4960 / 3 / 1 / 356.5 … 跟 r51 存的逐格一致


def test_formulas_and_everything_else_are_kept():
    """只补 <v>：公式文本、表、其他部件都在。"""
    out = xlsx_preview_bytes(UNCACHED)
    with zipfile.ZipFile(io.BytesIO(UNCACHED)) as a, zipfile.ZipFile(io.BytesIO(out)) as b:
        assert a.namelist() == b.namelist()
        for name in a.namelist():
            if not name.startswith("xl/worksheets/"):
                assert a.read(name) == b.read(name)
    with zipfile.ZipFile(io.BytesIO(UNCACHED)) as a, zipfile.ZipFile(io.BytesIO(out)) as b:
        before, _ = _xlsx_evaluator(a, a.namelist())
        after, _ = _xlsx_evaluator(b, b.namelist())
    assert {k: f for k, (f, _v) in before.items()} == {k: f for k, (f, _v) in after.items()}


def test_files_that_need_nothing_or_cannot_be_read_come_back_untouched():
    """反向：本来就带存值的、不是 xlsx 的，原样（同一个对象）返回——增强项不许改坏东西。"""
    assert xlsx_preview_bytes(CACHED) is CACHED
    junk = b"not a zip"
    assert xlsx_preview_bytes(junk) is junk


def test_the_preview_view_is_filled_and_the_download_is_the_original(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    state = V5SessionState(sessionId="xlsx-preview", ownerId="alice", goal={"text": "报销 Excel"},
                           controlTranscript=approved_plan_rows("报销", deliverable_kind=OFFICE_FILE))
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(store, state.sessionId, owner_id="alice",
                                     approval_ref=approved_reference(state), template_id="react-vite")
    meta = ProjectOfficeArtifactStore(store).put(project.projectId, owner_id="alice",
                                                 path="output/报销记录整理.xlsx", data=UNCACHED)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: User(id="alice", is_superuser=True)
    url = f"/api/sliderule/projects/{project.projectId}/artifacts/{meta['artifactId']}"
    with TestClient(app) as client:
        assert client.get(url).content == UNCACHED                          # 下载：原件
        shown = client.get(url + "?view=preview").content
        assert office_facts(shown, "a.xlsx")["formulasUncached"] == 0         # 预览：补上了
        version = client.get(url + "/versions").json()["versions"][0]["sha256"]
        assert client.get(f"{url}/versions/{version}").content == UNCACHED
        assert office_facts(client.get(f"{url}/versions/{version}?view=preview").content, "a.xlsx")["formulasUncached"] == 0
    store.close()


def test_the_two_places_that_draw_fetch_the_preview_view_and_the_download_link_does_not():
    """接在链路上（§三、§四）：画文件的两处要带 ?view=preview；给用户的下载链接不带。剥注释后看源码。"""
    import re
    def code(rel):
        text = (ROOT / rel).read_text("utf-8")
        return re.sub(r"^\s*//.*$", "", re.sub(r"/\*[\s\S]*?\*/", "", text), flags=re.M)
    assert "officePreviewUrl(" in code("client/src/pages/sliderule/project-runtime/PresentedOfficeFile.tsx")
    assert "officePreviewUrl(officeArtifactDownloadUrl(" in code("client/src/pages/sliderule/project-runtime/OfficeThumbnail.tsx")
    assert "officePreviewUrl" not in code("client/src/pages/sliderule/project-runtime/PreviewFileDownload.tsx")
