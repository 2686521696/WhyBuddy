"""自己用命令起的服务器（Django、Go …）也能独立验收、拿到交付；证据照实说它证明不了什么。

⚠ 2026-10-10 编排正确性第 3 条第二步（用户选 A）。原来 project_verify 遇到自定义命令一律拒
  （project_verification_custom_server_unsupported）：验收整套围着「构建模板产物的指纹 + 页面上的版本标记文件」
  转，Django 两样都没有，这类工程永远拿不到「已交付」。
  现在派 web-server@1：浏览器看同样四件事（有内容、刷新还在、没报错、没失败请求），不读版本标记；
  版本绑定由宿主做——这一版同步进了沙盒、验收期间没变、被检查的就是那条命令起的进程、端口回话
  （models.project_runtime.VerificationBuildEvidence 头注）。证明不了「改了没重启」，交付档的说明里照写。

走真 SQL + 真 worker + 真 project_verify / 交付判定；只换掉沙盒、验收浏览器、预览网关（同 test_project_browser_verification）。
成对的四处（Python 闸 / 存储白名单 / 浏览器回执解码 / browser-runner.mjs）另有一条钉着（§4）。变异见各条 docstring。
"""
from __future__ import annotations

import base64
import hashlib
import inspect
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from models.project_runtime import VerificationBuildEvidence
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import persistence, project_creation
from services.project_acceptance import (APP_TEMPLATE_VERSION, BLANK_TEMPLATE_VERSION, SERVER_SUITE_VERSION,
                                         acceptance_profile)
from services.project_authority import approved_reference
from services.project_browser_provider import SUITE_ARTIFACTS, decode_result
from services.project_delivery import ProjectDeliveryService
from services.project_runtime_worker import ProjectRuntimeSupervisor
from services.project_store import VERIFICATION_SUITES, ProjectStore
from services.project_tools import ProjectTools
from services.project_verification_gate import SUITE_ASSERTIONS, validate_build_evidence
from services.project_verification_store import ProjectVerificationStore
from services.session_blob_store import SqlSessionBlobStore
from test_custom_dev_server_through_the_tools import FILES, START, DjangoProvider
from test_project_runtime_worker import eventually

ROOT = Path(__file__).resolve().parents[2]
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
APP = ("content_visible", "reload_renders", "no_page_errors", "no_failed_requests")


class Browser:
    def __init__(self):
        self.calls = []

    def availability_error(self):
        return None

    def cleanup(self, verification_id, check_callback=None):
        return True

    def run(self, **kwargs):
        self.calls.append(kwargs["suite_version"])
        kwargs["check_callback"]()
        return {"status": "passed", "cleanupConfirmed": True, "runnerVersion": "whybuddy-browser-v1:pw1.61.1",
                "errorCode": None, "assertions": [{"id": name, "status": "passed"} for name in APP],
                "artifacts": {"app.png": PNG}}


@pytest.fixture
def blank_django(tmp_path, monkeypatch, project_actor, request):  # noqa: F811
    template_version = getattr(request, "param", BLANK_TEMPLATE_VERSION)
    project_actor("alice")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'projects.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *args: sessions)
    state = V5SessionState.server_load({"sessionId": "session-django", "ownerId": "alice",
        "goal": {"text": "Django 商品后台", "status": "clear"}, "controlTranscript": approved_plan_rows()})
    sessions.save(state.sessionId, state.model_dump(mode="json"), expected_rev=None)
    # 空工作区上模型铺好的 Django（不灌 Vite）
    monkeypatch.setattr(project_creation, "load_project_template", lambda *args: (FILES.copy(), template_version))
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "https://{runtimeId}.preview.example.com")
    provider, browser = DjangoProvider(), Browser()
    supervisor = ProjectRuntimeSupervisor(store, lambda: provider, poll_interval=0.03, lease_ttl=1,
                                          lifetime_seconds=90, idle_seconds=60, browser_provider_factory=lambda: browser)
    supervisor.preview_runtime = SimpleNamespace(ensure=lambda task: None, revoke=lambda task: None,
                                                 suspend_for_sync=lambda task: None)
    supervisor.preview_access = SimpleNamespace(has_active_tunnel=lambda *a, **k: True,
        issue_browser_ticket=lambda *a, **k: SimpleNamespace(secret="browser-ticket-fixture",
                                                             scope=SimpleNamespace(grant_id="grant-fixture")),
        revoke_grant=lambda grant_id, **k: None)
    supervisor.start()
    tools = ProjectTools(store, supervisor, "alice")
    approval = approved_reference(state)
    template_id = "blank" if template_version == BLANK_TEMPLATE_VERSION else "react-vite"
    project = tools.execute("project_create", {"approvalRef": approval, "templateId": template_id}, state)
    assert project["ok"], project
    yield SimpleNamespace(store=store, state=state, tools=tools, provider=provider, browser=browser,
                          approval=approval, project=project)
    supervisor.shutdown()
    store.close()
    sessions._engine.dispose()


