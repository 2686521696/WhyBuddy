"""页面里报了什么错，模型看得到原话：JS 异常、console.error、失败的请求。

⚠ 2026-10-08 审查：验收收据按设计只有计数（no_page_errors 失败 = 「有报错」），而模型唯一叫得出的
  browser_console_view 读的是开发服务器的命令日志——浏览器里的报错在任何工具里都看不到，模型只能对着代码猜
  （services/project_browser_interact.console_observation 头注）。

判据走真 Chrome、真页面（不 mock 驱动）：页面照真机常见的那三种坏法写——渲染期 TypeError、
console.error、接口 404（地址里还带着预览票据）。再走真 _dispatch_tool 证明 browser_console_view 接上了。
"""

from __future__ import annotations

import json

import pytest

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import project_tools as pt
from services import rehearsal_control as rc
from services.project_browser_interact import console_observation, local_playwright_available, run_browser_action
from test_project_browser_interact import _real_chrome
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

TICKET = "tkt_9f8e7d6c5b4a39281706"

BROKEN = f"""<!doctype html><meta charset="utf-8"><title>月度预算</title><div id="root"></div>
<script>
  console.error("加载预算失败", "categories is undefined");
  fetch("/api/budget?ticket={TICKET}").catch(() => {{}});
  setTimeout(() => {{ const data = {{}}; data.items.map(x => x); }}, 0);
</script>"""

# 带上图标：完整版 Chrome（SLIDERULE_CHROMIUM_PATH 指的那种）会自己去要 /favicon.ico，缺了就是一条真的 404，
# 照实报（project-templates/react-vite 的 index.html 就没有图标）。这条判据要的是「真没报错时是空的」。
CLEAN = """<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>月度预算</title><h1>本月支出</h1><button>添加</button>"""


def _serve(tmp_path, html):
    import http.server
    import threading

    (tmp_path / "index.html").write_text(html, encoding="utf-8")

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(tmp_path), **k)

        def log_message(self, *a):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"


@pytest.fixture
def chrome(monkeypatch):
    if not local_playwright_available():
        pytest.skip("node_modules/@playwright/test not installed")
    path = _real_chrome()
    if path is None:
        pytest.skip("no local Chrome")
    monkeypatch.setenv("SLIDERULE_CHROMIUM_PATH", path)
    return path


def test_a_broken_page_reports_its_own_words(tmp_path, chrome):
    server, url = _serve(tmp_path, BROKEN)
    try:
        seen = run_browser_action(url, {"op": "snapshot"}, timeout_s=60)
    finally:
        server.shutdown()
    texts = [entry["text"] for entry in seen["browserConsole"]]
    assert any("reading 'map'" in t for t in texts), texts                       # 未捕获的 TypeError，原话
    assert any(e["level"] == "pageerror" for e in seen["browserConsole"])
    assert any("加载预算失败" in t and e["level"] == "error"
               for e, t in zip(seen["browserConsole"], texts)), texts           # console.error，原话
    assert {"method": "GET", "path": "/api/budget", "status": 404} in seen["failedRequests"], seen["failedRequests"]
    assert seen["consoleCounts"]["errors"] >= 2 and seen["consoleCounts"]["failedRequests"] >= 1
    # 反向：预览主机与票据不跟着出去（跟 model_page_path 同一条）
    assert TICKET not in repr(seen) and "127.0.0.1" not in repr(seen["browserConsole"] + seen["failedRequests"])


def test_a_clean_page_says_so(tmp_path, chrome):
    """反向：没报错就是空的，计数为零——不是「没收集」。"""
    server, url = _serve(tmp_path, CLEAN)
    try:
        seen = run_browser_action(url, {"op": "snapshot"}, timeout_s=60)
    finally:
        server.shutdown()
    assert seen["browserConsole"] == [] and seen["failedRequests"] == []
    assert seen["consoleCounts"] == {"errors": 0, "warnings": 0, "failedRequests": 0}


def test_unknown_is_not_clean():
    """驱动没报这几项（旧驱动、注入的 interactor）→ 什么都不加，不许写成零报错。"""
    assert console_observation({"ok": True, "snapshot": []}) == {}


def test_entries_are_bounded():
    body = {"counts": {"errors": 500, "warnings": 0, "failedRequests": 0},
            "console": [{"level": "error", "text": "x" * 5000}] * 50 + [{"level": "log", "text": "noise"}]}
    seen = console_observation(body)
    assert len(seen["browserConsole"]) == 6 and len(seen["browserConsole"][0]["text"]) == 240
    assert seen["consoleCounts"]["errors"] == 500                                 # 截掉的条数看得出来


