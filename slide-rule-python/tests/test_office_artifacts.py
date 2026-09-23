# -*- coding: utf-8 -*-
"""办公产物：bash 成功才回传，不进文本源码树。

⚠ 2026-09-20 真机 sr-20260920090915-OFFICEAT：generate_deck.py 在源码树，
  .pptx 停在沙箱。判据必须执行 worker._collect_office_artifacts 和
  run_command 源码，不许重抄一份收集逻辑。
"""

from __future__ import annotations

import ast
import asyncio
import base64
import io
import json
import re
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from plan_approval_support import approved_plan_rows
from project_actor_support import project_actor
from models.v5_state import V5SessionState
from routes import project_sources as route
from services.control_run_service import ControlRunService
from services.deliverable_kind import (
    OFFICE_FILE,
    OFFICE_FILE_NOT_TEXT,
    OFFICE_START_NOT_APPLICABLE,
    is_office_artifact_path,
    office_preview_html,
    office_preview_payload,
)
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_export import source_archive
from services.project_office_artifacts import ProjectOfficeArtifactStore, decode_office_write
from services.project_runtime_worker import ProjectRuntimeSupervisor, _RuntimeTask
from services.project_store import ProjectStore
from services.project_tools import ProjectTools
from services import persistence, project_creation, project_tools
from services.project_workspace_artifacts import ARTIFACT_IO_SCRIPT
from services.session_blob_store import SqlSessionBlobStore


ROOT = Path(__file__).resolve().parents[1]
WORKER_SRC = ROOT / "services" / "project_runtime_worker.py"
TOOLS_SRC = ROOT / "services" / "project_tools.py"


def _fn_body(src: str, name: str) -> str:
    tree = ast.parse(src)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    )
    start = fn.lineno - 1
    end = fn.end_lineno or start + 1
    return "\n".join(src.splitlines()[start:end])


def minimal_pptx(text: str = "面团启动") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
        )
        archive.writestr(
            "ppt/slides/slide1.xml",
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            f"<a:t>{text}</a:t></p:sld>",
        )
    return buf.getvalue()


def positioned_pptx() -> bytes:
    slide = """<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="0B1F17"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:sp>
        <p:spPr>
          <a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm>
          <a:solidFill><a:srgbClr val="C2410C"/></a:solidFill>
        </p:spPr>
        <p:txBody>
          <a:p><a:r><a:rPr sz="3200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>面团 AI 办公</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"""
    presentation = """<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("ppt/presentation.xml", presentation)
        archive.writestr("ppt/slides/slide2.xml", slide.replace("面团 AI 办公", "第二页"))
        archive.writestr("ppt/slides/slide10.xml", slide.replace("面团 AI 办公", "第十页"))
    return buf.getvalue()


def test_slide_preview_keeps_position_and_numeric_order():
    """⚠ 2026-09-22 预览只有正文，右边是文档卡片。位置没了，舞台摆不出这一页。

    删掉 shapes 或改回文件名排序，本条变红。
    """
    preview = office_preview_payload(positioned_pptx(), "deck.pptx")
    assert preview is not None
    assert preview["slideWidth"] == 12192000
    assert [slide["text"] for slide in preview["slides"]] == ["第二页", "第十页"]
    shape = preview["slides"][0]["shapes"][0]
    assert shape["x"] == 457200 and shape["y"] == 274638
    assert shape["w"] == 8229600 and shape["h"] == 1143000
    assert shape["fontSize"] == 32 and shape["color"] == "#FFFFFF"
    assert shape["fill"] == "#C2410C"
    assert preview["slides"][0]["background"] == "#0B1F17"


def def_rpr_cover_pptx() -> bytes:
    """封面标题的白字在 defRPr 上，run 里没有 rPr。同一框里还有一行浅蓝副题。"""
    slide = """<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm>
      <a:solidFill><a:srgbClr val="0F172A"/></a:solidFill>
    </p:spPr></p:sp>
    <p:sp><p:spPr>
      <a:xfrm><a:off x="1188720" y="2011680"/><a:ext cx="6583680" cy="2377440"/></a:xfrm>
      <a:noFill/>
    </p:spPr><p:txBody><a:bodyPr/>
      <a:p><a:pPr><a:defRPr sz="4400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr>
        <a:r><a:t>面团AI办公启动会</a:t></a:r></a:p>
      <a:p><a:pPr><a:defRPr sz="1900"><a:solidFill><a:srgbClr val="93C5FD"/></a:solidFill></a:defRPr></a:pPr>
        <a:r><a:t>开启企业智能办公新范式</a:t></a:r></a:p>
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>"""
    presentation = """<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("ppt/presentation.xml", presentation)
        archive.writestr("ppt/slides/slide1.xml", slide)
    return buf.getvalue()