def _start_and_verify(world):
    started = world.tools.execute("deploy_expose_port", {"command": START}, world.state)
    assert started["ok"], started
    op = lambda: world.store.get_operation(started["operationId"], owner_id="alice")  # noqa: E731
    eventually(lambda: op().runtime and op().runtime.status == "ready")
    queued = world.tools.execute("project_verify", {"runtimeOperationId": op().operationId,
        "expectedRevision": op().runtime.revision, "idempotencyKey": "verify-1"}, world.state)
    assert queued["ok"], queued
    records = ProjectVerificationStore(world.store)
    done = eventually(lambda: (s := records.latest(world.project["projectId"], owner_id="alice"))
                      and s.verification.status in {"passed", "failed", "blocked"} and s)
    return op, done


def test_a_django_server_is_verified_as_it_runs_and_can_be_delivered(blank_django):
    """变异：project_verify 恢复「自定义命令一律拒」→ 红；自定义分支照旧走 build_and_start → 红（npm run build）；
    交付判定照旧 suite != bound[1]（不认服务器套件）→ 最后两句红。"""
    world = blank_django
    op, done = _start_and_verify(world)
    record = done.verification
    assert record.status == "passed", (record.status, record.errorCode)
    assert record.suiteVersion == SERVER_SUITE_VERSION and world.browser.calls == [SERVER_SUITE_VERSION]
    build = record.build
    assert build.serverKind == "custom-command" and build.outputHash is None and build.buildExitCode is None
    assert build.commandHash == hashlib.sha256(op().input["command"].encode()).hexdigest()
    status = ProjectDeliveryService(world.store, "alice").status(world.project["projectId"])
    assert status["eligible"] is True, status["blockedReasons"]
    assert any("Not proven" in line for line in status["profile"]["requirements"])     # 说清它证明不了什么


@pytest.mark.parametrize("blank_django", [APP_TEMPLATE_VERSION], indirect=True)
def test_a_vite_template_project_run_with_its_own_command_can_be_delivered_too(blank_django):
    """真机有过：React+Vite 模板上模型铺了 Django、用自己的命令起。它绑的是普通网页交付档，验的却是服务器套件。
    变异：交付判定照旧 suite != bound[1] → 红（服务器套件通过了也交不了）。"""
    world = blank_django
    _op, done = _start_and_verify(world)
    assert done.verification.status == "passed" and done.verification.suiteVersion == SERVER_SUITE_VERSION
    status = ProjectDeliveryService(world.store, "alice").status(world.project["projectId"])
    assert status["eligible"] is True, status["blockedReasons"]
    assert status["profile"]["suiteVersion"] == SERVER_SUITE_VERSION         # 交付档按实际那一套说


def test_a_server_that_stopped_answering_is_blocked_not_passed(blank_django, monkeypatch):
    """反向：进程不回话就没东西可看——blocked（缺证据），浏览器一次都不开，交付不放行。
    变异：_running_server_evidence 不查 probe_http、直接记 passed → 红。"""
    world = blank_django
    real = DjangoProvider.probe_http
    serving = {"on": True}

    def probe_http(self, handle, port):
        # 只对验收自己的那一问不回话：巡检那一问照旧回（否则巡检先判它死、整台停掉，两条对的机制抢跑，判据就不稳）。
        asked_by_verification = any(frame.function == "_running_server_evidence" for frame in inspect.stack())
        return (serving["on"] or not asked_by_verification) and real(self, handle, port)
    monkeypatch.setattr(DjangoProvider, "probe_http", probe_http)
    started = world.tools.execute("deploy_expose_port", {"command": START}, world.state)
    op = lambda: world.store.get_operation(started["operationId"], owner_id="alice")  # noqa: E731
    eventually(lambda: op().runtime and op().runtime.status == "ready")
    serving["on"] = False                          # 就绪之后验收那一问没回话
    world.tools.execute("project_verify", {"runtimeOperationId": op().operationId,
        "expectedRevision": op().runtime.revision, "idempotencyKey": "verify-1"}, world.state)
    records = ProjectVerificationStore(world.store)
    done = eventually(lambda: (s := records.latest(world.project["projectId"], owner_id="alice"))
                      and s.verification.status in {"passed", "failed", "blocked"} and s)
    assert done.verification.status == "blocked" and done.verification.errorCode == "project_server_not_responding"
    assert world.browser.calls == []
    assert ProjectDeliveryService(world.store, "alice").status(world.project["projectId"])["eligible"] is False


