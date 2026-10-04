"""Closed browser actions compile before any driver runs.

反向：compile 放行无目标的 click、run_browser_action 在没 Playwright
时假装成功，本文件都会红。
"""

import pytest

from services.project_browser_interact import local_playwright_available, run_browser_action
from services.project_tool_contracts import compile_browser_action
from types import SimpleNamespace


def test_compile_requires_a_target_and_rejects_sudo():
    with pytest.raises(ValueError, match="project_sudo_forbidden"):
        compile_browser_action("browser_click", SimpleNamespace(
            sudo=True, index=0, coordinate_x=None, coordinate_y=None))
    with pytest.raises(ValueError, match="project_browser_action_invalid"):
        compile_browser_action("browser_click", SimpleNamespace(
            sudo=False, index=None, coordinate_x=None, coordinate_y=None))
    assert compile_browser_action("browser_click", SimpleNamespace(
        sudo=False, index=2, coordinate_x=None, coordinate_y=None)) == {
        "op": "click", "index": 2,
    }
    assert compile_browser_action("browser_input", SimpleNamespace(
        sudo=False, index=1, text="hello", press_enter=True)) == {
        "op": "type", "text": "hello", "pressEnter": True, "index": 1,
    }


def test_empty_preview_is_not_ready():
    with pytest.raises(ValueError, match="project_browser_preview_not_ready"):
        run_browser_action("", {"op": "snapshot"})


def test_missing_playwright_is_unavailable_not_a_fake_click(monkeypatch):
    monkeypatch.setattr("services.project_browser_interact.local_playwright_available", lambda: False)
    with pytest.raises(ValueError, match="project_browser_driver_unavailable"):
        run_browser_action("https://app.preview.example.com/", {"op": "snapshot"})


def test_playwright_shot_stays_off_the_model_observation(monkeypatch):
    import base64
    import json
    from types import SimpleNamespace

    png = b"\x89PNG\r\n\x1a\n" + b"shot"
    monkeypatch.setattr(
        "services.project_browser_interact.local_playwright_available", lambda: True
    )

    def fake_run(*args, **kwargs):
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({
                "ok": True,
                "op": "snapshot",
                "url": "https://app.preview.example.com/",
                "title": "Game",
                "snapshot": [],
                "evaluated": None,
                "screenshot": base64.b64encode(png).decode("ascii"),
            }),
            stderr="",
        )

    monkeypatch.setattr(
        "services.project_browser_interact.subprocess.run", fake_run
    )
    result = run_browser_action(
        "https://app.preview.example.com/", {"op": "snapshot"}
    )
    assert result["screenshotPng"] == png
    assert "screenshot" not in result
    assert result["title"] == "Game"


def _serve_page(tmp_path):
    import http.server
    import threading

    (tmp_path / "index.html").write_text(
        "<!doctype html><meta charset=\"utf-8\"><title>焙序</title><h1>城市烘焙实验室</h1><button>预约到店</button>", encoding="utf-8")
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(tmp_path), **k)  # noqa: E731
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"


def _real_chrome():
    import os
    from pathlib import Path

    for candidate in (os.environ.get("SLIDERULE_CHROMIUM_PATH", ""), "/opt/pw-browsers/chromium"):
        if candidate and Path(candidate).exists():
            return candidate
    return None


def test_the_driver_honours_the_shared_chromium_path(tmp_path, monkeypatch):
    """真起 Playwright（不 mock）：SLIDERULE_CHROMIUM_PATH 指向谁就用谁。

    ⚠ 2026-10-04 真机 @frontend-design：容器里 Playwright 要的版本没装，browser_view 全是
      driver_unavailable，模型跳过了技能要求的截图自查。验收那边早就认这个变量，这里漏了。
    反向：指一个不存在的路径必须是 driver_unavailable——证明真的按这个变量起的，不是碰巧起来。
    """
    if not local_playwright_available():
        pytest.skip("node_modules/@playwright/test not installed")
    chrome = _real_chrome()
    if chrome is None:
        pytest.skip("no local Chrome to point SLIDERULE_CHROMIUM_PATH at")
    server, url = _serve_page(tmp_path)
    try:
        monkeypatch.setenv("SLIDERULE_CHROMIUM_PATH", str(tmp_path / "no-such-chrome"))
        with pytest.raises(ValueError, match="project_browser_driver_unavailable"):
            run_browser_action(url, {"op": "snapshot"})

        monkeypatch.setenv("SLIDERULE_CHROMIUM_PATH", chrome)
        seen = run_browser_action(url, {"op": "snapshot"}, timeout_s=60)
        assert seen["title"] == "焙序"
        assert any("预约到店" in str(node) for node in seen["snapshot"])
    finally:
        server.shutdown()
