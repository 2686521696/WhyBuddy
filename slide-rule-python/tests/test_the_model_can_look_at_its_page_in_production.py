"""线上模型自己看页面：没有本机浏览器时，借验收那台远程浏览器，凭这次运行的一次性预览票进门。

⚠ 2026-10-09 线上读书打卡 sr-20261009000607-914M1G425B（10-08 sr-20261008144247-5MEAE5TMRS 同样）：
  browser_view 回 {"browserError": "project_browser_driver_unavailable"}。Python 镜像里没有 node 和浏览器，
  supervisor 上也没人注入 browser_interactor——线上模型的「自己看一眼」从来没通过，页面报错原文
  （console_observation）在线上一条都到不了模型。

判据：
- 前提：照线上的样子（本机没浏览器、没注入），browser_view 真的回 driver_unavailable；
- 启动接线：本机没浏览器、远程浏览器配好了 → 装上远程；本机有 → 不装（本地开发照旧用本机）；
- 同一份动作脚本（不重抄）在真 Chrome 里凭票进门：没票被网关拒、有票进得去、页面报错原文带回来、票据不出现在结果里；
- provider：新沙盒、网络只放行预览主机、上传的就是那份脚本、做完就销毁，脚本失败时它写的那个码照样带回来；
- 发票胶水：给这次运行（runtime.start 那条操作）发票，做完收票；发不出票说成预览不通，不是代码错；
- 真 ProjectTools.browser_view 走到注入的那台，传过去的是这次运行的身份。
"""

from __future__ import annotations

import http.server
import json
import subprocess
import threading
from types import SimpleNamespace

import pytest

import app as app_module
from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import project_tools as pt
from services import rehearsal_control as rc
from services.project_browser_interact import _repo_root, browser_action_script, decode_browser_action
from services.project_browser_provider import ACTION_METADATA_KIND, E2BProjectBrowserProvider, REMOTE_ROOT
from services.project_browser_remote import RemoteBrowserInteractor
from services.project_preview_access import PreviewAccessDenied
from test_project_browser_interact import _real_chrome
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

TICKET = "tkt-" + "a" * 40
ORIGIN = "https://rt-5f65a431.preview.miantuan.test"


# ── 前提：线上那个样子，browser_view 真的看不到 ──────────────────────────────────────────────────

def _ready_runtime(setup, project, preview_url=None):
    op = setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.start",
        idempotency_key="dev-server", expected_revision=project["revision"], approval_ref=setup.approval,
        input={"port": 5173})
    return op


def _as_if_ready(monkeypatch, op_id, runtime_id="rt-reading", preview_url=None):
    """工人记下的运行状态照真机 browser_view 回执：status ready、health revision_verified。"""
    runtime = SimpleNamespace(status="ready", runtimeId=runtime_id, revision=None, previewUrl=preview_url)
    latest = SimpleNamespace(operationId=op_id, status="running", runtime=runtime)
    monkeypatch.setattr(pt.ProjectTools, "_latest_operation", lambda self, project, kinds=None: latest)


def test_precondition_production_without_a_driver_sees_nothing(setup, monkeypatch):
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    op = _ready_runtime(setup, project)
    _as_if_ready(monkeypatch, op.operationId, preview_url="https://5173-abc.e2b.app/")
    monkeypatch.setattr(pt, "local_playwright_available", lambda: False)
    result = _dispatch(setup, "browser_view", {})
    assert result.get("browserError") == "project_browser_driver_unavailable", result


# ── 启动接线 ────────────────────────────────────────────────────────────────────────────────────

def _supervisor():
    return SimpleNamespace(preview_access=object(), preview_runtime=object())


def test_startup_installs_the_remote_browser_when_there_is_no_local_one(monkeypatch):
    monkeypatch.setattr(app_module, "local_playwright_available", lambda: False)
    monkeypatch.setattr(E2BProjectBrowserProvider, "availability_error", lambda self: None)
    supervisor = _supervisor()
    assert app_module._install_model_browser(supervisor) == "remote"
    assert isinstance(supervisor.browser_interactor, RemoteBrowserInteractor)
    assert supervisor.browser_interactor.access is supervisor.preview_access


