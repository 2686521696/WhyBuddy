"""「我的应用」网页工程卡的封面随 GET /sessions 一次给齐，卡片不再逐张查验收。

⚠ 2026-10-03 用户截图：网页工程卡一屏 24 张全是灰占位。每张卡各打一发 GET /projects/{id}/verification，
  那一发读整条会话、再把工程做过的所有操作连 payload 翻一遍——一屏 24 发，每发都重。

验收记录走真验收链路（test_published_site_opens_online._verified：真 lease / 真 runtime / 真 finish），
改源码走真 commit_revision（照 test_project_delivery），预览截图走真 put_preview_snapshot——不手拼库行（§一之二）。

变异（逐条实测过）：
  latest_web_covers 不判过期（去掉 effectiveStatus != "stale"）→ 第二条红；
  预览截图那条查询删掉 → 第三条红；
  路由里不调 _attach_web_covers → 第四条红；
  _attach_web_covers 去掉 try/except → 第五条红；
  session_work_index 查办公产物表不兜「表还没建」→ 第四、五条红（夹具库从没收回过办公文件，
  产出索引整份作废，网页工程卡连 workKind 都丢——写这组判据时翻出来的存量坑）。
"""

from __future__ import annotations

from types import SimpleNamespace

from routes import sliderule_full
from services.project_verification_store import ProjectVerificationStore, latest_web_covers
from test_project_source_operations import setup  # noqa: F401  （夹具）
from test_project_verification_store import png
from test_published_site_opens_online import _verified


def test_a_verified_project_gets_the_same_screenshot_the_per_card_lookup_would(setup):
    """跟单张查（ProjectVerificationStore.latest）挑的是同一份验收、同一组截图。"""
    _verified(setup, "b" * 64)
    pid = setup.project.projectId
    covers = latest_web_covers(setup.store, [pid])
    single = ProjectVerificationStore(setup.store).latest(pid, owner_id="alice")
    assert single.effectiveStatus == "passed"
    assert covers[pid]["verificationId"] == single.verification.verificationId
    assert [ref["artifactId"] for ref in covers[pid]["artifactRefs"]] == \
        [ref.artifactId for ref in single.verification.artifactRefs]


def test_code_changed_after_verification_means_no_verification_cover(setup):
    """反向：验收之后又改了源码，那张截图是旧版本——不许当封面（§7 旧证据不许冒充新产出）。"""
    _verified(setup, "b" * 64)
    pid = setup.project.projectId
    # 照 test_project_delivery 那条：运行环境还占着工程，用同一个租约提交一版新源码
    lease = setup.store.get_lease(pid, owner_id="alice")
    before = setup.store.get_revision(pid, owner_id="alice")
    files = setup.store.read_files(pid, owner_id="alice")
    files["src/main.tsx"] += "\n// new source\n"
    setup.store.commit_revision(pid, owner_id="alice", expected_revision=before.revision, files=files,
        template_version=before.templateVersion, plan_ref=before.planRef, spec_revision=before.specRevision,
        lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    single = ProjectVerificationStore(setup.store).latest(pid, owner_id="alice")
    assert single.effectiveStatus == "stale"           # 单张查也说它过期了
    assert pid not in latest_web_covers(setup.store, [pid])


def test_only_a_preview_snapshot_falls_back_to_it(setup):
    pid = setup.project.projectId
    assert latest_web_covers(setup.store, [pid]) == {}
    setup.store.put_preview_snapshot(pid, owner_id="alice", png=png(), revision=setup.project.currentRevision,
                                     source="browser_view")
    assert latest_web_covers(setup.store, [pid]) == {pid: {"preview": True}}


def _list(setup, monkeypatch):
    monkeypatch.setattr(sliderule_full, "get_project_store", lambda: setup.store)
    monkeypatch.setattr(sliderule_full, "_auth", lambda _key: None)
    body = sliderule_full.list_sess(SimpleNamespace(id="alice", role="user", email="a@x"), None)
    return {row["sessionId"]: row for row in body["sessions"]}


def test_the_sessions_route_hands_web_covers_to_the_gallery(setup, monkeypatch):
    """接在链路上：GET /sessions 那一发里网页工程卡真的带着 webCover（§三）。"""
    _verified(setup, "b" * 64)
    row = _list(setup, monkeypatch)["source-session"]
    assert row["workKind"] == "web"
    assert row["webCover"]["verificationId"]
    assert row["webCover"]["artifactRefs"]


def test_a_broken_cover_query_does_not_take_the_sidebar_down(setup, monkeypatch):
    """fail-open（第七条）：批量封面炸了，列表照常给，只是不带 webCover，卡片退回逐张查。"""
    def boom(*_args, **_kwargs):
        raise RuntimeError("gateway down")

    monkeypatch.setattr(sliderule_full, "latest_web_covers", boom)
    row = _list(setup, monkeypatch)["source-session"]
    assert row["workKind"] == "web" and "webCover" not in row
