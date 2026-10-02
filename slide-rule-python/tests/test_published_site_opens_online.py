"""发布的网页工程在线打开：托管的就是验收那一份构建，沙盒隔离、存储垫片、路径改写都在响应里。

⚠ 2026-10-02 用户：「接着做在线打开运行」。夹具 `fixtures/round177_cafe_dist/` 是第 177 轮咖啡店落地页的源码
  按模板原样 `npm ci && npm run build` 出来的 dist（vite 默认 base "/"，index.html 里写的是 /assets/xxx.js）。
收回走真的沙盒脚本（ARTIFACT_IO_SCRIPT 的 collect-build，在本机目录上跑）、真的 _keep_site_build；
验收记录走真验收存储（照 test_project_delivery.proof，只是 outputHash 用这份构建真算出来的）。
把响应头里的 CSP 去掉，第三条变红；把 put 里的 hash 比对去掉，第五条变红。
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middlewares.current_user import optional_user
from models.project_runtime import RuntimeInstance, VerificationBuildEvidence
from routes import sliderule_full
from services import app_store, persistence
from services.project_authority import approved_reference
from services.project_manifest import content_hash
from services.project_site_store import ProjectSiteStore, build_output_hash
from services.project_verification_build import _keep_site_build
from services.project_verification_gate import SUITE_ASSERTIONS
from services.project_verification_store import ProjectVerificationStore
from services.project_workspace_artifacts import ARTIFACT_IO_SCRIPT
from services.published_site import SITE_CSP, STORAGE_NAME_PREFIX
from test_project_source_operations import setup  # noqa: F401  （夹具）
from test_project_verification_store import png

DIST = Path(__file__).parent / "fixtures" / "round177_cafe_dist"


def _collect_from_disk(tmp_path, revision):
    """沙盒里那段脚本原样在本机目录上跑：dist 拷到 <root>/dist，标记写成这一版。"""
    root = tmp_path / "workspace"
    (root / "dist").mkdir(parents=True)
    for file in DIST.rglob("*"):
        if file.is_file():
            target = root / "dist" / file.relative_to(DIST)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(file.read_bytes())
    (root / "dist" / "__whybuddy_revision.json").write_text(json.dumps({"revision": revision}))

    def run(action):
        out = subprocess.run([sys.executable, "-c", ARTIFACT_IO_SCRIPT], capture_output=True, text=True,
                             input=json.dumps({"action": action, "root": str(root), "revision": revision}))
        assert out.returncode == 0, out.stderr[-400:]
        return json.loads(out.stdout)

    files = {row["path"]: base64.b64decode(row["data"]) for row in run("collect-build")["files"]}
    return files, run("output")["outputHash"]


def _verified(setup, output_hash):
    """test_project_delivery.proof 同一条路，outputHash 用真构建算出来的。"""
    store, project = setup.store, setup.project
    authority = persistence.load_session_record(project.sessionId)["session"]
    approval = approved_reference(authority)
    parent = store.create_operation(project.projectId, owner_id="alice", kind="runtime.start",
        idempotency_key="start", expected_revision=project.currentRevision, approval_ref=approval)
    lease = store.acquire_lease(project.projectId, owner_id="alice", lease_owner="test-proof", ttl_seconds=120)
    store.claim_operation(parent.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    lease = store.renew_lease(project.projectId, owner_id="alice", lease_owner=lease.leaseOwner,
        generation=lease.generation, sandbox_id="fixture-sandbox", mounted_revision=project.currentRevision,
        process_refs={"operationId": parent.operationId, "server": "42"})
    runtime = RuntimeInstance(runtimeId="rt-" + parent.operationId, projectId=project.projectId,
        workspaceId=lease.workspaceId, revision=project.currentRevision, status="ready", port=5173,
        processId="42", health="revision_verified", expiresAt=time.time() + 900, lastHeartbeat="2026-10-02T00:00:00Z")
    store.update_runtime_operation(parent.operationId, owner_id="alice", lease_generation=lease.generation,
        lease_owner=lease.leaseOwner, expected_status="queued", status="running", runtime=runtime)
    child = store.enqueue_runtime_verification(parent.operationId, owner_id="alice",
        expected_revision=project.currentRevision, approval_ref=approval, idempotency_key="verify",
        suite_version="react-vite-app@1")
    scope = dict(owner_id="alice", lease_generation=lease.generation, lease_owner=lease.leaseOwner)
    store.claim_operation(child.operationId, owner_id="alice", lease_owner=lease.leaseOwner, generation=lease.generation)
    store.transition_operation(child.operationId, expected_status="queued", status="running", **scope)
    records = ProjectVerificationStore(store)
    record = records.begin(child.operationId, **scope)
    revision = store.get_revision(project.projectId, owner_id="alice")
    lock = store.read_files(project.projectId, owner_id="alice")["package-lock.json"]
    build = VerificationBuildEvidence(revision=project.currentRevision, treeHash=revision.treeHash,
        lockfileHash=content_hash(lock), status="passed", installExitCode=0, buildExitCode=0,
        outputHash=output_hash, outputFileCount=5, outputBytes=216000, serverKind="static-dist",
        startedAt="2026-10-02T00:00:01Z", completedAt="2026-10-02T00:00:02Z")
    records.finish(record.verificationId, **scope, status="passed", build=build,
        assertions=[{"id": name, "status": "passed"} for name in sorted(SUITE_ASSERTIONS["react-vite-app@1"])],
        artifacts={"page.png": png()})
    return child


@pytest.fixture
def market(tmp_path, monkeypatch):
    from config.settings import settings
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'apps.db'}", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)
    app_store.reset_backend_cache()
    yield
    app_store.reset_backend_cache()


def _published(setup, tmp_path, monkeypatch):
    files, output_hash = _collect_from_disk(tmp_path, setup.project.currentRevision)
    child = _verified(setup, output_hash)
    task = SimpleNamespace(store=setup.store, handle=object(),
                           provider=SimpleNamespace(collect_build_output=lambda _h, revision: files))
    _keep_site_build(task, child, setup.project.currentRevision, output_hash)
    body = setup.client.post(setup.url + "/publish").json()
    monkeypatch.setattr(sliderule_full, "get_project_store", lambda: setup.store)
    app = FastAPI()
    app.include_router(sliderule_full.router, prefix="/api/sliderule")
    app.dependency_overrides[optional_user] = lambda: None          # iframe 里不带登录态：匿名
    return body, TestClient(app), files


def test_the_sandbox_script_and_the_host_hash_the_build_the_same_way(tmp_path):
    files, output_hash = _collect_from_disk(tmp_path, "prv-1")
    assert set(files) >= {"index.html", "assets/index-8pWbvxp_.js", "_whybuddy/editor.js"}
    assert build_output_hash(files) == output_hash


def test_publishing_a_verified_static_build_turns_on_online_open(setup, market, tmp_path, monkeypatch):
    body, _client, _files = _published(setup, tmp_path, monkeypatch)
    assert body["published"] and body["onlineOpen"] is True and body["siteUnavailable"] is None


def test_the_page_is_sandboxed_and_runs_from_its_own_prefix(setup, market, tmp_path, monkeypatch):
    body, client, _files = _published(setup, tmp_path, monkeypatch)
    prefix = f"/api/sliderule/apps/{body['appId']}/site/"
    page = client.get(prefix)
    assert page.status_code == 200
    assert page.headers["content-security-policy"] == SITE_CSP and "allow-same-origin" not in SITE_CSP
    assert page.headers["access-control-allow-origin"] == "*"
    html = page.text
    assert f'src="{prefix}assets/index-8pWbvxp_.js"' in html and f'href="{prefix}assets/index-vfweWWoF.css"' in html
    assert f'src="{prefix}_whybuddy/editor.js"' in html
    assert 'src="/assets/' not in html                                  # 根路径不留
    assert STORAGE_NAME_PREFIX in html and html.index(STORAGE_NAME_PREFIX) < html.index("index-8pWbvxp_.js")
    script = client.get(prefix + "assets/index-8pWbvxp_.js")
    assert script.status_code == 200 and script.headers["content-type"].startswith("text/javascript")
    assert script.headers["content-security-policy"] == SITE_CSP
    assert client.get(prefix + "members/join").text == html             # 前端路由回落首页
    assert client.get(prefix + "assets/missing.png").status_code == 404


def test_a_private_listing_is_not_served(setup, market, tmp_path, monkeypatch):
    body, client, _files = _published(setup, tmp_path, monkeypatch)
    app_store.patch_app(body["appId"], visibility="private")
    assert client.get(f"/api/sliderule/apps/{body['appId']}/site/").status_code in (403, 404)


def test_bytes_that_do_not_match_the_verified_build_are_not_kept(setup, tmp_path):
    """反向：收回来的字节跟验收算的 hash 对不上（中途被改过），不收——在线打开的只能是验收那一份。"""
    files, output_hash = _collect_from_disk(tmp_path, "prv-1")
    tampered = {**files, "index.html": files["index.html"] + b"<script>alert(1)</script>"}
    with pytest.raises(ValueError, match="hash_mismatch"):
        ProjectSiteStore(setup.store).put(setup.project.projectId, revision="prv-1", output_hash=output_hash,
                                          files=tampered)
    assert not ProjectSiteStore(setup.store).has(setup.project.projectId, output_hash)


def test_without_a_kept_build_publishing_still_works_but_says_why(setup, market):
    """fail-open：构建没收回来，照样能发布（截图 + 源码），只是不能在线打开，并说清原因。"""
    _verified(setup, "c" * 64)
    body = setup.client.post(setup.url + "/publish").json()
    assert body["published"] and body["onlineOpen"] is False and body["siteUnavailable"] == "build_not_kept"