def test_the_crash_outranks_the_warnings():
    """React 开发版一屏 warning 在前、真正的异常在后：封顶之后留下的必须是异常。"""
    body = {"counts": {"errors": 1, "warnings": 9, "failedRequests": 0},
            "console": [{"level": "warning", "text": "Each child in a list should have a unique key"}] * 9
            + [{"level": "pageerror", "text": "TypeError: Cannot read properties of undefined (reading 'map')"}]}
    assert console_observation(body)["browserConsole"][0]["level"] == "pageerror"


# ── 回喂给模型的那一步：默认 4000 字、从尾巴裁。报错排在快照后面就整段没了 ─────────────────────

BUSY = BROKEN.replace('<div id="root"></div>', "".join(
    f'<button>第{i}类支出明细：餐饮外卖、公共交通、房租水电、娱乐订阅、医疗药品、子女教育、手机通讯、日用百货、人情往来、宠物开销</button>'
    for i in range(40)))                    # 驱动每个节点取前 80 字、最多 40 个——真页面一屏按钮就是这个量


def test_the_error_survives_the_trip_to_the_model(setup, tmp_path, chrome, monkeypatch):
    """真 Chrome、真 browser_view 分发、真 bound_tool_result：模型读到的那串字里有异常原话。"""
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    create(setup)
    server, url = _serve(tmp_path, BUSY)
    try:
        monkeypatch.setattr(pt.ProjectTools, "_preview_page", lambda self, project: {"url": url, "revision": None})
        result = _dispatch(setup, "browser_view", {})
    finally:
        server.shutdown()
    receipt = {k: v for k, v in result.items() if k not in {"type", "seq", "controlRunId"}}   # 同 control_run_service
    fed = rc.bound_tool_result(receipt, "browser_view")
    block = sum(len(json.dumps(receipt[k], ensure_ascii=False)) for k in ("browserConsole", "failedRequests"))
    assert len(json.dumps(receipt, ensure_ascii=False)) - block > rc.control_tool_result_max_chars("browser_view"), \
        "前提：光是报错以外的部分就超过上限——报错排在后面就会被整段裁掉"
    assert "reading 'map'" in fed and "/api/budget" in fed, fed[:600]


# ── §三：接上了。browser_console_view 走真 _dispatch_tool，浏览器那一半真的在回执里 ─────────────

def test_browser_console_view_carries_the_browser_half(setup, monkeypatch):
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.exec",
        idempotency_key="console-check", expected_revision=project["revision"], approval_ref=setup.approval,
        input={"command": "check"})
    monkeypatch.setattr(pt.ProjectTools, "_preview_page",
                        lambda self, project: {"url": "https://5173-abc.e2b.app/", "revision": None})
    monkeypatch.setattr(pt, "local_playwright_available", lambda: True)
    calls = []

    def fake_action(url, action, **kw):
        calls.append(action["op"])
        return {"snapshot": [], **console_observation({
            "counts": {"errors": 1, "warnings": 0, "failedRequests": 1},
            "console": [{"level": "pageerror", "text": "TypeError: Cannot read properties of undefined (reading 'map')"}],
            "failedRequests": [{"method": "GET", "path": "/api/budget", "status": 404}]})}
    monkeypatch.setattr(pt, "run_browser_action", fake_action)
    result = _dispatch(setup, "browser_console_view", {})
    assert calls == ["snapshot"], result
    assert result["console"] == "runtime"                                           # 命令日志那一半还在
    assert "reading 'map'" in result["browserConsole"][0]["text"], result
    assert result["failedRequests"] == [{"method": "GET", "path": "/api/budget", "status": 404}]


def test_browser_console_view_without_a_preview_still_returns_the_log(setup, monkeypatch):
    """fail-open：预览没起来，命令日志照旧，附上为什么没有浏览器那一半。"""
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.exec",
        idempotency_key="console-check", expected_revision=project["revision"], approval_ref=setup.approval,
        input={"command": "check"})
    monkeypatch.setattr(pt.ProjectTools, "_preview_page", lambda self, project: None)
    result = _dispatch(setup, "browser_console_view", {})
    assert result["console"] == "runtime" and result["browserConsoleError"] == "project_browser_preview_not_ready"
    assert "browserConsole" not in result


def test_a_failed_page_check_points_at_the_console():
    hint = pt.VERIFICATION_ERROR_TEXT["project_browser_assertion_failed"]
    assert "browser_console_view" in hint and "no_page_errors" in hint
