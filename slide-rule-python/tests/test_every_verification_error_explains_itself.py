"""验收的每一个错误码都带一句人话：是什么、是谁的问题、该怎么办。模型不许只拿到一串字。

⚠ 2026-10-08 隔离真机 @frontend-design @verification-before-completion 读书打卡网页
  （sr-20261008103820-7ETR17FTE1）：页面 CSS 里 @import 了 Google Fonts，验收浏览器只许访问预览自己这一个地址，
  整次验收判 project_browser_navigation_blocked。VERIFICATION_ERROR_TEXT 里没有这个码，模型只拿到一串字，收尾写成
  「浏览器导航在环境侧被阻断」——把自己代码的问题当成环境问题，没改；自动续跑说「还没达到可交付」之后照样停下。

判据：
- 覆盖：码从**产线源码**里抠（provider.ERROR_CODES + 验收流程自己写进记录的字面量），不手抄名单；
- 真机那一发：走真工人、真验收记录、真 project_status 回执，收据形状照真机（构建过、内容可见 / 刷新过、
  no_page_errors / no_failed_requests 失败、navigation_blocked），模型拿到的那串字里有「应用代码」和改法；
- 兜底：表里没有的码（开发服务器停掉带过来的运行时码）也不许只给一串字。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import project_tools as pt
from services.project_browser_provider import ERROR_CODES
from services.project_tool_contracts import project_tool_definitions
from services.project_verification_gate import ENVIRONMENT_BLOCK_CODES
from services.rehearsal_control import bound_tool_result
from test_project_browser_verification import install_browser, verdict, verify
from test_project_live_source_sync import live  # noqa: F401  （夹具）

SERVICES = Path(__file__).resolve().parents[1] / "services"


def _codes_written_by_the_verification_flow() -> set[str]:
    src = (SERVICES / "project_browser_verification.py").read_text("utf-8")
    src = "\n".join(line.split("#", 1)[0] for line in src.splitlines())          # 剥注释：只认真写进记录的
    return set(re.findall(r'error(?:_code)?="([a-z_]+)"', src)) | set(re.findall(r'"errorCode": "([a-z_]+)"', src))


def test_the_scrape_finds_the_flow_codes():
    """前提：抠码这一步真抠到了东西，否则下面那条覆盖判据是空转。"""
    found = _codes_written_by_the_verification_flow()
    assert {"project_build_failed", "user_cancelled", "project_browser_preview_unavailable"} <= found, found


def test_every_code_that_can_reach_the_model_has_its_own_sentence():
    missing = sorted((set(ERROR_CODES) | _codes_written_by_the_verification_flow()) - set(pt.VERIFICATION_ERROR_TEXT))
    assert missing == [], f"这些验收错误码没有说明，模型只会拿到一串字：{missing}"


def test_an_unlisted_code_still_gets_a_sentence_not_a_bare_code():
    hint = pt.verification_error_hint("project_runtime_stopped")
    assert "project_runtime_stopped" in hint and "别猜" in hint
    assert pt.verification_error_hint(None) is None                               # 反向：没出错不挂


def test_navigation_blocked_is_the_apps_doing_not_the_environments():
    assert "project_browser_navigation_blocked" not in ENVIRONMENT_BLOCK_CODES
    hint = pt.VERIFICATION_ERROR_TEXT["project_browser_navigation_blocked"]
    assert "应用代码" in hint and "不是环境问题" in hint
    assert "Google Fonts" in hint and "系统字体" in hint                           # 真机那次的原因与改法


# ── 真机那一发，走真工人和真回执 ─────────────────────────────────────────────────────────────────

def _round_120(**kwargs):
    """真机那次的结局：别的断言都过，外链被拦让 no_page_errors / no_failed_requests 失败，码是 navigation_blocked。
    断言名单按工人要的那套套件给（夹具工程不是 react-vite-app@1，名单得对得上，否则收据本身就被判不合格）。"""
    from services.project_verification_gate import SUITE_ASSERTIONS
    failing = {"no_page_errors", "no_failed_requests"}
    return {"status": "failed", "cleanupConfirmed": True, "runnerVersion": "whybuddy-browser-v1:pw1.61.1",
            "errorCode": "project_browser_navigation_blocked", "artifacts": {},
            "assertions": [{"id": i, "status": "failed", "detail": "assertion"} if i in failing else {"id": i, "status": "passed"}
                           for i in sorted(SUITE_ASSERTIONS[kwargs["suite_version"]])]}


def test_the_round_120_receipt_tells_the_model_it_is_its_own_code(live, monkeypatch):  # noqa: F811
    browser, _ = install_browser(live, monkeypatch)
    monkeypatch.setattr(browser, "run", _round_120)
    child = verify(live)
    assert verdict(live, child).effectiveStatus == "failed"
    seen = live.tools.execute("project_status", {"operationId": child, "waitSeconds": 0}, live.state)
    assert seen["verification"]["errorCode"] == "project_browser_navigation_blocked"
    fed = bound_tool_result({"tool": "project_status", **seen}, "project_status")   # 模型真正读到的那串
    assert "应用代码造成" in fed and "Google Fonts" in fed, fed[:800]


def test_web_projects_are_warned_before_they_write_the_external_link():
    """事前也说：建网页工程那件工具的说明里就写明验收只许访问预览自己。"""
    [create] = [t for t in project_tool_definitions() if t["function"]["name"] == "project_create"]
    text = json.dumps(create, ensure_ascii=False)
    assert "Google Fonts" in text and "project_browser_navigation_blocked" in text


def test_an_unlisted_code_reaches_the_real_receipt_with_a_sentence(live, monkeypatch):  # noqa: F811
    """兜底接在真回执上：表里拿掉这个码（模拟以后新加、忘了写的码），回执照样带一句话，不是只有码。"""
    browser, _ = install_browser(live, monkeypatch)
    monkeypatch.setattr(browser, "run", _round_120)
    monkeypatch.delitem(pt.VERIFICATION_ERROR_TEXT, "project_browser_navigation_blocked")
    child = verify(live)
    verdict(live, child)
    seen = live.tools.execute("project_status", {"operationId": child, "waitSeconds": 0}, live.state)
    hint = seen["verification"].get("errorHint") or ""
    assert "project_browser_navigation_blocked" in hint and "别猜" in hint, seen["verification"]