def test_def_rpr_keeps_each_line_color_and_size():
    """⚠ 2026-09-22 启动会封面白字在 defRPr。只认 rPr 时标题画成近黑。

    两行收成一个字号时，19pt 的副题不再出现。删掉 defRPr 或 lines，本条变红。
    """
    preview = office_preview_payload(def_rpr_cover_pptx(), "deck.pptx")
    assert preview is not None
    title = next(shape for shape in preview["slides"][0]["shapes"] if "面团AI办公启动会" in shape["text"])
    assert title["color"] == "#FFFFFF" and title["fontSize"] == 44
    assert title["lines"][0]["bold"] is True
    assert title["lines"][1]["color"] == "#93C5FD" and title["lines"][1]["fontSize"] == 19
    page = office_preview_html(preview)
    assert page is not None
    assert page.count("color:#93C5FD") == 2
    assert page.count("3.52cqh") == 2
    assert page.count("font-weight:700") == 2
    assert page.count('class="mini"') == 1
    assert ">面团AI办公启动会</button>" not in page


def test_filmstrip_is_a_miniature_of_each_slide():
    """⚠ 2026-09-22 底部是正文第一行截成的按钮，不是这一页的缩小。

    缩略图和舞台不是同一份版式，或点过一页之后选中框不再跟着走，本条变红。
    """
    page = office_preview_html(office_preview_payload(positioned_pptx(), "deck.pptx"))
    assert page is not None
    assert page.count('class="mini"') == 2
    assert page.count("left:3.750%") == 4
    assert 'class="badge">1</span>' in page and 'class="badge">2</span>' in page
    assert 'class="thumbs"' not in page
    assert ">第二页</button>" not in page
    assert "setAttribute('aria-current','true')" in page
    assert "toggleAttribute('aria-current'" not in page


def test_leaf_office_path_and_preview():
    assert is_office_artifact_path("deck.pptx")
    assert is_office_artifact_path("out/notes.docx")
    assert not is_office_artifact_path("generate_deck.py")
    preview = office_preview_payload(minimal_pptx("封面"), "deck.pptx")
    assert preview is not None
    assert preview["kind"] == "slides"
    assert "封面" in preview["slides"][0]["text"]
    assert office_preview_payload(b"not-a-zip", "deck.pptx") is None


def test_decode_office_write_rejects_text():
    try:
        decode_office_write("not zip", encoding=None)
        raise AssertionError("expected reject")
    except ValueError as exc:
        assert str(exc) == OFFICE_FILE_NOT_TEXT
    data = decode_office_write(base64.b64encode(minimal_pptx()).decode(), encoding="base64")
    assert data.startswith(b"PK")


def _project_setup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    from services.session_blob_store import SqlSessionBlobStore
    blobs = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: blobs)
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    return store, blobs


