"""浏览器自动建工程不许建成任务清单：前端不挑模板，服务端缺省就是普通 react-vite。

⚠ 2026-10-08 真机 sr-20261008144247-5MEAE5TMRS（@frontend-design 读书打卡，重跑）：批准一落，前端
  SlideRule.tsx 的自动创建抢在模型前面 POST /sessions/{sid}/project，body 里 templateId 写死成
  react-vite-tasks（deliverable-kind.ts 把**每个**网页计划都映射成 tasks）。模型随后那句
  project_create {"templateId": "react-vite"} 只拿回已有工程——根修订 templateVersion
  whybuddy-react-vite-tasks-1、specRevision whybuddy-tasks-acceptance@1。验收锁在任务清单套件
  （登录、增改筛任务），读书打卡写得再好也交不了：两次独立验收都卡在「登录/API 超时」，50 次调用后停在 waiting_user。
  上一趟同一话题（sr-20261008130208-70FWGJY9F7）批准那一下没从浏览器到达服务端，是模型自己建的，拿到普通模板，验收通过。
  2026-09-25 模型那半（CreateArguments 的说明）已改成「react-vite 才是默认」，前端这一半没改——CLAUDE.md §4。

判据走真路由 + 真 SQL 存储，body 照修好后前端发的原样（只有 approvalRef）。
前端那半在 client/.../project-entry-session.test.tsx（真钩子，计划行带 deliverableKind: "web-app"）。
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import require_user
from models.v5_state import V5SessionState
from routes import project_runtime as route
from services import persistence
from services.identity_store import User
from services.project_authority import approved_reference
from services.project_creation import TASK_TEMPLATE_VERSION, TEMPLATE_VERSION
from services.project_store import ProjectStore
from services.session_blob_store import SqlSessionBlobStore


@pytest.fixture
def world(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    monkeypatch.setattr(route, "_internal_gate", lambda viewer: None)       # 放量开关不是这条判据的主题
    plan = {"planId": "plan-reading", "revision": 2, "reqId": "approve-reading", "deliverableKind": "web-app",
            "planContent": "# 读书打卡网页实施计划\n添加书籍、按日期记录页数、本月趋势；数据存 localStorage，不需要登录或后端。"}
    state = V5SessionState(sessionId="sr-reading", ownerId="alice", goal={"text": "做一个读书打卡网页"},
        controlTranscript=[{**plan, "kind": k} for k in ("plan_written", "plan_approval", "plan_approved")])
    assert persistence.save_session_record(state, server_write=True)["ok"]
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: User(id="alice", is_superuser=True)
    with TestClient(app) as client:
        yield client, store, approved_reference(state)
    store.close()
    sessions._engine.dispose()


def _create(client, body):
    response = client.post("/api/sliderule/sessions/sr-reading/project", json=body)
    assert response.status_code == 201, response.text
    return response.json()["project"]


def test_the_browser_body_builds_a_plain_react_app(world):
    client, store, ref = world
    project = _create(client, {"approvalRef": ref})
    revision = store.get_revision(project["projectId"], owner_id="alice")
    assert revision.templateVersion == TEMPLATE_VERSION
    assert revision.specRevision is None                                       # 没有锁在任务清单验收上


def test_an_explicit_tasks_request_is_still_honoured(world):
    """反向：服务端没有把 tasks 一刀切掉（冒烟脚本 --tasks 还要它）——上一条绿是因为缺省对，不是因为 tasks 被吞了。"""
    client, store, ref = world
    project = _create(client, {"approvalRef": ref, "templateId": "react-vite-tasks"})
    assert store.get_revision(project["projectId"], owner_id="alice").templateVersion == TASK_TEMPLATE_VERSION
