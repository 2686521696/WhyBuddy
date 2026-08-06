# -*- coding: utf-8 -*-
"""本机 Playwright 截图路径（2026-08-04）。

背景：FreeformInsight 的自我校验闭环（生成→截图→自己看→改）此前只有 E2B
一条路，而 E2B 要三个条件——E2B_API_KEY、SLIDERULE_PUBLIC_APP_URL 公网域名、
每次现装 playwright+chromium。公网域名在本地开发根本没有，实测日志里
`block.screenshot got=0`，这个闭环**从上线起一次都没跑过**。

本机路径把三个条件全省了。实测：本机 2.7s 出图（E2B 那条光沙盒开销就 29s+），
中文与 canvas（ECharts 默认 canvas 渲染）都正常截到。
"""

import json

import pytest

from services import app_screenshot as sc


class TestAvailability:
    def test_没有_node_就判不可用(self, monkeypatch):
        import shutil

        monkeypatch.setattr(shutil, "which", lambda name: None)
        assert sc.local_screenshot_available() is False

    def test_仓库里装了_playwright_就算可用(self):
        # 本仓库 devDependencies 里有 @playwright/test，容器里也装了
        assert sc.local_screenshot_available() is True

    def test_本机地址默认_localhost_不需要公网域名(self, monkeypatch):
        monkeypatch.delenv(sc._LOCAL_APP_URL_ENV, raising=False)
        assert sc._local_app_base_url() == "http://localhost:3000"

    def test_本机地址可被环境变量覆盖且去掉尾斜杠(self, monkeypatch):
        monkeypatch.setenv(sc._LOCAL_APP_URL_ENV, "http://127.0.0.1:5173/")
        assert sc._local_app_base_url() == "http://127.0.0.1:5173"

    def test_完整应用截图本机或_e2b_任一可用即可(self, monkeypatch):
        monkeypatch.setattr(sc, "local_screenshot_available", lambda: True)
        monkeypatch.setattr(sc, "e2b_screenshot_available", lambda: False)
        assert sc.app_screenshot_available() is True


class TestJsTemplate:
    """两条路共用同一份模板——共用是为了「本地看着对、换 E2B 就不一样」这种
    极难查的差异不会发生。所以两套参数都必须能填满。"""

    @pytest.mark.parametrize(
        "require_expr",
        ['require("playwright")', 'require("/abs/path/@playwright/test")'],
    )
    def test_两套参数都能填满模板(self, require_expr):
        js = sc._FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE % {
            "require_playwright": require_expr,
            "preview_url_json": json.dumps("http://localhost:3000/x"),
            "shot_path_json": json.dumps("/tmp/a.png"),
            "axe_path_json": json.dumps("/repo/node_modules/axe-core/axe.min.js"),
            "axe_out_json": json.dumps("/tmp/axe.json"),
        }
        assert "%(" not in js  # 没有漏填的占位符
        assert require_expr in js
        assert 'data-testid="freeform-preview-root"' in js
        assert "SCREENSHOT_OK" in js

    def test_axe_扫描与截图同一次打开_且扫不动不影响截图(self):
        """浏览器已经开着、页面已经渲染好，顺手扫一遍几乎零开销
        （实测 2.7s → 2.8s）。但它是增强项，出错不能连累已经拿到的截图。"""
        src = sc._FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE
        assert "axe.run" in src
        assert "AXE_SKIP" in src  # 扫描异常被单独 catch 掉
        # 截图先落盘、再扫 axe——顺序保证扫描失败时截图已经在手上了
        assert src.index("el.screenshot") < src.index("axe.run")

    def test_本机路径_require_的是绝对路径(self):
        """CommonJS 的 require 按**脚本所在目录**往上找 node_modules，与 cwd 无关。
        脚本写在临时目录里，给包名会 MODULE_NOT_FOUND（实测踩过）。"""
        assert (sc._repo_root() / "node_modules" / "@playwright" / "test").is_dir()


class TestFailClosed:
    def test_本机不可用时返回_None(self, monkeypatch):
        monkeypatch.setattr(sc, "local_screenshot_available", lambda: False)
        assert sc.capture_freeform_preview_screenshot_local("pid") is None

    def test_node_跑挂了返回_None_不抛(self, monkeypatch, capsys):
        import subprocess

        monkeypatch.setattr(sc, "local_screenshot_available", lambda: True)

        class _Res:
            stdout = ""
            stderr = "SCREENSHOT_FAIL: boom"

        monkeypatch.setattr(subprocess, "run", lambda *a, **k: _Res())
        assert sc.capture_freeform_preview_screenshot_local("pid") is None
        # 失败原因要留痕：此前静默返回 None，日志里只有 got=0，排查时
        # 分不清是没装浏览器、页面没起来还是选择器没匹配上
        assert "boom" in capsys.readouterr().out


class TestPreferLocal:
    def test_优先本机_本机成了就不碰_E2B(self, monkeypatch):
        called = {"e2b": 0}
        monkeypatch.setattr(sc, "capture_freeform_preview_screenshot_local", lambda pid, timeout_s=60: b"PNG")

        def _boom():
            called["e2b"] += 1
            return True

        monkeypatch.setattr(sc, "e2b_screenshot_available", _boom)
        assert sc.capture_freeform_preview_screenshot("pid") == b"PNG"
        # 顺序不能反：E2B 每次要现装 playwright+chromium，本机零安装开销
        assert called["e2b"] == 0

    def test_本机不成才回落_E2B(self, monkeypatch):
        monkeypatch.setattr(sc, "capture_freeform_preview_screenshot_local", lambda pid, timeout_s=60: None)
        monkeypatch.setattr(sc, "e2b_screenshot_available", lambda: False)
        # E2B 也不可用 → None（fail-closed，不假装成功）
        assert sc.capture_freeform_preview_screenshot("pid") is None

    def test_完整应用截图优先本机_成功后不碰_e2b(self, monkeypatch):
        called = {"e2b": 0}
        monkeypatch.setattr(
            sc,
            "capture_app_screenshot_local",
            lambda sid, timeout_s=60: b"LOCAL_PNG",
        )

        def _e2b_available():
            called["e2b"] += 1
            return True

        monkeypatch.setattr(sc, "e2b_screenshot_available", _e2b_available)
        assert sc.capture_app_screenshot("session-1") == b"LOCAL_PNG"
        assert called["e2b"] == 0


class TestSelfVerifyGate:
    def test_自检门槛认本机_不再只认_E2B(self, monkeypatch):
        """此前 freeform_block 里硬卡 e2b_screenshot_available()，本地永远进不去。"""
        import services.freeform_block as fb
        import inspect

        src = inspect.getsource(fb._render_preview_screenshot_b64)
        assert "local_screenshot_available" in src
        assert "if not (local_screenshot_available() or e2b_screenshot_available())" in src
