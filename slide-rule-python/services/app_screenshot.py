"""
app_screenshot — 真实应用缩略图截图，跑在 E2B 沙盒里（2026-07-23 修复）。

背景：Node 侧原实现（server/routes/sliderule.ts）用本地 Playwright
（chromium.launch()）直接截图。但生产运行时镜像是 node:22-alpine（musl
libc），且 @playwright/test 只在 devDependencies（生产 `pnpm install --prod`
排除），这条路径在生产环境从未真正跑通过——`import("@playwright/test")`
必然失败，截图接口恒 503，前端一直静默回退到 MiniAppThumb 假占位卡，
`应用中心` 里的卡片跟设计效果图差距巨大的根子在这，不是 Step 1-9 的渲染
逻辑问题。

改用 E2B 沙盒执行 Playwright：沙盒是 Debian（glibc 兼容），宿主 Node 镜像
零 Chromium 依赖，不用为这一个功能把生产镜像做重。

fail-closed：E2B_API_KEY 缺失 / SLIDERULE_PUBLIC_APP_URL 未配置 / 沙盒内任一
步骤失败 → 返回 None，不假装成功。调用方（Node screenshot 路由）按 None
直接 503，前端如实回退占位卡——和现在的失败态视觉上一致，只是"真的截图成功
时" 从恒失败变成真的会成功。
"""

from __future__ import annotations

import json
import os
from typing import Optional

# 沙盒默认无 Playwright，也无 Chromium 二进制——每次 cache miss 现装。
# 版本钉死跟仓库 package.json 的 @playwright/test 一致，行为可预期。
_PLAYWRIGHT_VERSION = "1.61.1"

# 2026-07-26 成本优化：现装 playwright+chromium 是整条截图链最大的浪费
# （每个一次性沙盒 ~2 分钟安装）。配了 SLIDERULE_E2B_TEMPLATE（用 e2b CLI
# 把 playwright+chromium 烤进自定义沙盒模板，做法同仓内 AGENTSHIRE_E2B_TEMPLATE
# 先例）即跳过现装、秒级启动；未配走原路径，行为不变。
_E2B_TEMPLATE_ENV = "SLIDERULE_E2B_TEMPLATE"


def _e2b_template() -> Optional[str]:
    tpl = (os.getenv(_E2B_TEMPLATE_ENV) or "").strip()
    return tpl or None


def _create_sandbox(timeout_s: int):
    from e2b_code_interpreter import Sandbox

    template = _e2b_template()
    if template:
        return Sandbox.create(template, timeout=timeout_s + 30)
    return Sandbox.create(timeout=timeout_s + 30)


def _ensure_playwright(sandbox, timeout_s: int) -> bool:
    """确保沙盒里有 playwright+chromium。自定义模板已烤进去 → 直接 True；
    默认模板现装（原行为）。安装失败返回 False（调用方 fail-closed）。"""
    if _e2b_template():
        return True
    install = sandbox.run_code(
        "import subprocess, json\n"
        f"r1 = subprocess.run(['npm','install','playwright@{_PLAYWRIGHT_VERSION}'], "
        "capture_output=True, text=True, timeout=90, cwd='/tmp')\n"
        "r2 = subprocess.run(['npx','playwright','install','--with-deps','chromium'], "
        "capture_output=True, text=True, timeout=150, cwd='/tmp')\n"
        "print(json.dumps({'install_rc': r1.returncode, 'browser_rc': r2.returncode}))",
        timeout=timeout_s,
    )
    return install.error is None

# 目标画幅：跟应用中心卡片的宽高比、以及参照板出图的画布**逐字对齐**
# （client/src/lib/justified-rows.ts 的 DEVICE_ASPECT，与 imagegen 的
# PC 1280×720 / 移动 720×1280）。
#
# 为什么必须对齐：卡片用 object-fit: cover 贴图，图的比例跟卡片对不上就会被
# 裁。两个来源（e2b 真截图 / sheet 参照板）画幅一致，卡片才不用关心这张图是
# 哪来的——切换来源不会让画面跳一下。
#
# ⚠️ 不能照 AppRuntimeScreen 的 DEVICE_SPECS 抄：那是渲染画布尺寸，手机档
# 390×844 = 0.462，而卡片是 9:16 = 0.5625。照那个截出来的图贴进卡片，上下会
# 被 cover 裁掉约 18%——正是 2026-08-01 那个比例 bug 的同款。
_SHOT_CANVAS = {
    "desktop": (1280, 720),
    "tablet": (1280, 720),
    "phone": (720, 1280),
}
_DEFAULT_SHOT_DEVICE = "desktop"


