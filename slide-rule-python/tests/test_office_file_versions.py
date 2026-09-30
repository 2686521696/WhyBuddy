"""办公文件被追问改过之后，旧版还在、看得到、能切回去。

⚠ 2026-09-30 隔离真机第 140 轮（租房指南 Word，两轮追问：「改成问答形式」「最后加一张速查表」）：
  wb_project_office_artifact 一条路径一行，每次收回把 sha 覆盖掉——前两版文件在界面上再也找不回来。
  字节是 CAS、从来没删，缺的是「这条路径先后指过哪些 hash」。

判据走真 ProjectOfficeArtifactStore + 真路由（TestClient），同一路径先后 put 两份不同字节，
即真机「首轮生成 → 追问改写」的形状。把 put 里 _record_version 那一行删掉，第一条变红。
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from routes import project_sources as route
from services import persistence
from services.deliverable_kind import OFFICE_FILE
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.project_store import ProjectStore
from services.session_blob_store import SqlSessionBlobStore
from test_office_artifacts import minimal_pptx

PATH = "output/第一次租房注意事项指南.pptx"


def _setup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    state = V5SessionState(sessionId="office-versions", ownerId="alice", goal={"text": "做个PPT"},
                           controlTranscript=approved_plan_rows("做PPT", deliverable_kind=OFFICE_FILE))
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(store, state.sessionId, owner_id="alice",
                                     approval_ref=approved_reference(state), template_id="react-vite")
    viewer = User(id="alice", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: viewer
    return store, sessions, project, viewer, app


def test_a_rewritten_file_keeps_its_earlier_version_downloadable(tmp_path, monkeypatch):
    store, sessions, project, viewer, app = _setup(tmp_path, monkeypatch)
    office = ProjectOfficeArtifactStore(store)
    first, second = minimal_pptx("首轮"), minimal_pptx("追问改成问答")
    meta = office.put(project.projectId, owner_id="alice", path=PATH, data=first)
    office.put(project.projectId, owner_id="alice", path=PATH, data=second)
    url = f"/api/sliderule/projects/{project.projectId}/artifacts/{meta['artifactId']}"
    with TestClient(app) as client:
        versions = client.get(url + "/versions").json()["versions"]
        assert [(v["number"], v["current"]) for v in versions] == [(2, True), (1, False)]
        old = client.get(url + f"/versions/{versions[1]['sha256']}")
        assert old.status_code == 200 and old.content == first
        assert client.get(url).content == second                     # 当前下载仍是最新那份
    store.close(); sessions._engine.dispose()


def test_restoring_an_old_version_makes_it_current_and_keeps_the_newer_one(tmp_path, monkeypatch):
    store, sessions, project, viewer, app = _setup(tmp_path, monkeypatch)
    office = ProjectOfficeArtifactStore(store)
    first, second = minimal_pptx("首轮"), minimal_pptx("追问")
    meta = office.put(project.projectId, owner_id="alice", path=PATH, data=first)
    office.put(project.projectId, owner_id="alice", path=PATH, data=second)
    url = f"/api/sliderule/projects/{project.projectId}/artifacts/{meta['artifactId']}"
    with TestClient(app) as client:
        old_sha = client.get(url + "/versions").json()["versions"][1]["sha256"]
        restored = client.post(url + f"/versions/{old_sha}/restore")
        assert restored.status_code == 200 and restored.json()["sha256"] == old_sha
        assert client.get(url).content == first
        versions = client.get(url + "/versions").json()["versions"]
        assert len(versions) == 2 and versions[0]["sha256"] == old_sha and versions[0]["current"]
    store.close(); sessions._engine.dispose()


def test_a_hash_this_file_never_had_is_not_served(tmp_path, monkeypatch):
    """反向：拿任意 hash（比如别的工程的文件）来读，不许读到。"""
    store, sessions, project, viewer, app = _setup(tmp_path, monkeypatch)
    office = ProjectOfficeArtifactStore(store)
    meta = office.put(project.projectId, owner_id="alice", path=PATH, data=minimal_pptx("a"))
    other = office.put(project.projectId, owner_id="alice", path="output/other.pptx", data=minimal_pptx("别的"))
    url = f"/api/sliderule/projects/{project.projectId}/artifacts/{meta['artifactId']}"
    with TestClient(app) as client:
        assert client.get(url + f"/versions/{other['sha256']}").status_code == 404
        assert client.post(url + f"/versions/{other['sha256']}/restore").status_code == 404
        viewer["id"] = "mallory"
        assert client.get(url + "/versions").status_code == 404
    store.close(); sessions._engine.dispose()


def test_a_file_collected_before_versions_were_kept_lists_itself(tmp_path, monkeypatch):
    """记版本之前收回的文件：列表至少有当前那一份，不是空的。"""
    store, sessions, project, viewer, app = _setup(tmp_path, monkeypatch)
    office = ProjectOfficeArtifactStore(store)
    meta = office.put(project.projectId, owner_id="alice", path=PATH, data=minimal_pptx("旧"))
    store._q("delete from wb_project_office_version where artifact_id=$1", [meta["artifactId"]])
    versions = office.versions(project.projectId, meta["artifactId"], owner_id="alice")
    assert [(v["number"], v["current"], v["sha256"]) for v in versions] == [(1, True, meta["sha256"])]
    store.close(); sessions._engine.dispose()