def test_store_put_and_has_any(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-put"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    office = ProjectOfficeArtifactStore(store)
    assert office.has_any(project.projectId, owner_id="alice") is False
    meta = office.put(
        project.projectId, owner_id="alice", path="面团AI办公启动会.pptx",
        data=minimal_pptx())
    assert meta["downloadable"] is True
    assert office.has_any(project.projectId, owner_id="alice") is True
    listed = office.list(project.projectId, owner_id="alice")
    assert [item["path"] for item in listed] == ["面团AI办公启动会.pptx"]
    _got, data = office.get_bytes(project.projectId, meta["artifactId"], owner_id="alice")
    assert data.startswith(b"PK")
    files = store.read_files(project.projectId, owner_id="alice")
    assert all(not path.endswith(".pptx") for path in files)
    store.close()
    blobs._engine.dispose()


def test_collect_hook_is_on_the_live_run_command():
    """命令结束后都扫，失败那条 raise 之前就要 collect。"""
    body = _fn_body(WORKER_SRC.read_text(encoding="utf-8"), "run_command")
    collect_at = body.find("_collect_office_artifacts")
    failed_at = body.find("project_command_failed")
    unknown_at = body.find("project_command_result_unknown")
    assert 0 <= collect_at < unknown_at < failed_at
    assert "generate_deck.py" not in body


def test_collect_office_artifacts_puts_zip_not_scripts(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-collect"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx()
    task = SimpleNamespace(
        provider=SimpleNamespace(
            collect_office_files=lambda _handle: [
                {"path": "deck.pptx", "data": pptx},
                {"path": "generate_deck.py", "data": b"print(1)"},
            ]
        ),
        handle=object(),
        store=store,
        owner_id="alice",
        original=SimpleNamespace(projectId=project.projectId),
        result={},
    )
    _RuntimeTask._collect_office_artifacts(task)
    assert task.result["officeFiles"] == ["deck.pptx"]
    office = ProjectOfficeArtifactStore(store)
    paths = [item["path"] for item in office.list(project.projectId, owner_id="alice")]
    assert paths == ["deck.pptx"]
    assert "generate_deck.py" not in paths
    store.close()
    blobs._engine.dispose()


def test_collect_skips_when_provider_missing():
    task = SimpleNamespace(
        provider=SimpleNamespace(),
        handle=object(),
        store=None,
        owner_id="alice",
        original=SimpleNamespace(projectId="prj-x"),
    )
    _RuntimeTask._collect_office_artifacts(task)


def test_goal_is_done_when_artifact_exists(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-done"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    ProjectOfficeArtifactStore(store).put(
        project.projectId, owner_id="alice", path="deck.pptx", data=minimal_pptx())

    service = SimpleNamespace(
        authorize=lambda *_a, **_k: state,
        project_store=store,
    )
    assert asyncio.run(ControlRunService._goal_is_done(
        service, {"sessionId": sid, "ownerId": "alice"})) is True
    assert asyncio.run(ControlRunService._goal_blocked_reasons(
        service, {"sessionId": sid, "ownerId": "alice"})) == []
    store.close()
    blobs._engine.dispose()


def test_project_start_does_not_start_vite_for_office_file(tmp_path, monkeypatch, project_actor):
    """办公计划不许 project_start 去起 Vite。"""
    project_actor("alice")
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-start"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite-tasks")
    tools = ProjectTools(store, None, "alice")
    result = tools.execute(
        "project_start",
        {"expectedRevision": project.currentRevision, "approvalRef": approved_reference(state),
         "idempotencyKey": "no-vite"},
        persistence.load_session_record(sid)["session"],
    )
    assert result["ok"] is False
    assert result["error"] == OFFICE_START_NOT_APPLICABLE
    store.close()
    blobs._engine.dispose()


def test_project_verify_blocked_in_source():
    body = _fn_body(TOOLS_SRC.read_text(encoding="utf-8"), "execute")
    verify_at = body.find('name == "project_verify"')
    reject_at = body.find("OFFICE_VERIFY_NOT_APPLICABLE")
    submit_at = body.find("submit_verification")
    assert 0 <= verify_at < reject_at < submit_at
    start_at = body.find('name == "project_start"')
    start_reject = body.find("OFFICE_START_NOT_APPLICABLE")
    submit_runtime = body.find("self.supervisor.submit(")
    assert 0 <= start_at
    assert 0 <= start_reject < submit_runtime


def test_collect_office_lives_in_the_sandbox_script():
    script = ARTIFACT_IO_SCRIPT
    collect_at = script.find('action == "collect-office"')
    magic_at = script.find(r"PK\x03\x04")
    skip_at = script.find("node_modules")
    assert 0 <= collect_at < skip_at < magic_at
    assert "generate_deck.py" not in script


def test_collect_office_files_decodes_on_the_live_provider():
    from services.e2b_workspace_provider import E2BWorkspaceProvider

    pptx = minimal_pptx("封面")
    calls = []

    class Fake:
        def _artifact_io(self, handle, action):
            calls.append(action)
            return {"files": [{
                "path": "deck.pptx",
                "data": base64.b64encode(pptx).decode(),
            }]}

    out = E2BWorkspaceProvider.collect_office_files(Fake(), object())
    assert calls == ["collect-office"]
    assert out == [{"path": "deck.pptx", "data": pptx}]


def test_collect_skips_script_even_when_it_arrives_first(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-order"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx()
    task = SimpleNamespace(
        provider=SimpleNamespace(
            collect_office_files=lambda _handle: [
                {"path": "generate_deck.py", "data": b"print(1)"},
                {"path": "deck.pptx", "data": pptx},
            ]
        ),
        handle=object(),
        store=store,
        owner_id="alice",
        original=SimpleNamespace(projectId=project.projectId),
        result={},
    )
    _RuntimeTask._collect_office_artifacts(task)
    assert task.result["officeFiles"] == ["deck.pptx"]
    paths = [
        item["path"]
        for item in ProjectOfficeArtifactStore(store).list(project.projectId, owner_id="alice")
    ]
    assert paths == ["deck.pptx"]
    store.close()
    blobs._engine.dispose()


def test_collect_stores_the_file_and_does_not_render_a_sandbox_pdf(tmp_path, monkeypatch):
    """预览在浏览器里画字节。收集时再转 PDF，说明又走回 soffice。"""
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-pdf"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个表"},
        controlTranscript=approved_plan_rows("做表", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx()
    seen = []

    def render(_handle, path):
        seen.append(path)
        return b"%PDF-1.4\n%sandbox\n"

    task = SimpleNamespace(
        provider=SimpleNamespace(
            collect_office_files=lambda _handle: [{"path": "名单.xlsx", "data": pptx}],
            render_office_pdf=render,
        ),
        handle=object(),
        store=store,
        owner_id="alice",
        original=SimpleNamespace(projectId=project.projectId),
        result={},
    )
    _RuntimeTask._collect_office_artifacts(task)
    assert seen == []
    assert task.result["officeFiles"] == ["名单.xlsx"]
    office = ProjectOfficeArtifactStore(store)
    meta = office.list(project.projectId, owner_id="alice")[0]
    preview = office.get_preview(project.projectId, meta["artifactId"], owner_id="alice")
    assert preview is None or preview.get("kind") != "pdf"
    store.close()
    blobs._engine.dispose()


def test_later_sandbox_pdf_replaces_homemade_preview(tmp_path, monkeypatch):
    """同一份字节先入库了 HTML，沙盒 PDF 后到必须换上。"""
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-pdf-upgrade"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx()
    office = ProjectOfficeArtifactStore(store)
    meta = office.put(project.projectId, owner_id="alice", path="deck.pptx", data=pptx)
    first = office.get_preview(project.projectId, meta["artifactId"], owner_id="alice")
    assert first is None or first.get("kind") != "pdf"
    pdf = b"%PDF-1.4\n%later\n"
    office.put(
        project.projectId, owner_id="alice", path="deck.pptx", data=pptx, preview_pdf=pdf)
    second = office.get_preview(project.projectId, meta["artifactId"], owner_id="alice")
    assert second["kind"] == "pdf"
    assert base64.b64decode(second["content"]) == pdf
    store.close()
    blobs._engine.dispose()


def test_garbage_preview_pdf_does_not_replace_html(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    sid = "sess-art-pdf-garbage"
    state = V5SessionState(
        sessionId=sid, ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, sid, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx()
    office = ProjectOfficeArtifactStore(store)
    meta = office.put(project.projectId, owner_id="alice", path="deck.pptx", data=pptx)
    before = office.get_preview(project.projectId, meta["artifactId"], owner_id="alice")
    office.put(
        project.projectId, owner_id="alice", path="deck.pptx", data=pptx, preview_pdf=b"not-a-pdf")
    after = office.get_preview(project.projectId, meta["artifactId"], owner_id="alice")
    assert after == before
    store.close()
    blobs._engine.dispose()


def test_office_pdf_script_says_when_soffice_is_missing(tmp_path):
    """脚本本体要报 soffice 不在，不许靠主机上的 which。"""
    import subprocess
    import sys

    from services.e2b_workspace_provider import _OFFICE_PDF_SCRIPT

    src = tmp_path / "a.pptx"
    src.write_bytes(b"PK\x03\x04")
    proc = subprocess.run(
        [sys.executable, "-I", "-S", "-c", _OFFICE_PDF_SCRIPT],
        input=json.dumps({"root": str(tmp_path), "path": "a.pptx"}),
        text=True, capture_output=True, timeout=30,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout) == {"ok": False, "reason": "soffice_missing"}


def test_render_office_pdf_reads_the_sandbox_reply_and_rejects_a_bad_path():
    from services.e2b_workspace_provider import E2BWorkspaceProvider

    pdf = b"%PDF-1.4\n%ok\n"
    reply = json.dumps({"ok": True, "pdf": base64.b64encode(pdf).decode()})

    class Proc:
        def send_stdin(self, data):
            self.data = data

        def close_stdin(self):
            pass

        def wait(self):
            return SimpleNamespace(exit_code=0, stdout=reply)

    class Commands:
        def run(self, *args, **kwargs):
            return Proc()

    class Sandbox:
        commands = Commands()

    class Fake:
        def _sandbox(self, handle):
            return Sandbox()

    assert E2BWorkspaceProvider.render_office_pdf(Fake(), object(), "名单.xlsx") == pdf
    assert E2BWorkspaceProvider.render_office_pdf(Fake(), object(), "../名单.xlsx") is None
    assert E2BWorkspaceProvider.render_office_pdf(Fake(), object(), "generate.py") is None


def test_preview_pdf_cap_matches_the_artifact_cap():
    from services.e2b_workspace_provider import OFFICE_PREVIEW_PDF_MAX
    from services.project_office_artifacts import MAX_OFFICE_ARTIFACT_BYTES

    assert OFFICE_PREVIEW_PDF_MAX == MAX_OFFICE_ARTIFACT_BYTES


@pytest.fixture
def tools_setup(tmp_path, monkeypatch, project_actor):
    project_actor("alice")
    monkeypatch.setattr(project_tools, "SHELL_EXEC_FOREGROUND_BLOCK_SECONDS", 0)
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *args: sessions)
    state = V5SessionState.server_load({
        "sessionId": "session-office-tools", "ownerId": "alice",
        "goal": {"text": "做个PPT", "status": "clear"},
        "controlTranscript": approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    })
    sessions.save(state.sessionId, state.model_dump(mode="json"), expected_rev=None)
    files = {"package.json": "{}", "src/App.tsx": "hello\n"}
    monkeypatch.setattr(project_creation, "load_project_template", lambda: (files.copy(), "test-vite-1"))
    supervisor = ProjectRuntimeSupervisor(store, lambda: (_ for _ in ()).throw(AssertionError("no provider")))
    supervisor._scanner = SimpleNamespace(is_alive=lambda: True)
    tools = ProjectTools(store, supervisor, "alice")
    yield SimpleNamespace(
        store=store, sessions=sessions, state=state, tools=tools,
        approval=approved_reference(state), files=files,
    )
    store.close()
    sessions._engine.dispose()


def test_file_write_office_path_rejects_text_and_stores_zip(tools_setup):
    created = tools_setup.tools.execute(
        "project_create", {"approvalRef": tools_setup.approval}, tools_setup.state)
    assert created["ok"], created
    rejected = tools_setup.tools.execute(
        "file_write", {"file": "deck.pptx", "content": "not zip"}, tools_setup.state)
    assert rejected == {"ok": False, "error": OFFICE_FILE_NOT_TEXT}
    pptx = minimal_pptx("封面")
    written = tools_setup.tools.execute(
        "file_write",
        {
            "file": "面团启动.pptx",
            "content": base64.b64encode(pptx).decode(),
            "contentEncoding": "base64",
        },
        tools_setup.state,
    )
    assert written["ok"] is True
    assert written["downloadable"] is True
    assert written["path"] == "面团启动.pptx"
    files = tools_setup.store.read_files(created["projectId"], owner_id="alice")
    assert "面团启动.pptx" not in files
    read = tools_setup.tools.execute(
        "file_read", {"file": "面团启动.pptx"}, tools_setup.state)
    assert read["ok"] is True
    assert read["content"] == ""
    assert read["downloadable"] is True
    assert read["sha256"] == written["sha256"]
    found = tools_setup.tools.execute(
        "file_find_by_name", {"path": ".", "glob": "*.pptx"}, tools_setup.state)
    assert found["ok"] is True
    assert "面团启动.pptx" in found["files"]


def test_export_and_http_serve_office_bytes(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    state = V5SessionState(
        sessionId="office-http", ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, state.sessionId, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    pptx = minimal_pptx("封面")
    meta = ProjectOfficeArtifactStore(store).put(
        project.projectId, owner_id="alice", path="面团启动.pptx", data=pptx)
    revision = store.get_revision(project.projectId, owner_id="alice")
    files = store.read_files(project.projectId, owner_id="alice")
    archive = source_archive(files, revision, artifacts={"面团启动.pptx": pptx})
    with zipfile.ZipFile(io.BytesIO(archive)) as packed:
        assert packed.read("artifacts/面团启动.pptx") == pptx
        assert all(not name.endswith(".pptx") for name in packed.namelist() if name.startswith("source/"))
    viewer = User(id="alice", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: viewer
    url = f"/api/sliderule/projects/{project.projectId}"
    with TestClient(app) as client:
        listed = client.get(url + "/artifacts")
        assert listed.status_code == 200
        assert listed.json()["files"][0]["path"] == "面团启动.pptx"
        preview = client.get(url + f"/artifacts/{meta['artifactId']}/preview")
        assert preview.status_code == 200
        body = preview.json()
        assert body["kind"] == "slides"
        assert "封面" in body["slides"][0]["text"]
        page = client.get(url + f"/artifacts/{meta['artifactId']}/preview?render=browser")
        assert page.status_code == 200
        assert page.headers["content-type"].startswith("text/html")
        assert "封面" in page.text
        # ⚠ 2026-09-23：这里原本钉的是 `function show(n)`（那段翻页脚本）。
        #   页面已经不带脚本了——翻页是 radio + :checked。真正要钉的是
        #   「翻页还在」和「响应头没给脚本开口子」，不是某一句 JS 的字面。
        assert '<input type="radio" name="wb-slide"' in page.text
        assert "<script" not in page.text
        sent = page.headers["content-security-policy"]
        assert "script-src 'none'" in sent
        assert "unsafe-inline" not in sent, sent
        import base64 as _b64
        import hashlib as _hl
        _block = re.search(r"<style>(.*?)</style>", page.text, re.S).group(1)
        _digest = _b64.b64encode(_hl.sha256(_block.encode("utf-8")).digest()).decode("ascii")
        assert f"'sha256-{_digest}'" in sent, sent
        download = client.get(url + f"/artifacts/{meta['artifactId']}")
        assert download.status_code == 200
        assert download.content == pptx
        assert "office-file.pptx" in download.headers["content-disposition"]
        assert "UTF-8''" in download.headers["content-disposition"]
        exported = client.get(url + "/export")
        assert exported.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as packed:
            assert packed.read("artifacts/面团启动.pptx") == pptx
        viewer["id"] = "mallory"
        assert client.get(url + "/artifacts").status_code == 404
    store.close()
    sessions._engine.dispose()


def test_browser_page_is_only_the_named_render():
    """没带 render=browser 仍是 JSON。点名之后那一页才是 HTML。"""
    src = (ROOT / "routes" / "project_sources.py").read_text(encoding="utf-8")
    body = _fn_body(src, "preview_office_artifact")
    assert 'get("render") == "browser"' in body
    assert body.index('get("render") == "browser"') < body.index("office_preview_html")


def test_stale_text_preview_keeps_shape_json(tmp_path, monkeypatch):
    """已入库的纯正文，读预览时按文件字节补坐标。仍然是 JSON，不是宿主画的页。

    ⚠ 2026-09-22 启动会那份预览先入库时还没有坐标。删掉读时补位置，本条变红。
    """
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    state = V5SessionState(
        sessionId="office-browser", ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, state.sessionId, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    meta = ProjectOfficeArtifactStore(store).put(
        project.projectId, owner_id="alice", path="面团启动.pptx", data=positioned_pptx())
    stale = {"kind": "slides", "slides": [{"text": "第二页"}, {"text": "第十页"}]}
    raw = json.dumps(stale, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    store._q(
        "update wb_project_office_preview set content=$1 where artifact_id=$2",
        [base64.b64encode(raw).decode("ascii"), meta["artifactId"]],
    )
    stored = json.loads(base64.b64decode(store._q(
        "select content from wb_project_office_preview where artifact_id=$1",
        [meta["artifactId"]],
    )[0]["content"]))
    assert "shapes" not in stored["slides"][0]
    viewer = User(id="alice", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: viewer
    url = f"/api/sliderule/projects/{project.projectId}/artifacts/{meta['artifactId']}/preview"
    with TestClient(app) as client:
        preview = client.get(url)
        assert preview.headers["content-type"].startswith("application/json")
        assert preview.json()["slides"][0]["shapes"][0]["x"] == 457200
        page = client.get(url + "?render=browser")
        assert page.status_code == 200
        assert page.headers["content-type"].startswith("text/html")
        assert "第二页" in page.text and "第十页" in page.text
        assert "left:" in page.text
        assert page.text.count('class="mini"') == 2
    store.close()
    sessions._engine.dispose()


def test_stored_shapes_without_color_are_repainted(tmp_path, monkeypatch):
    """库里的 shapes 没有字色时，打开预览仍按文件字节重画。

    ⚠ 2026-09-22 启动会预览已经有坐标，封面白字却在入库时丢掉。
      有 shapes 就跳过重读，胶片条里的标题继续是近黑。本条变红说明又跳过了。
    """
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    state = V5SessionState(
        sessionId="office-recolor", ownerId="alice",
        goal={"text": "做个PPT"},
        controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE),
    )
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(
        store, state.sessionId, owner_id="alice",
        approval_ref=approved_reference(state), template_id="react-vite")
    data = def_rpr_cover_pptx()
    meta = ProjectOfficeArtifactStore(store).put(
        project.projectId, owner_id="alice", path="面团启动.pptx", data=data)
    stale = {
        "kind": "slides",
        "slideWidth": 12192000,
        "slideHeight": 6858000,
        "slides": [{
            "text": "面团AI办公启动会\n开启企业智能办公新范式",
            "shapes": [{
                "x": 1188720, "y": 2011680, "w": 6583680, "h": 2377440,
                "text": "面团AI办公启动会\n开启企业智能办公新范式",
            }],
        }],
    }
    raw = json.dumps(stale, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    store._q(
        "update wb_project_office_preview set content=$1 where artifact_id=$2",
        [base64.b64encode(raw).decode("ascii"), meta["artifactId"]],
    )
    viewer = User(id="alice", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: viewer
    url = f"/api/sliderule/projects/{project.projectId}/artifacts/{meta['artifactId']}/preview"
    with TestClient(app) as client:
        body = client.get(url).json()
        title = next(shape for shape in body["slides"][0]["shapes"] if "面团AI办公启动会" in shape["text"])
        assert title["lines"][1]["color"] == "#93C5FD"
        page = client.get(url + "?render=browser")
        assert page.status_code == 200
        assert page.text.count('class="mini"') == 1
        assert "color:#FFFFFF" in page.text and "color:#93C5FD" in page.text
    kept = json.loads(base64.b64decode(store._q(
        "select content from wb_project_office_preview where artifact_id=$1",
        [meta["artifactId"]],
    )[0]["content"]))
    assert "lines" not in kept["slides"][0]["shapes"][0]
    store.close()
    sessions._engine.dispose()


def _deck_payload(font_size=44, height=6858000):
    return {
        "kind": "slides", "slideWidth": 12192000, "slideHeight": height,
        "slides": [
            {"text": "封面", "background": "#102030", "shapes": [
                {"x": 914400, "y": 914400, "w": 6096000, "h": 914400,
                 "text": "面团AI办公启动会", "fontSize": font_size, "color": "#FFFFFF"},
            ]},
            {"text": "第二页", "shapes": []},
        ],
    }


def test_slide_preview_uses_the_font_size_it_extracted():
    """抽出来的 fontSize 必须画到页上，不然标题和正文一样大。

    ⚠ 2026-09-23 review：office_preview_payload 抽了 fontSize，_slides_html
      一行没用（§4 生成侧 / 消费侧）。字号按幻灯片高度给比例，舞台缩多少
      字就缩多少；老浏览器停在前面那条 pt 上。

    判据盯**语义**（大字号画得比小字号大、高度减半时比例翻倍），不盯某一句
    CSS 的字面——换个写法不该让它失灵。
    """
    from services.deliverable_kind import office_preview_html

    big = office_preview_html(_deck_payload(font_size=44))
    small = office_preview_html(_deck_payload(font_size=12))
    assert big is not None and small is not None

    def ratio(document):
        match = re.search(r"font-size:([0-9.]+)cqh", document)
        assert match, document[:600]
        return float(match.group(1))

    assert ratio(big) > ratio(small), (ratio(big), ratio(small))
    # 540pt 高的幻灯片上，44pt 就是 8.148%。
    assert abs(ratio(big) - 44 / 540 * 100) < 0.01
    # 幻灯片矮一半，同一个字号占的比例翻倍。
    assert abs(ratio(office_preview_html(_deck_payload(height=6858000 // 2)))
               - 44 / 270 * 100) < 0.01
    # pt 兜底那一条也要在，且排在 cqh 前面（认不出 cqh 的浏览器停在它上面）。
    assert big.index("font-size:44pt") < big.index("font-size:8.148cqh")


def test_slide_preview_needs_no_script_and_csp_matches_the_document():
    """这一页不带脚本，样式按**真发出去的那份**算 hash。

    ⚠ 2026-09-23 review：路由原本发 `script-src 'unsafe-inline';
      style-src 'unsafe-inline'`。这一页是拿用户 .pptx 生成的 HTML 又和产品
      同源，转义漏一处就是同源执行。翻页改成 radio + :checked，脚本清零。

    ⚠ 反向那一半：hash 不是另拼一份字符串算的。对不上只会在浏览器控制台
      报错、页面白屏，服务端一切正常——所以这里拿文档里的 <style> 原样再
      算一遍对。
    """
    import base64
    import hashlib

    from services.deliverable_kind import office_preview_csp, office_preview_html

    document = office_preview_html(_deck_payload())
    assert document is not None
    assert "<script" not in document
    assert 'style="' not in document, "形状的位置/颜色不许留在行内 style 属性上"
    # 翻页还在：两页、两个 radio、两个 label。
    assert document.count('type="radio"') == 2
    assert document.count("<label for=") == 2
    assert "#s1:checked~.stage .pg1{display:block}" in document

    csp = office_preview_csp(document)
    assert "'unsafe-inline'" not in csp
    assert "script-src 'none'" in csp
    block = re.search(r"<style>(.*?)</style>", document, re.S).group(1)
    digest = base64.b64encode(hashlib.sha256(block.encode("utf-8")).digest()).decode("ascii")
    assert f"'sha256-{digest}'" in csp, csp


def test_browser_route_sends_the_computed_csp_not_a_literal():
    """路由发的 CSP 要来自那一份 document，不是手写常量。

    把 `office_preview_csp(document)` 换回写死的 header，本条变红。
    """
    src = (ROOT / "routes" / "project_sources.py").read_text(encoding="utf-8")
    body = _fn_body(src, "preview_office_artifact")
    assert "office_preview_csp(document)" in body
    # ⚠ 先剥注释再匹配：这个函数的注释里就写着上一版那句 unsafe-inline，
    #   不剥的话这条判据永远红（CLAUDE.md §2 踩过的原形）。
    code = "\n".join(line.split("#", 1)[0] for line in body.splitlines())
    assert "unsafe-inline" not in code, code


def test_office_iframe_does_not_allow_scripts():
    """消费侧：这一页不需要脚本，sandbox 就不该给（§4 成对的东西）。"""
    surface = (
        ROOT.parent / "client" / "src" / "pages" / "sliderule"
        / "project-runtime" / "PresentedOfficeFile.tsx"
    ).read_text(encoding="utf-8")
    assert 'sandbox=""' in surface
    assert 'sandbox="allow-scripts"' not in surface
