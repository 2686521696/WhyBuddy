"""「我的应用」要知道每个会话做出了什么：文件还是网页工程、封面画哪一份——GET /sessions 一次给齐。

⚠ 2026-10-01 用户截图「我的应用」771 张：新流程做完从不进应用库，画廊把它们一律画成空封面 +「推演未闭环」，
  交付了的 PPT、跑起来的落地页都一样；筛选 78 + 24 + 1 离 771 差 668。隔离库复现：192 张卡、推演中 85、
  已闭环 0，咖啡店落地页（第 177 轮）、预算 Excel（第 179 轮）都是空卡。

工程走真创建链（create_session_project：办公计划落办公工作区模板，网页计划落 react-vite），不手拼库行（§一之二）。
把 session_work_index 里看模板那一支删掉，第二条变红；把路由里接 works 那段删掉，第三条变红。
"""

from __future__ import annotations

from pathlib import Path

from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import persistence
from services.deliverable_kind import OFFICE_FILE, WEB_APP, WORKSPACE_TEMPLATE_VERSION
from services.project_authority import approved_reference
from services.project_creation import create_session_project
from services.project_office_artifacts import ProjectOfficeArtifactStore
from test_office_artifacts import _project_setup

DECK = (Path(__file__).parent / "fixtures" / "round180_store_review_flat_conversion_line.pptx").read_bytes()


def _session(store, sid: str, kind: str):
    state = V5SessionState(sessionId=sid, ownerId="alice", goal={"text": sid},
                           controlTranscript=approved_plan_rows(sid, deliverable_kind=kind))
    assert persistence.save_session_record(state, server_write=True)["ok"]
    return create_session_project(store, sid, owner_id="alice",
                                  approval_ref=approved_reference(state), template_id="react-vite")


def _three(tmp_path, monkeypatch):
    store, blobs = _project_setup(tmp_path, monkeypatch)
    delivered = _session(store, "sr-office-delivered", OFFICE_FILE)
    _session(store, "sr-office-nothing-yet", OFFICE_FILE)
    _session(store, "sr-web", WEB_APP)
    ProjectOfficeArtifactStore(store).put(delivered.projectId, owner_id="alice",
                                          path="output/门店月度复盘.pptx", data=DECK)
    return store, blobs, delivered


def test_a_delivered_office_session_carries_its_latest_file(tmp_path, monkeypatch):
    store, blobs, delivered = _three(tmp_path, monkeypatch)
    index = store.session_work_index(office_template=WORKSPACE_TEMPLATE_VERSION)
    assert index["sr-office-delivered"]["projectId"] == delivered.projectId
    assert index["sr-office-delivered"]["kind"] == "office"
    assert index["sr-office-delivered"]["officePath"] == "output/门店月度复盘.pptx"
    store.close(); blobs._engine.dispose()


def test_the_template_tells_an_office_workspace_from_a_web_project(tmp_path, monkeypatch):
    """还没收回文件的办公会话也是「文件」（看模板），不是网页工程；网页计划的是网页工程。"""
    store, blobs, _ = _three(tmp_path, monkeypatch)
    index = store.session_work_index(office_template=WORKSPACE_TEMPLATE_VERSION)
    assert index["sr-office-nothing-yet"]["kind"] == "office" and "officePath" not in index["sr-office-nothing-yet"]
    assert index["sr-web"]["kind"] == "web"
    store.close(); blobs._engine.dispose()


def test_the_sessions_route_hands_the_fields_to_the_gallery(tmp_path, monkeypatch):
    """接在链路上：GET /sessions 那一发里真的带着 workKind / projectId / officePath（§三）。"""
    store, blobs, delivered = _three(tmp_path, monkeypatch)
    from types import SimpleNamespace
    from routes import sliderule_full
    monkeypatch.setattr(sliderule_full, "get_project_store", lambda: store)
    monkeypatch.setattr(sliderule_full, "_auth", lambda _key: None)
    body = sliderule_full.list_sess(SimpleNamespace(id="alice", role="user", email="a@x"), None)
    rows = {row["sessionId"]: row for row in body["sessions"]}
    assert rows["sr-office-delivered"]["workKind"] == "office"
    assert rows["sr-office-delivered"]["officePath"] == "output/门店月度复盘.pptx"
    assert rows["sr-web"]["workKind"] == "web" and rows["sr-web"]["projectId"]
    # ⚠ 2026-10-03：卡片拿这个 id 直接下载，不再逐张 GET /artifacts（测试库上 16 张排成 11～16 秒）。
    #   反向：它真能取回这份文件的字节，不是随便一个 id。
    artifact_id = rows["sr-office-delivered"]["officeArtifactId"]
    listed = ProjectOfficeArtifactStore(store).list(delivered.projectId, owner_id="alice")
    assert artifact_id == listed[0]["artifactId"]
    _meta, data = ProjectOfficeArtifactStore(store).get_bytes(delivered.projectId, artifact_id, owner_id="alice")
    assert data == DECK
    assert "officeArtifactId" not in rows["sr-web"]
    store.close(); blobs._engine.dispose()


def test_a_broken_work_index_does_not_take_the_sidebar_down(tmp_path, monkeypatch):
    """fail-open：产出索引炸了，侧栏和画廊照常列会话，只是不带这几个字段（第七条）。"""
    store, blobs, _ = _three(tmp_path, monkeypatch)
    from types import SimpleNamespace
    from routes import sliderule_full

    def boom():
        raise RuntimeError("db gateway down")
    monkeypatch.setattr(sliderule_full, "_session_work_index", boom)
    monkeypatch.setattr(sliderule_full, "_auth", lambda _key: None)
    body = sliderule_full.list_sess(SimpleNamespace(id="alice", role="user", email="a@x"), None)
    assert {row["sessionId"] for row in body["sessions"]} >= {"sr-office-delivered", "sr-web"}
    assert all("workKind" not in row for row in body["sessions"])
    store.close(); blobs._engine.dispose()