def _evidence(**changes):
    values = dict(revision="prv-1", treeHash="a" * 64, lockfileHash=None, status="passed", serverKind="custom-command",
                  commandHash="c" * 64, startedAt="t0", completedAt="t1")
    return VerificationBuildEvidence(**{**values, **changes})


def test_the_gate_takes_custom_evidence_only_for_the_server_suite_and_only_without_build_numbers():
    ok = validate_build_evidence(_evidence(), revision="prv-1", tree_hash="a" * 64, lockfile_hash=None,
                                 suite_version=SERVER_SUITE_VERSION)
    assert ok.serverKind == "custom-command"
    bad = [
        (_evidence(), "react-vite-app@1"),                      # 普通网页套件不许拿这种证据冒充构建
        (_evidence(commandHash=None), SERVER_SUITE_VERSION),    # 不知道是哪条命令起的
        (_evidence(outputHash="d" * 64), SERVER_SUITE_VERSION),  # 没构建却带产物指纹
        (_evidence(status="failed"), SERVER_SUITE_VERSION),      # 没有「构建失败」这回事
        (_evidence(treeHash="b" * 64), SERVER_SUITE_VERSION),    # 不是这一版
    ]
    for evidence, suite in bad:
        with pytest.raises(ValueError):
            validate_build_evidence(evidence, revision="prv-1", tree_hash="a" * 64, lockfile_hash=None,
                                    suite_version=suite)


def _receipt(before, after, suite=SERVER_SUITE_VERSION):
    import json
    return json.dumps({"verificationId": "pvr-1", "revision": "prv-1", "suiteVersion": suite,
        "runnerVersion": "whybuddy-browser-v1:pw1.61.1", "status": "passed", "errorCode": None,
        "assertions": [{"id": name, "status": "passed"} for name in APP],
        "artifacts": {"app.png": base64.b64encode(PNG).decode()}, "cleanupConfirmed": True,
        "revisionBefore": before, "revisionAfter": after})


def test_the_server_receipt_cannot_borrow_a_page_revision_marker():
    """服务器套件不读版本标记：回执里那两个字段必须空，不许借一个值冒充「页面证明了版本」。普通网页照旧必须有。
    变异：decode_result 对服务器套件也照旧要 revisionBefore == revision → 第一句红。"""
    def decoded(before, after, suite=SERVER_SUITE_VERSION):     # 坏回执不抛，记成 output_invalid（blocked）
        return decode_result(_receipt(before, after, suite), revision="prv-1", verification_id="pvr-1",
                             suite_version=suite)
    assert decoded(None, None)["status"] == "passed"
    for before, after in (("prv-1", "prv-1"), ("prv-1", None)):
        assert decoded(before, after)["errorCode"] == "project_browser_output_invalid"
    assert decoded(None, None, "react-vite-app@1")["errorCode"] == "project_browser_output_invalid"


def _strip_js_comments(text):
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", text, flags=re.S))


def test_every_side_knows_the_server_suite():
    """§4 成对：存储白名单 / Python 闸 / 回执解码 / browser-runner.mjs，少一处就是「排得上队、验不了」或反过来。
    剥掉注释再看 runner（注释里提到不算）。"""
    assert SERVER_SUITE_VERSION in VERIFICATION_SUITES
    assert set(VERIFICATION_SUITES) == set(SUITE_ASSERTIONS) == set(SUITE_ARTIFACTS)
    runner = _strip_js_comments((ROOT / "server/project-verification/browser-runner.mjs").read_text(encoding="utf-8"))
    assert re.search(r'SERVER_SUITE_VERSION\s*=\s*"web-server@1"', runner)
    assert re.search(r"const SUITES = \[[^\]]*SERVER_SUITE_VERSION[^\]]*\]", runner)
    assert acceptance_profile(None, SERVER_SUITE_VERSION)["suiteVersion"] == SERVER_SUITE_VERSION
