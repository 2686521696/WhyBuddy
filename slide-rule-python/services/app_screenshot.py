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


def _screenshot_device_config(device: str) -> dict:
    if device == "phone":
        return {
            "device": "phone",
            "viewport": (430, 932),
            "target": '[data-testid="app-shell-phone"]',
        }
    return {
        "device": "desktop",
        "viewport": (1440, 1000),
        "target": '[data-testid="app-shell-side"], [data-testid="app-shell-top"]',
    }


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

_LAUNCH_CHROMIUM_JS = """
// 启动 Chromium：先按 Playwright 自己的解析来，失败了再去找环境里**真实存在**
// 的那个二进制（2026-08-12）。
//
// ## 为什么需要这一层
//
// 真跑一趟健身房话题时，自检截图整段哑火：
//     browserType.launch: Executable doesn't exist at
//     /opt/pw-browsers/chromium_headless_shell-1228/.../chrome-headless-shell
// 而环境里烤好的是 **1194**。项目钉的 @playwright/test 1.61.1 要 1228，对不上。
// 后果不只是"没截到图"——`block.screenshot got=0` 之后，下一步的
// `block.critique`（拿截图跟参照图比、自己改一版）**整段不执行**，白等 49.9s，
// 而那正是"生成→截图→自己看→改"闭环里的"看"这一步。
//
// ## 为什么是显式 executablePath
//
// Playwright **没有**自动回退：钉的 revision 不在就直接抛。预装浏览器的标准
// 做法就是显式传 executablePath——Puppeteer 干脆把它做成一等公民环境变量
// `PUPPETEER_EXECUTABLE_PATH`，这里照抄那个形状（一个自己的 env 覆盖 +
// 在 PLAYWRIGHT_BROWSERS_PATH 下按目录名找）。
//
// ## 边界：默认路径能起就绝不插手
//
// 先原样 launch 一次，成功就走人；只有抛错才去找。所以 E2B 沙盒那条路
// （现装 playwright，钉的 revision 必然在）逐字节不受影响。
// 一个候选都起不来时抛回**原始错误**——不能用"找不到浏览器"盖掉真正的原因。
function resolveChromiumCandidates() {
  const fs = require("fs");
  const path = require("path");
  const out = [];
  const override = process.env.SLIDERULE_CHROMIUM_EXECUTABLE_PATH;
  if (override) out.push(override);
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && fs.existsSync(root)) {
    for (const dir of fs.readdirSync(root)) {
      if (!dir.startsWith("chromium")) continue;
      for (const rel of [
        ["chrome-linux", "chrome"],
        ["chrome-linux", "chrome-headless-shell"],
        ["chrome-headless-shell-linux64", "chrome-headless-shell"],
      ]) {
        const p = path.join(root, dir, ...rel);
        if (fs.existsSync(p)) out.push(p);
      }
    }
  }
  return out;
}

async function launchChromium(chromium, options) {
  try {
    return await chromium.launch(options);
  } catch (err) {
    for (const executablePath of resolveChromiumCandidates()) {
      try {
        const browser = await chromium.launch({ ...options, executablePath });
        console.error("[screenshot] fell back to " + executablePath);
        return browser;
      } catch {
        // 这个候选也起不来，试下一个
      }
    }
    throw err;
  }
}
"""