def _shot_canvas(device: Optional[str]) -> tuple[int, int]:
    """档位 → 目标画幅。认不出来按桌面处理——跟 aspectForDevice 同一个取向，
    也是保守的那一边：错判成桌面只是图偏宽，错判成手机会把一个宽版应用压进
    竖条里。"""
    return _SHOT_CANVAS.get((device or "").strip().lower(), _SHOT_CANVAS[_DEFAULT_SHOT_DEVICE])


_SCREENSHOT_JS_TEMPLATE = """
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: %(viewport_w)d, height: %(viewport_h)d },
      // 卡片最宽也就 634px，但缩略图会被高分屏放大；2 倍采样换来的是文字边缘
      // 不糊。代价是 PNG 体积约 4 倍——UI 截图压缩率高，实测仍在参照板那张
      // （约 830KB）的量级。
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.addInitScript((sid) => {
      try { localStorage.setItem("sliderule:active-session-id", sid); } catch {}
    }, %(session_id_json)s);
    await page.goto(%(app_url_json)s, { waitUntil: "domcontentloaded", timeout: 25000 });
    try {
      await page.waitForSelector('[data-testid="app-runtime-screen"]', { timeout: 12000 });
    } catch {}
    // 图表/图标那些懒加载 chunk 要一点时间稳定，否则截到半渲染的过渡态。
    // 跟 freeform 预览截图同一个数（1500ms），那条路已经在生产验证过。
    await page.waitForTimeout(1500);
    const appEl = await page.$('[data-testid="app-runtime-screen"]');
    // **等不到应用根元素就失败，不许退而求其次截个视口。**
    //
    // 原来这里有一支"截左上角一块，聊胜于无"的回退。在旧用法下（按需截图接口，
    // 截了就直接回给前端看）那还说得过去；现在这张图会被存进库、并且排在缩略图
    // 优先级的**第一位**，退而求其次就变成了主动的错误——2026-08-02 实测：会话
    // 在目标环境不存在时，那一支截回来的是一张空的产品落地页，而它会顶掉本来
    // 诚实的参照板。宁可没有真截图（卡片留在参照板），也不要一张假的。
    if (!appEl) throw new Error("app-runtime-screen not found (session not rendered)");
    // 按目标比例从**左上角**切一块，而不是整个元素照单全收。
    //
    // 元素本身的比例是渲染画布定的（桌面 16:9、手机 0.462），跟卡片不一定
    // 相等。整个截下来交给 cover 去裁，裁掉的是上下**各一半**——手机档会把
    // 顶部那条应用标题栏切掉。从左上角切则是"留头去尾"，跟活渲染那条路
    // （scaleFit="width"，宽度铺满、下面溢出裁掉）看到的是同一块画面。
    const targetAspect = %(viewport_w)d / %(viewport_h)d;
    const box = await appEl.boundingBox();
    if (!box || box.width < 8 || box.height < 8) throw new Error("empty app element box");
    let cw = box.width;
    let ch = cw / targetAspect;
    if (ch > box.height) { ch = box.height; cw = ch * targetAspect; }
    await page.screenshot({
      path: "/tmp/app-thumb.png",
      clip: { x: box.x, y: box.y, width: cw, height: ch },
    });
    console.log("SCREENSHOT_OK");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("SCREENSHOT_FAIL:", e && e.message);
  process.exit(1);
});
"""


def e2b_screenshot_available() -> bool:
    """两个必要条件都满足才可用：E2B key + 公网可达的应用地址。"""
    return bool((os.getenv("E2B_API_KEY") or "").strip()) and bool(_public_app_base_url())


def _public_app_base_url() -> Optional[str]:
    """运行中应用的公网/可从 E2B 沙盒访问的基地址（不含末尾斜杠）。

    不同于容器内部的 localhost——E2B 沙盒是独立云端机器，够不到宿主
    localhost，必须给一个真实可达地址（生产环境通常是对外域名）。
    """
    url = (os.getenv("SLIDERULE_PUBLIC_APP_URL") or "").strip().rstrip("/")
    return url or None


_FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE = """
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const page = await ctx.newPage();
    await page.goto(%(preview_url_json)s, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForSelector('[data-testid="freeform-preview-root"]', { timeout: 15000 });
    // 给图表/图标这些懒加载 chunk 一点时间稳定下来，避免截到半渲染的过渡态。
    await page.waitForTimeout(1500);
    const el = await page.$('[data-testid="freeform-preview-root"]');
    await el.screenshot({ path: "/tmp/freeform-preview.png" });
    console.log("SCREENSHOT_OK");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("SCREENSHOT_FAIL:", e && e.message);
  process.exit(1);
});
"""


def capture_freeform_preview_screenshot(preview_id: str, timeout_s: int = 90) -> Optional[bytes]:
    """FreeformInsight 自我校验闭环用：在一次性 E2B 沙盒里截图一份还没写入
    任何 session 的候选内容（generate_freeform_block 生成中途调用）。

    跟 capture_app_screenshot 同一套 fail-closed 语义、同一个 E2B 沙盒安装
    步骤，区别只是目标 URL——这里打的是隔离预览页
    （/sliderule/freeform-preview/:pid），不是某个真实 session 的完整应用。
    """
    if not e2b_screenshot_available():
        return None
    base_url = _public_app_base_url()
    preview_url = f"{base_url}/sliderule/freeform-preview/{preview_id}"

    sandbox = _create_sandbox(timeout_s)
    try:
        if not _ensure_playwright(sandbox, timeout_s):
            return None

        js_code = _FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE % {
            "preview_url_json": json.dumps(preview_url),
        }
        run = sandbox.run_code(
            "open('/tmp/shot.js', 'w').write(" + repr(js_code) + ")\n"
            "import subprocess\n"
            "res = subprocess.run(['node', '/tmp/shot.js'], capture_output=True, text=True, "
            "timeout=40, cwd='/tmp')\n"
            "print('RC:', res.returncode)\n"
            "print(res.stdout)\n"
            "print(res.stderr[-1000:])",
            timeout=timeout_s,
        )
        stdout_text = "\n".join(run.logs.stdout)
        if "SCREENSHOT_OK" not in stdout_text:
            return None

        content = sandbox.files.read("/tmp/freeform-preview.png", format="bytes")
        return bytes(content) if content else None
    except Exception:
        return None
    finally:
        try:
            sandbox.kill()
        except Exception:
            pass


def capture_app_screenshot(
    session_id: str, timeout_s: int = 90, *, device: Optional[str] = None
) -> Optional[bytes]:
    """在一次性 E2B 沙盒里截图 session_id 对应的已闭环应用主舞台。

    device 是这个应用设计的档位（generated_app.device，"desktop"/"phone"/…）；
    决定截图画幅，见 _shot_canvas。不传按桌面处理。

    返回 PNG bytes；不可用/任一步骤失败 → None（fail-closed，不用本地兜底
    掩盖失败，如实让调用方走 503）。
    """
    if not e2b_screenshot_available():
        return None
    base_url = _public_app_base_url()
    app_url = f"{base_url}/agent-loop/sliderule"
    viewport_w, viewport_h = _shot_canvas(device)

    sandbox = _create_sandbox(timeout_s)
    try:
        if not _ensure_playwright(sandbox, timeout_s):
            return None

        js_code = _SCREENSHOT_JS_TEMPLATE % {
            "session_id_json": json.dumps(session_id),
            "app_url_json": json.dumps(app_url),
            "viewport_w": viewport_w,
            "viewport_h": viewport_h,
        }
        run = sandbox.run_code(
            "open('/tmp/shot.js', 'w').write(" + repr(js_code) + ")\n"
            "import subprocess\n"
            "res = subprocess.run(['node', '/tmp/shot.js'], capture_output=True, text=True, "
            "timeout=40, cwd='/tmp')\n"
            "print('RC:', res.returncode)\n"
            "print(res.stdout)\n"
            "print(res.stderr[-1000:])",
            timeout=timeout_s,
        )
        stdout_text = "\n".join(run.logs.stdout)
        if "SCREENSHOT_OK" not in stdout_text:
            return None

        content = sandbox.files.read("/tmp/app-thumb.png", format="bytes")
        return bytes(content) if content else None
    except Exception:
        return None
    finally:
        try:
            sandbox.kill()
        except Exception:
            pass