def test_startup_keeps_the_local_browser_and_says_why_when_neither_works(monkeypatch):
    monkeypatch.setattr(app_module, "local_playwright_available", lambda: True)
    supervisor = _supervisor()
    assert app_module._install_model_browser(supervisor) == "local"
    assert not hasattr(supervisor, "browser_interactor")                    # 本地开发照旧走本机
    monkeypatch.setattr(app_module, "local_playwright_available", lambda: False)
    monkeypatch.setattr(E2BProjectBrowserProvider, "availability_error", lambda self: "project_browser_not_configured")
    assert app_module._install_model_browser(supervisor) == "none (project_browser_not_configured)"
    assert not hasattr(supervisor, "browser_interactor")


# ── 同一份动作脚本在真 Chrome 里凭票进门 ───────────────────────────────────────────────────────────

GATED = """<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>读书打卡</title>
<h1>本月阅读</h1><button>添加书籍</button>
<script>console.error("加载记录失败", "records is undefined");</script>"""


def _gateway():
    """照预览网关：/_whybuddy/authorize?ticket=… 303 → / 并种 cookie；没 cookie 一律 403。"""
    class Gateway(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/_whybuddy/authorize?ticket=" + TICKET:
                self.send_response(303)
                self.send_header("Location", "/")
                self.send_header("Set-Cookie", "wb_preview=granted; Path=/; HttpOnly")
                self.end_headers()
            elif "wb_preview=granted" not in (self.headers.get("Cookie") or ""):
                # 照 server/project-preview/service.ts 的 respond(response, 403, {error: …})：带 JSON 体。
                # 空体的 403 会被 Chrome 当成网络错误（ERR_HTTP_RESPONSE_CODE_FAILURE），测出来的就不是真网关那一种了。
                body = b'{"error":"preview_access_denied"}'
                self.send_response(403)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                body = GATED.encode()
                self.send_response(200)
                self.send_header("content-type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)

        def log_message(self, *a):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Gateway)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def _run_script(tmp_path, job, chrome):
    pkg = str(_repo_root() / "node_modules" / "@playwright" / "test")
    script = tmp_path / "interact.cjs"
    script.write_text(browser_action_script(f"require({json.dumps(pkg)})"), encoding="utf-8")
    (tmp_path / "action.json").write_text(json.dumps(job), encoding="utf-8")
    done = subprocess.run(["node", str(script), str(tmp_path / "action.json")], capture_output=True, text=True,
        timeout=90, env={"PATH": "/usr/bin:/bin:/usr/local/bin", "SLIDERULE_CHROMIUM_PATH": chrome})
    return json.loads(done.stdout)


@pytest.fixture
def chrome():
    path = _real_chrome()
    if path is None or not (_repo_root() / "node_modules" / "@playwright" / "test").is_dir():
        pytest.skip("no local Chrome / Playwright")
    return path


def test_without_the_ticket_the_gateway_turns_the_browser_away(tmp_path, chrome):
    """前提：门真的锁着——下面那条进得去，是票起的作用。"""
    server, origin = _gateway()
    try:
        out = _run_script(tmp_path, {"op": "snapshot", "url": origin + "/"}, chrome)
    finally:
        server.shutdown()
    assert out == {"ok": False, "error": "project_browser_preview_forbidden"}


def test_the_ticket_lets_the_same_script_in_and_the_page_speaks(tmp_path, chrome):
    server, origin = _gateway()
    try:
        out = _run_script(tmp_path, {"op": "snapshot", "url": origin + "/",
                                     "entryUrl": origin + "/_whybuddy/authorize?ticket=" + TICKET}, chrome)
        bad = _run_script(tmp_path, {"op": "snapshot", "url": origin + "/",
                                     "entryUrl": origin + "/_whybuddy/authorize?ticket=tkt-wrong"}, chrome)
    finally:
        server.shutdown()
    assert out["ok"] is True, out
    assert any(node["name"] == "添加书籍" for node in out["snapshot"]), out["snapshot"]
    assert any("records is undefined" in item["text"] for item in out["console"]), out["console"]
    assert TICKET not in json.dumps(out)                                    # 票据不出现在结果里
    assert bad == {"ok": False, "error": "project_browser_preview_forbidden"}


# ── provider：一台新沙盒、一个动作、用完即毁 ────────────────────────────────────────────────────────

class _Sandbox:
    def __init__(self, sdk):
        self.sdk, self.sandbox_id = sdk, "act-sandbox-1"
        self.files = SimpleNamespace(write=lambda path, text, **kw: sdk.writes.__setitem__(path, text))
        self.commands = SimpleNamespace(run=self.run)

    def run(self, command, **kwargs):
        self.sdk.command = (command, kwargs)
        if isinstance(self.sdk.output, Exception):
            raise self.sdk.output
        return SimpleNamespace(stdout=self.sdk.output, stderr="", exit_code=0)

    def kill(self, **kwargs):
        if self.sdk.handle_kill_fails:                                       # 手里那个句柄关不掉（网络抖了）
            raise RuntimeError("kill timed out")
        self.sdk.killed.append(self.sandbox_id)
        self.sdk.records.pop(self.sandbox_id, None)


class _SDK:
    def __init__(self, output):
        self.output, self.writes, self.killed, self.records, self.created = output, {}, [], {}, []
        self.handle_kill_fails = False

    def create(self, **kwargs):
        self.created.append(kwargs)
        self.records["act-sandbox-1"] = kwargs["metadata"]
        return _Sandbox(self)

    def list(self, *, query, **kwargs):
        items = [SimpleNamespace(sandbox_id=k, metadata=v) for k, v in self.records.items()
                 if all(v.get(a) == b for a, b in query.metadata.items())]
        pages = SimpleNamespace(has_next=True)

        def next_items():
            pages.has_next = False
            return items
        pages.next_items = next_items
        return pages

    def kill(self, identity, **kwargs):
        self.killed.append(identity)
        self.records.pop(identity, None)


def _provider(sdk):
    return E2BProjectBrowserProvider(template="private-browser-template", api_key="manager-key-canary", sandbox_class=sdk)


OK_OUTPUT = json.dumps({"ok": True, "op": "snapshot", "url": ORIGIN + "/", "title": "读书打卡",
    "snapshot": [{"index": 0, "tag": "button", "name": "添加书籍"}], "evaluated": None, "screenshot": None,
    "console": [{"level": "error", "text": "加载记录失败 records is undefined"}], "failedRequests": [],
    "counts": {"errors": 1, "warnings": 0, "failedRequests": 0}})


def _interact(sdk, **kw):
    return _provider(sdk).interact(entry_url=ORIGIN + "/_whybuddy/authorize?ticket=" + TICKET,
                                   page_url=ORIGIN + "/", action={"op": "snapshot"}, **kw)


def test_one_fenced_sandbox_runs_the_same_script_and_is_destroyed():
    sdk = _SDK(OK_OUTPUT)
    seen = _interact(sdk)
    assert seen["snapshot"][0]["name"] == "添加书籍"
    assert seen["browserConsole"][0]["text"].startswith("加载记录失败")       # 报错原文走同一个出口
    [created] = sdk.created
    assert created["template"] == "private-browser-template"
    assert created["network"]["allow_out"] == ["rt-5f65a431.preview.miantuan.test"]
    assert created["network"]["allow_public_traffic"] is False and created["network"]["deny_out"]
    assert created["metadata"]["whybuddy_kind"] == ACTION_METADATA_KIND
    assert sdk.writes[REMOTE_ROOT + "/interact.cjs"] == browser_action_script('require("@playwright/test")')
    job = json.loads(sdk.writes[REMOTE_ROOT + "/action.json"])
    assert job == {"op": "snapshot", "url": ORIGIN + "/", "entryUrl": ORIGIN + "/_whybuddy/authorize?ticket=" + TICKET}
    assert "manager-key-canary" not in json.dumps(sdk.writes) + json.dumps(sdk.command[1])
    assert sdk.records == {}                                                 # 用完即毁


def test_the_scripts_own_failure_code_comes_back_and_the_sandbox_still_dies():
    from e2b import CommandExitException
    failed = CommandExitException(stdout=json.dumps({"ok": False, "error": "project_browser_preview_forbidden"}),
                                  stderr="", exit_code=1, error=None)
    sdk = _SDK(failed)
    with pytest.raises(ValueError, match="project_browser_preview_forbidden"):
        _interact(sdk)
    assert sdk.records == {}


def test_a_sandbox_whose_handle_will_not_die_is_found_by_its_label_and_destroyed():
    """每个动作开一台：句柄关不掉时，按这一类的标签找出来再毁，不留一台台没人管的浏览器计费。"""
    sdk = _SDK(OK_OUTPUT)
    sdk.handle_kill_fails = True
    _interact(sdk)
    assert sdk.records == {} and sdk.killed == ["act-sandbox-1"]


def test_bad_inputs_are_refused_before_any_sandbox():
    sdk = _SDK(OK_OUTPUT)
    with pytest.raises(ValueError, match="project_browser_input_invalid"):
        _provider(sdk).interact(entry_url="http://evil.test/_whybuddy/authorize?ticket=x",
                                page_url=ORIGIN + "/", action={"op": "snapshot"})
    assert sdk.created == []
    unconfigured = E2BProjectBrowserProvider(template="", api_key="k", sandbox_class=sdk)
    with pytest.raises(ValueError, match="project_browser_driver_unavailable"):
        unconfigured.interact(entry_url=ORIGIN + "/_whybuddy/authorize?ticket=" + TICKET,
                              page_url=ORIGIN + "/", action={"op": "snapshot"})


# ── 发票胶水 ────────────────────────────────────────────────────────────────────────────────────

class _Access:
    def __init__(self, tunnel=True, deny=False):
        self.tunnel, self.deny, self.calls = tunnel, deny, []

    def has_active_tunnel(self, operation_id, *, owner_id, audience):
        self.calls.append(("tunnel", operation_id, owner_id, audience))
        return self.tunnel

    def issue_browser_ticket(self, operation_id, *, owner_id, audience):
        self.calls.append(("issue", operation_id, owner_id, audience))
        if self.deny:
            raise PreviewAccessDenied("project_preview_binding_changed")
        return SimpleNamespace(secret=TICKET, scope=SimpleNamespace(grant_id="pva-1"))

    def revoke_grant(self, grant_id, *, owner_id):
        self.calls.append(("revoke", grant_id, owner_id))


class _Provider:
    def __init__(self, fail=None):
        self.fail, self.calls = fail, []

    def interact(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise ValueError(self.fail)
        return {"snapshot": [], "interactive": True}


PAGE = {"url": "/books", "revision": None, "operationId": "pop-run-1", "runtimeId": "rt-5f65a431", "ownerId": "alice"}


def _interactor(access, provider):
    return RemoteBrowserInteractor(access, lambda: provider, origin_for=lambda rid: f"https://{rid}.preview.miantuan.test")


def test_the_ticket_is_for_this_run_and_is_taken_back():
    access, provider = _Access(), _Provider()
    _interactor(access, provider)({"op": "snapshot"}, PAGE)
    assert ("issue", "pop-run-1", "alice", ORIGIN) in access.calls
    [call] = provider.calls
    assert call["entry_url"] == ORIGIN + "/_whybuddy/authorize?ticket=" + TICKET
    assert call["page_url"] == ORIGIN + "/books"                               # 模型要看的那一页，走网关
    assert access.calls[-1] == ("revoke", "pva-1", "alice")
    failing = _Access()
    with pytest.raises(ValueError, match="project_browser_action_failed"):
        _interactor(failing, _Provider(fail="project_browser_action_failed"))({"op": "snapshot"}, PAGE)
    assert failing.calls[-1] == ("revoke", "pva-1", "alice")                 # 失败了也收票


def test_no_ticket_means_the_preview_is_unreachable_not_a_code_bug():
    for access in (_Access(tunnel=False), _Access(deny=True)):
        provider = _Provider()
        with pytest.raises(ValueError, match="project_browser_preview_unreachable"):
            _interactor(access, provider)({"op": "snapshot"}, PAGE)
        assert provider.calls == []
    with pytest.raises(ValueError, match="project_browser_preview_not_ready"):
        _interactor(_Access(), _Provider())({"op": "snapshot"}, {"url": "/"})


# ── §三：真 browser_view 走到注入的那台，传过去的是这次运行的身份 ─────────────────────────────────────

def test_browser_view_reaches_the_remote_browser_with_this_runs_identity(setup, monkeypatch):
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    op = _ready_runtime(setup, project)
    _as_if_ready(monkeypatch, op.operationId, runtime_id="rt-5f65a431", preview_url=None)   # 网关模式：没有直连地址
    monkeypatch.setattr(pt, "local_playwright_available", lambda: False)
    access = _Access()

    class Provider:
        def interact(self, **kw):
            return decode_browser_action(OK_OUTPUT)
    monkeypatch.setattr(setup.supervisor, "browser_interactor",
                        _interactor(access, Provider()), raising=False)
    result = _dispatch(setup, "browser_view", {})
    assert "browserError" not in result, result
    assert result["snapshot"][0]["name"] == "添加书籍"
    assert ("issue", op.operationId, "alice", ORIGIN) in access.calls
    assert "preview.miantuan.test" not in json.dumps(result, ensure_ascii=False)   # 预览主机不进对话
