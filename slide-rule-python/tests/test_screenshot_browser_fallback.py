"""截图启动 Chromium 的回退（2026-08-12）。

## 出处

真跑一趟健身房话题，日志里这一段：

    [app_screenshot] 本机截图未成: browserType.launch: Executable doesn't exist at
        /opt/pw-browsers/chromium_headless_shell-1228/.../chrome-headless-shell
    [enrich-timing] stage=block.screenshot ms=49866 ok=1 got=0

环境里烤好的是 **1194**，项目钉的 @playwright/test 1.61.1 要 **1228**。

代价不只是"没截到图"：`block.screenshot got=0` 之后，`block.critique`
（拿截图跟参照图比、自己改一版）**整段不执行**。也就是说"生成→截图→自己看
→改"这个自检闭环里的"看"，在这类环境上从来没发生过——而且它是**静默**的，
只在一行 print 里，enrich-timing 还记着 ok=1。

## 判据为什么钉在"两个模板都得有"

这个仓库里有两条截图路径（整页截图 / freeform 预览截图），各自一份 JS 模板，
而且每份又被本机和 E2B 两个调用点复用。修一份漏一份是这类"多份模板"最典型的
失败——所以断言逐个模板查，不查"文件里出现过"。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.app_screenshot import (  # noqa: E402
    _FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE,
    _LAUNCH_CHROMIUM_JS,
    _SCREENSHOT_JS_TEMPLATE,
)

TEMPLATES = {
    "整页截图": _SCREENSHOT_JS_TEMPLATE,
    "freeform 预览截图": _FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE,
}


@pytest.mark.parametrize("name", sorted(TEMPLATES))
def test_every_template_launches_through_the_fallback(name: str) -> None:
    """两份模板都得走回退，一份都不能漏。"""
    tpl = TEMPLATES[name]
    assert "await launchChromium(chromium," in tpl, f"{name} 还在裸调 chromium.launch"
    assert "resolveChromiumCandidates" in tpl, f"{name} 没带上候选解析"


@pytest.mark.parametrize("name", sorted(TEMPLATES))
def test_no_bare_launch_left(name: str) -> None:
    """裸的 chromium.launch 只允许出现在回退函数**内部**。

    这条是防"改了一处、另一处还留着老写法"——那正是这个 bug 能活到今天的形状。
    """
    body = TEMPLATES[name].replace(_LAUNCH_CHROMIUM_JS, "")
    assert "chromium.launch(" not in body, f"{name} 里还有绕过回退的裸调用"


def test_default_path_is_tried_first() -> None:
    """默认解析能起就绝不插手 —— E2B 那条路（现装 playwright）必须逐字节不受影响。"""
    i = _LAUNCH_CHROMIUM_JS.index("async function launchChromium")
    body = _LAUNCH_CHROMIUM_JS[i:]
    first_try = body.index("return await chromium.launch(options)")
    fallback = body.index("resolveChromiumCandidates()")
    assert first_try < fallback, "先去找候选再试默认 —— 顺序反了，正常环境也被改道"


def test_original_error_is_rethrown_when_nothing_works() -> None:
    """一个候选都起不来时抛回**原始错误**。

    用"找不到浏览器"盖掉真正的失败原因，下一个人就得从头查一遍。
    """
    assert "throw err;" in _LAUNCH_CHROMIUM_JS


def test_env_override_comes_first() -> None:
    """显式指定的路径优先于自动搜索 —— 对标 PUPPETEER_EXECUTABLE_PATH。"""
    i = _LAUNCH_CHROMIUM_JS.index("function resolveChromiumCandidates")
    body = _LAUNCH_CHROMIUM_JS[i:]
    override = body.index("SLIDERULE_CHROMIUM_EXECUTABLE_PATH")
    scan = body.index("PLAYWRIGHT_BROWSERS_PATH")
    assert override < scan, "自动搜索排在了显式指定前面 —— 覆盖不了"
