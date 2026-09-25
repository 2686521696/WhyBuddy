"""浏览器起不来 / 打不开 / 被拒，要分开说，而且说成人话。

⚠ 2026-09-25 隔离真机 sr-20260925070944-QGT6D76EYV：browser_view 回
  project_browser_action_failed。真因是这台主机的 Playwright 1.61 要的浏览器没装，
  launch 就失败了——产线脚本最后那句兜底 catch 把它抹成「动作失败」，整条
  browser_view 报错，连开发服务器在跑这件事也一起丢了。

第一组直接执行产线脚本 `_PLAYWRIGHT_JS`，只把 Playwright 换成桩（不重抄逻辑）。
把脚本里 launch / goto 的分类删掉，第一组变红；把 browser_view 的 try 删掉，
第二组变红。
"""

from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import project_browser_interact as interact
from test_project_tools import create, execute, setup  # noqa: F401  （夹具）

_STUBS = {
    "launch": "{ chromium: { launch: async () => { throw new Error('Executable doesn\\'t exist'); } } }",
    "goto": """{ chromium: { launch: async () => ({
        close: async () => {},
        newPage: async () => ({ on: () => {}, goto: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); } }),
    }) } }""",
    "forbidden": """{ chromium: { launch: async () => ({
        close: async () => {},
        newPage: async () => ({ on: () => {}, goto: async () => ({ status: () => 403 }) }),
    }) } }""",
}


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
@pytest.mark.parametrize("stub, code", [
    ("launch", "project_browser_driver_unavailable"),
    ("goto", "project_browser_preview_unreachable"),
    ("forbidden", "project_browser_preview_forbidden"),
])
def test_the_production_script_names_why_the_browser_failed(tmp_path, stub, code):
    script = tmp_path / "interact.js"
    script.write_text(interact._PLAYWRIGHT_JS % {"require_playwright": _STUBS[stub]}, encoding="utf-8")
    run = subprocess.run(["node", str(script)], input=json.dumps({"url": "https://rt.preview.example.com/", "op": "snapshot"}),
                         capture_output=True, text=True, timeout=30)
    assert json.loads(run.stdout) == {"ok": False, "error": code}


def _preview(setup, fails_with):
    def interactor(action, page):
        raise ValueError(fails_with)
    setup.supervisor.preview_page = lambda project: {"url": "https://rt.preview.example.com/"}
    setup.supervisor.browser_interactor = interactor


def test_browser_view_keeps_the_runtime_view_and_explains_the_browser(setup):
    create(setup)
    _preview(setup, "project_browser_driver_unavailable")
    viewed = execute(setup, "browser_view", {})
    assert viewed["ok"] is True, viewed
    assert viewed["interactive"] is False
    assert viewed["browserError"] == "project_browser_driver_unavailable"
    assert "不是应用代码" in viewed["hint"] and "别反复调 browser_*" in viewed["hint"]
    assert viewed["url"] == "/"  # 只给路径，见 test_preview_host_never_reaches_the_model


def test_a_browser_action_error_carries_the_same_explanation(setup):
    create(setup)
    _preview(setup, "project_browser_preview_forbidden")
    clicked = execute(setup, "browser_click", {"index": 0})
    assert clicked["ok"] is False and clicked["error"] == "project_browser_preview_forbidden"
    assert "不是应用自己的登录" in clicked["hint"]


def test_an_unclassified_error_gets_no_invented_explanation(setup):
    """反向：没归类的错误不编一句人话。"""
    create(setup)
    _preview(setup, "project_browser_target_missing")
    clicked = execute(setup, "browser_click", {"index": 99})
    assert clicked == {"ok": False, "error": "project_browser_target_missing"}
