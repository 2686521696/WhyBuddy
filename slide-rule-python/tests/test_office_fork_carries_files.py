"""复刻办公工程：成品文件跟着那一版源码一起过去，交付类别也跟过去。

⚠ 2026-09-30 用户点名「Fork 这种逻辑」：ProjectSourceOperations.fork 只拷源码树。办公交付的
  .pptx/.docx/.xlsx 住在产物库（不在源码树），复刻出来的会话只有生成脚本、没有文件；
  project_forked 那一行也不带交付类别，前端 latestPlanDeliverableKind 读不到计划就按网页画。

判据走真 HTTP 路由 + 真 SQL 存储。时间线照真机：首版文件收回 → 追问改脚本（新源码版）→ 再收回第二版文件。
复刻第一版源码拿到的是首版文件，复刻当前版拿到的是第二版。把 fork 里拷成品那段删掉，第一条变红。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from models.v5_state import V5SessionState
from routes import project_sources as route
from services import persistence
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from services.project_store import ProjectStore
from services.session_blob_store import SqlSessionBlobStore
from test_office_artifacts import minimal_pptx


PATH = "output/新员工入职培训.pptx"


def _fixture(tmp_path, monkeypatch, kind):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    plan = {"planId": "plan1", "revision": 1, "planContent": "做一份培训 PPT", "reqId": "approve1",
            "deliverableKind": kind}
    state = V5SessionState(sessionId="office-fork-src", ownerId="alice", goal={"text": "新员工入职培训 PPT"},
        controlTranscript=[{**plan, "kind": k} for k in ("plan_written", "plan_approval", "plan_approved")])
    assert persistence.save_session_record(state, server_write=True)["ok"]
    project = create_session_project(store, state.sessionId, owner_id="alice",
                                     approval_ref=approved_reference(state), template_id="react-vite")
    viewer = User(id="alice", is_superuser=True)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: viewer
    return store, sessions, project, app


@pytest.fixture
def office(tmp_path, monkeypatch):
    store, sessions, project, app = _fixture(tmp_path, monkeypatch, "office-file")
    with TestClient(app) as client:
        yield SimpleNamespace(store=store, project=project, client=client,
                              url=f"/api/sliderule/projects/{project.projectId}")
    store.close()
    sessions._engine.dispose()


def _fork(setup, revision, key):
    response = setup.client.post(setup.url + "/fork", json={"revision": revision, "idempotencyKey": key})
    assert response.status_code == 201, response.text
    return response.json()


def _fork_bytes(setup, fork):
    files = ProjectOfficeArtifactStore(setup.store).files_as_of(fork["projectId"], owner_id="alice", before=None)
    return files.get(PATH)


def test_forking_an_office_project_brings_the_file_of_that_source_version(office):
    artifacts = ProjectOfficeArtifactStore(office.store)
    first_rev = office.project.currentRevision
    first, second = minimal_pptx("首版"), minimal_pptx("第三页改成流程图")
    artifacts.put(office.project.projectId, owner_id="alice", path=PATH, data=first)
    # 追问：改了工作区里的源码（办公工作区只有 README.md，没有 src/main.tsx）
    file = office.client.get(office.url + "/source/file", params={"path": "README.md"}).json()
    patched = office.client.post(office.url + "/source/patch", json={
        "expectedRevision": file["revision"], "idempotencyKey": "follow-up",
        "changes": [{"path": "README.md", "expectedSha256": file["sha256"], "content": file["content"] + "\n改第三页\n"}]})
    assert patched.status_code == 200, patched.text
    artifacts.put(office.project.projectId, owner_id="alice", path=PATH, data=second)
    current_rev = office.store.get_project(office.project.projectId, owner_id="alice").currentRevision

    assert _fork_bytes(office, _fork(office, first_rev, "fork-first")) == first
    assert _fork_bytes(office, _fork(office, current_rev, "fork-current")) == second


def test_the_fork_session_knows_it_is_an_office_deliverable(office):
    ProjectOfficeArtifactStore(office.store).put(office.project.projectId, owner_id="alice", path=PATH,
                                                 data=minimal_pptx())
    fork = _fork(office, office.project.currentRevision, "fork-kind")
    row = persistence.load_session_record(fork["sessionId"])["session"].controlTranscript[0]
    assert row["kind"] == "project_forked"
    assert row["deliverableKind"] == "office-file" and row["officeFiles"] == [PATH]


def test_a_web_project_fork_carries_no_office_files(tmp_path, monkeypatch):
    """反向：网页工程没有成品文件，不许编出来；类别照实是 web-app。"""
    store, sessions, project, app = _fixture(tmp_path, monkeypatch, "web-app")
    with TestClient(app) as client:
        response = client.post(f"/api/sliderule/projects/{project.projectId}/fork",
                               json={"revision": project.currentRevision, "idempotencyKey": "web"})
        fork = response.json()
        row = persistence.load_session_record(fork["sessionId"])["session"].controlTranscript[0]
        assert row["deliverableKind"] == "web-app" and row["officeFiles"] == []
        assert not ProjectOfficeArtifactStore(store).list(fork["projectId"], owner_id="alice")
    store.close()
    sessions._engine.dispose()
