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

_SCREENSHOT_JS_TEMPLATE = """
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.addInitScript((sid) => {
      try { localStorage.setItem("sliderule:active-session-id", sid); } catch {}
    }, %(session_id_json)s);
    await page.goto(%(app_url_json)s, { waitUntil: "domcontentloaded", timeout: 25000 });
    try {
      await page.waitForSelector('[data-testid="app-runtime-screen"]', { timeout: 12000 });
    } catch {}
    const appEl = await page.$('[data-testid="app-runtime-screen"]');
    if (appEl) {
      await appEl.screenshot({ path: "/tmp/app-thumb.png" });
    } else {
      await page.screenshot({ path: "/tmp/app-thumb.png", clip: { x: 0, y: 0, width: 900, height: 520 } });
    }
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


def capture_app_screenshot(session_id: str, timeout_s: int = 90) -> Optional[bytes]:
    """在一次性 E2B 沙盒里截图 session_id 对应的已闭环应用主舞台。

    返回 PNG bytes；不可用/任一步骤失败 → None（fail-closed，不用本地兜底
    掩盖失败，如实让调用方走 503）。
    """
    if not e2b_screenshot_available():
        return None
    base_url = _public_app_base_url()
    app_url = f"{base_url}/agent-loop/sliderule"

    from e2b_code_interpreter import Sandbox

    sandbox = Sandbox.create(timeout=timeout_s + 30)
    try:
        install = sandbox.run_code(
            "import subprocess, json\n"
            f"r1 = subprocess.run(['npm','install','playwright@{_PLAYWRIGHT_VERSION}'], "
            "capture_output=True, text=True, timeout=90, cwd='/tmp')\n"
            "r2 = subprocess.run(['npx','playwright','install','--with-deps','chromium'], "
            "capture_output=True, text=True, timeout=150, cwd='/tmp')\n"
            "print(json.dumps({'install_rc': r1.returncode, 'browser_rc': r2.returncode}))",
            timeout=timeout_s,
        )
        if install.error is not None:
            return None

        js_code = _SCREENSHOT_JS_TEMPLATE % {
            "session_id_json": json.dumps(session_id),
            "app_url_json": json.dumps(app_url),
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