_SCREENSHOT_JS_TEMPLATE = _LAUNCH_CHROMIUM_JS + """
const { chromium } = %(require_playwright)s;
(async () => {
  const browser = await launchChromium(chromium, { headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: %(viewport_width)d, height: %(viewport_height)d }
    });
    const page = await ctx.newPage();
    const device = %(device_json)s;
    const targetSelector = %(target_selector_json)s;
    await page.addInitScript((sid) => {
      try { localStorage.setItem("sliderule:active-session-id", sid); } catch {}
    }, %(session_id_json)s);
    await page.goto(%(app_url_json)s, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForSelector(
      '[data-testid="app-runtime-screen"]',
      { timeout: 60000 }
    );
    await page.waitForSelector(
      '[data-testid="sliderule-hydration-spin"]',
      { state: "hidden", timeout: 60000 }
    );
    if (device === "phone") {
      const phoneButton = page.locator('[data-testid="app-device-phone"]');
      await phoneButton.waitFor({ state: "visible", timeout: 15000 });
      await phoneButton.click();
    }
    const target = page.locator(targetSelector);
    await target.waitFor({ state: "visible", timeout: 15000 });
    await target.evaluate(async (root) => {
      const images = Array.from(root.querySelectorAll("img"));
      await Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          setTimeout(done, 15000);
        });
      }));
    });
    await target.screenshot({ path: %(shot_path_json)s });
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


# 本机与 E2B 两条路共用这一份，只有 require 的包名和落盘路径不同：
# 本机用仓库里的 @playwright/test，沙盒里用现装的 playwright。共用是为了保证
# 两条路截出来的东西一致——否则「本地看着没问题、线上换 E2B 就不一样」这种
# 差异极难查。
_FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE = _LAUNCH_CHROMIUM_JS + """
const { chromium } = %(require_playwright)s;
(async () => {
  const browser = await launchChromium(chromium, { headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const page = await ctx.newPage();
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (
        url.startsWith("https://fonts.googleapis.com/") ||
        url.startsWith("https://fonts.gstatic.com/")
      ) {
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(%(preview_url_json)s, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForSelector('[data-testid="freeform-preview-root"]', { timeout: 15000 });
    // HTML 载体是懒加载的（它拖着 DOMPurify），而且内容挂在**影子根**里。
    // 只等外层那个 root 的话，很可能截到 Suspense 那个空占位——评审于是对着
    // 一个空盒子说"太空了"，整轮自检变成噪音。这里等影子根真有东西再往下走。
    // 受限树那条路没有这个节点，谓词直接返回 true，行为一字不变。
    await page.waitForFunction(() => {
      const surface = document.querySelector('[data-testid="overview-html-surface"]');
      if (!surface) return true;
      const host = surface.querySelector("div");
      return !!(host && host.shadowRoot && host.shadowRoot.childElementCount > 1);
    }, { timeout: 10000 }).catch(() => {});
    // 给图表/图标这些懒加载 chunk 一点时间稳定下来，避免截到半渲染的过渡态。
    await page.waitForTimeout(1500);
    const el = await page.$('[data-testid="freeform-preview-root"]');
    await el.screenshot({ path: %(shot_path_json)s });
    // 浏览器已经打开、页面已经渲染好——顺手跑一遍 axe-core，几乎零额外开销。
    // 对比度/文字可读性这类**能算准的**别去问 LLM：UICrit（UIST'24）实测
    // zero-shot 让模型自由评审 UI，只有 13.1%% 的意见有效；axe 这边是
    // deterministic、官方口径「no false positives」。两者分工，不重叠。
    const axePath = %(axe_path_json)s;
    if (axePath) {
      try {
        await page.addScriptTag({ path: axePath });
        const axeResult = await page.evaluate(async () => await window.axe.run(
          document.querySelector('[data-testid="freeform-preview-root"]'),
          { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, resultTypes: ["violations"] },
        ));
        const slim = (axeResult.violations || []).map((v) => ({
          id: v.id, impact: v.impact, help: v.help,
          count: (v.nodes || []).length,
          sample: (v.nodes || []).slice(0, 3).map((n) => (n.failureSummary || "").slice(0, 200)),
        }));
        require("fs").writeFileSync(%(axe_out_json)s, JSON.stringify(slim));
        console.log("AXE_OK:" + slim.length);
      } catch (e) {
        // 扫描是增强项，扫不动不能影响已经拿到手的截图
        console.log("AXE_SKIP:" + (e && e.message ? e.message.slice(0, 120) : "unknown"));
      }
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


_LOCAL_APP_URL_ENV = "SLIDERULE_LOCAL_APP_URL"
_DEFAULT_LOCAL_APP_URL = "http://localhost:3000"

# 最近一次本机截图时顺带跑出来的 axe-core 违规（供 critique 取用）。
# 单进程内单次生成串行执行，用模块级变量足够——跟 _llm_generate_diagnostic
# 同一套做法。E2B 路径不产出这个，取到空列表即可。
_last_axe_violations: list = []


def last_axe_violations() -> list:
    """最近一次截图扫出来的确定性可访问性违规（对比度/文字可读性等）。

    这些是 axe-core 算出来的**硬事实**（官方口径 no false positives），
    跟 LLM 的主观判断不是一回事——喂给 critique 时要分开讲清楚，
    否则模型会把两者混为一谈、拿不准哪些必须改。
    """
    return list(_last_axe_violations)


def _local_app_base_url() -> str:
    """本机可达的应用地址。跟 E2B 那条路最大的区别就在这——本地浏览器就在
    同一台机器上，localhost 直接够得着，不需要公网域名。"""
    return (os.getenv(_LOCAL_APP_URL_ENV) or _DEFAULT_LOCAL_APP_URL).strip().rstrip("/")


def _repo_root():
    from pathlib import Path

    # services/app_screenshot.py → services → slide-rule-python → 仓库根
    return Path(__file__).resolve().parents[2]


def local_screenshot_available() -> bool:
    """本机能不能直接截图：有 node、有装好的 @playwright/test。

    浏览器二进制本身交给 Playwright 自己找（PLAYWRIGHT_BROWSERS_PATH），
    这里只判包在不在——判太细反而容易把能跑的环境误判成不能跑。
    """
    import shutil

    if not shutil.which("node"):
        return False
    return (_repo_root() / "node_modules" / "@playwright" / "test").is_dir()


def local_app_reachable(timeout_s: float = 3.0) -> bool:
    """本机那个应用地址现在够不着吗（2026-08-12）。

    `local_screenshot_available()` 只判 node 和 playwright 在不在，**不判应用起没起**。
    以前这不要紧：受限树那条自检要先有参考图，等于从来不跑。HTML 载体的自检不挂在
    参考图上、每次生成都会走一遍——应用不在 localhost:3000 的环境里，那就是每次
    白等一个 Playwright 超时（上限 60s）才拿到 None。

    所以先敲一下门。只把"连不上/超时"当不可达；HTTP 几百几十都算可达（预览页对
    不存在的 pid 本来就回 404，那不代表宿主没起）。

    ⚠ 敲的是**预览载荷那条 API**，不是站点根路径。2026-08-12 实测过这个区别的代价：
    前端（vite :3000）活着、后端（:9700）死了，敲根路径一路绿灯，然后照样白等了
    67s 的 Playwright 超时才拿到 None。浏览器要走的是「页面 → /api/…/freeform-preview
    /<pid>」这条链，探针就该探同一条链——只探一半等于没探。
    """
    import urllib.error
    import urllib.request

    # 随便一个不存在的 pid：活着的宿主会如实回 404，那正是"够得着"的证明。
    url = f"{_local_app_base_url()}/api/sliderule/freeform-preview/__reachability_probe__"
    try:
        urllib.request.urlopen(url, timeout=timeout_s).close()
        return True
    except urllib.error.HTTPError:
        return True  # 有人应答，只是这个路径不给 200
    except Exception:
        return False


def app_screenshot_available() -> bool:
    """Return whether a full application screenshot can run locally or in E2B."""
    return local_screenshot_available() or e2b_screenshot_available()


def capture_app_screenshot_local(
    session_id: str, timeout_s: int = 60, device: str = "desktop"
) -> Optional[bytes]:
    """Capture the current local frontend so dev screenshots match the checked-out code."""
    if not local_screenshot_available():
        return None

    import subprocess
    import tempfile
    from pathlib import Path

    app_url = f"{_local_app_base_url()}/agent-loop/sliderule"
    pkg_path = str(_repo_root() / "node_modules" / "@playwright" / "test")
    device_config = _screenshot_device_config(device)
    viewport_width, viewport_height = device_config["viewport"]
    with tempfile.TemporaryDirectory() as tmp:
        shot_path = Path(tmp) / "app-thumb.png"
        js = _SCREENSHOT_JS_TEMPLATE % {
            "require_playwright": f"require({json.dumps(pkg_path)})",
            "session_id_json": json.dumps(session_id),
            "app_url_json": json.dumps(app_url),
            "shot_path_json": json.dumps(str(shot_path)),
            "device_json": json.dumps(device_config["device"]),
            "target_selector_json": json.dumps(device_config["target"]),
            "viewport_width": viewport_width,
            "viewport_height": viewport_height,
        }
        js_path = Path(tmp) / "shot.js"
        js_path.write_text(js, encoding="utf-8")
        try:
            res = subprocess.run(
                ["node", str(js_path)],
                capture_output=True,
                text=True,
                timeout=timeout_s,
                cwd=str(_repo_root()),
            )
        except Exception:
            return None
        if "SCREENSHOT_OK" not in (res.stdout or "") or not shot_path.exists():
            detail = (res.stderr or res.stdout or "").strip().replace("\n", " ")
            print(f"[app_screenshot] local app screenshot failed: {detail[:200]}")
            return None
        try:
            return shot_path.read_bytes() or None
        except OSError:
            return None


def capture_freeform_preview_screenshot_local(
    preview_id: str, timeout_s: int = 60
) -> Optional[bytes]:
    """本机 Playwright 截预览页（2026-08-04）。

    ## 为什么加这条

    E2B 那条路要 ①E2B_API_KEY ②SLIDERULE_PUBLIC_APP_URL 公网域名
    ③每次现装 playwright+chromium（两个 subprocess，超时上限 90s+150s）。
    三个条件缺一不可，其中公网域名在本地开发根本没有——实测日志里
    `block.screenshot got=0`，这个自我校验闭环**从上线起一次都没跑过**。

    本机这条路把三个条件全省了：浏览器就在同一台机器上，localhost 直接够得
    着。同仓 client/src/lib/thumb-capture.ts 早就写明了这个道理——服务端起
    无头浏览器"要背上沙盒/容器/浏览器安装那一整套运维面"，能不背就别背。

    截图脚本与 E2B 路径共用同一份模板（唯一差别是 require 的包名：本地是
    仓库里的 @playwright/test，沙盒里是现装的 playwright），保证两条路截出
    来的东西一致。

    fail-closed 同 E2B 路径：任何一步不成返回 None，调用方当"这步跳过"。
    """
    if not local_screenshot_available():
        return None

    import subprocess
    import tempfile
    from pathlib import Path

    preview_url = f"{_local_app_base_url()}/sliderule/freeform-preview/{preview_id}"
    # CommonJS 的 require 是按**脚本自己所在目录**逐级往上找 node_modules 的，
    # 跟 cwd 无关。脚本写在临时目录里，所以这里给绝对路径——否则永远
    # MODULE_NOT_FOUND（实测踩过）。
    pkg_path = str(_repo_root() / "node_modules" / "@playwright" / "test")
    axe_path = _repo_root() / "node_modules" / "axe-core" / "axe.min.js"
    with tempfile.TemporaryDirectory() as tmp:
        shot_path = Path(tmp) / "freeform-preview.png"
        axe_out = Path(tmp) / "axe.json"
        js = _FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE % {
            "require_playwright": f"require({json.dumps(pkg_path)})",
            "preview_url_json": json.dumps(preview_url),
            "shot_path_json": json.dumps(str(shot_path)),
            "axe_path_json": json.dumps(str(axe_path) if axe_path.is_file() else ""),
            "axe_out_json": json.dumps(str(axe_out)),
        }
        js_path = Path(tmp) / "shot.js"
        js_path.write_text(js, encoding="utf-8")
        try:
            res = subprocess.run(
                ["node", str(js_path)],
                capture_output=True,
                text=True,
                timeout=timeout_s,
                cwd=str(_repo_root()),
            )
        except Exception:
            return None
        if "SCREENSHOT_OK" not in (res.stdout or ""):
            # 失败原因留痕：此前这一步静默返回 None，日志里只有 got=0，
            # 排查时完全不知道是没装浏览器、页面没起来还是选择器没匹配上。
            detail = (res.stderr or res.stdout or "").strip().replace("\n", " ")
            print(f"[app_screenshot] 本机截图未成: {detail[:200]}")
        if "SCREENSHOT_OK" not in (res.stdout or "") or not shot_path.exists():
            return None
        # axe 扫描结果挂到模块级，供 critique 取用。扫不到就是空——它是增强项，
        # 缺了 critique 照常跑，只是少一份确定性证据打底。
        global _last_axe_violations
        _last_axe_violations = []
        if axe_out.exists():
            try:
                loaded = json.loads(axe_out.read_text(encoding="utf-8"))
                if isinstance(loaded, list):
                    _last_axe_violations = loaded
            except (OSError, ValueError):
                pass
        try:
            return shot_path.read_bytes() or None
        except OSError:
            return None


def capture_freeform_preview_screenshot(preview_id: str, timeout_s: int = 90) -> Optional[bytes]:
    """FreeformInsight 自我校验闭环用：截一份还没写入任何 session 的候选内容
    （generate_freeform_block 生成中途调用）。

    **先试本机**（不需要公网域名/E2B/现装浏览器，见
    capture_freeform_preview_screenshot_local），本机不可用再走 E2B 沙盒。
    顺序不能反：E2B 那条每次要现装 playwright+chromium，本机零安装开销。

    跟 capture_app_screenshot 同一套 fail-closed 语义，区别只是目标 URL
    ——这里打的是隔离预览页（/sliderule/freeform-preview/:pid），不是某个
    真实 session 的完整应用。
    """
    local = capture_freeform_preview_screenshot_local(preview_id, timeout_s=min(timeout_s, 60))
    if local:
        return local

    if not e2b_screenshot_available():
        return None
    base_url = _public_app_base_url()
    preview_url = f"{base_url}/sliderule/freeform-preview/{preview_id}"

    sandbox = _create_sandbox(timeout_s)
    try:
        if not _ensure_playwright(sandbox, timeout_s):
            return None

        js_code = _FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE % {
            "require_playwright": 'require("playwright")',  # 沙盒里现装的那个
            "preview_url_json": json.dumps(preview_url),
            "shot_path_json": json.dumps("/tmp/freeform-preview.png"),
            "axe_path_json": json.dumps(""),
            "axe_out_json": json.dumps("/tmp/axe.json"),
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
    session_id: str, timeout_s: int = 90, device: str = "desktop"
) -> Optional[bytes]:
    """截图 session_id 对应的已闭环应用主舞台。

    开发环境优先使用本机正在运行的前端，避免旧公网部署生成过期画面；本机
    不可用或截图失败时回退 E2B。两条路径都失败才返回 None（fail-closed）。
    """
    device_config = _screenshot_device_config(device)
    if local_screenshot_available():
        return capture_app_screenshot_local(
            session_id,
            timeout_s=min(timeout_s, 90),
            device=device_config["device"],
        )

    if not e2b_screenshot_available():
        return None
    base_url = _public_app_base_url()
    app_url = f"{base_url}/agent-loop/sliderule"

    sandbox = _create_sandbox(timeout_s)
    try:
        if not _ensure_playwright(sandbox, timeout_s):
            return None

        js_code = _SCREENSHOT_JS_TEMPLATE % {
            "require_playwright": 'require("playwright")',
            "session_id_json": json.dumps(session_id),
            "app_url_json": json.dumps(app_url),
            "shot_path_json": json.dumps("/tmp/app-thumb.png"),
            "device_json": json.dumps(device_config["device"]),
            "target_selector_json": json.dumps(device_config["target"]),
            "viewport_width": device_config["viewport"][0],
            "viewport_height": device_config["viewport"][1],
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
