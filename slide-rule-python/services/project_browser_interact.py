"""Closed Playwright actions against a private preview URL.

抄的开源合同，不贴泄漏提示词：

- OpenHands BrowserToolExecutor：typed navigate/click/type → observation
- Playwright public API（Apache-2.0）：page.click / fill / keyboard / mouse / evaluate
- vercel-labs/agent-browser：交互节点带稳定 index，模型先看 snapshot 再点

本模块是叶子：不 import services。调用方先用 leaked_browser_url_allowed
夹住 URL，这里只对已经放行的预览动手。缺 Playwright 就返回
project_browser_driver_unavailable，不许假装点到了。
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

_PLAYWRIGHT_JS = r"""
const fs = require("fs");
// 本机从 stdin 读动作；远程浏览器沙盒里读上传的 job 文件（project_browser_remote，命令行第一个参数）。
const action = JSON.parse(fs.readFileSync(process.argv[2] || 0, "utf8"));
const { chromium } = %(require_playwright)s;
const url = action.url;
const origin = new URL(url).origin;

// ⚠ 2026-09-25 隔离真机 sr-20260925070944-QGT6D76EYV：browser_view 回
//   project_browser_action_failed。真因是本机 Playwright 1.61 要的 chromium 1228 没装
//   （容器里是 1194），浏览器根本没起来——下面那句兜底 catch 把它抹成了「动作失败」。
//   起不来、打不开、被拒，三件事分开报，模型才知道是环境不是代码。
// ⚠ 2026-10-04 真机 @frontend-design 咖啡店落地页（sr-20261004015422-02T1R1SA0W）：同上，容器里
//   Playwright 要的版本又没装（只有 chromium-1194），browser_navigate / browser_view 全回
//   driver_unavailable，模型只好跳过 frontend-design 要求的「截图自查」。9-25 那次只把错报清楚了，
//   没让它能起来。验收那边（server/project-verification/browser-runner.mjs）和整套浏览器测试
//   早就认 SLIDERULE_CHROMIUM_PATH 指一个现成的 Chrome——这里是漏掉的那一处（§四）。
const executablePath = process.env.SLIDERULE_CHROMIUM_PATH || "";
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  } catch (_) {
    throw new Error("project_browser_driver_unavailable");
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // 浏览器控制台与失败的请求：照 microsoft/playwright-mcp（Apache-2.0）的 browser_console_messages /
  // browser_network_requests——打开页面**之前**挂上，加载期间的报错也收得到。只收 error / warning / 未捕获异常
  // 与失败的请求，条数、长度都封顶。地址只留路径（预览主机与 query 里的票据不出去，跟 model_page_path 同一条）。
  const consoleSeen = [];
  const failedSeen = [];
  const counts = { errors: 0, warnings: 0, failedRequests: 0 };
  const where = (raw) => {
    try { const u = new URL(raw); return u.origin === origin ? u.pathname : u.origin + u.pathname; } catch (_) { return ""; }
  };
  const clean = (text) => String(text || "").split(origin).join("")
    .replace(/([?&](?:ticket|token|access_token|auth)=)[^&\s"')]+/gi, "$1[Filtered]").slice(0, 400);
  const keepConsole = (level, text, at) => {
    if (level === "warning") counts.warnings++; else counts.errors++;
    const room = level === "warning" ? consoleSeen.length < 20 && counts.warnings <= 5 : consoleSeen.length < 20;
    if (room) consoleSeen.push({ level, text: clean(text), ...(at ? { at } : {}) });
  };
  const keepFailed = (entry) => { counts.failedRequests++; if (failedSeen.length < 20) failedSeen.push(entry); };
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    const loc = message.location() || {};
    const at = loc.url ? where(loc.url) + (loc.lineNumber != null ? ":" + (loc.lineNumber + 1) : "") : "";
    keepConsole(type, message.text(), at);
  });
  page.on("pageerror", (error) => {
    const stack = String((error && error.stack) || "").split("\n").slice(0, 4).join("\n");
    keepConsole("pageerror", stack || String((error && error.message) || error));
  });
  page.on("requestfailed", (request) => {
    keepFailed({ method: request.method(), path: where(request.url()),
      failure: clean((request.failure() || {}).errorText || "failed") });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      keepFailed({ method: response.request().method(), path: where(response.url()), status: response.status() });
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const now = page.url();
      if (now && !now.startsWith(origin)) {
        throw new Error("project_browser_external_url_forbidden");
      }
    }
  });
  // 远程浏览器沙盒（project_browser_remote）：预览在网关后面，先拿一次性票换 cookie 再进——跟验收
  // browser-runner.mjs 同一套：不跟随跳转，只认 303 → "/"；票据 URL 不打印、不进结果。本机直连不带 entryUrl。
  if (action.entryUrl) {
    let entry;
    try { entry = new URL(action.entryUrl); } catch (_) { throw new Error("project_browser_input_invalid"); }
    if (entry.origin !== origin || entry.pathname !== "/_whybuddy/authorize") throw new Error("project_browser_input_invalid");
    let bootstrap;
    try {
      bootstrap = await page.context().request.get(action.entryUrl, { maxRedirects: 0, timeout: 15000 });
    } catch (_) {
      throw new Error("project_browser_preview_unreachable");
    }
    if (bootstrap.status() !== 303) throw new Error("project_browser_preview_forbidden");
    await bootstrap.dispose();
  }
  let response;
  try {
    response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch (err) {
    if (String(err && err.message || "").startsWith("project_browser_")) throw err;
    throw new Error("project_browser_preview_unreachable");
  }
  if (response && (response.status() === 401 || response.status() === 403)) {
    throw new Error("project_browser_preview_forbidden");
  }
  const nodes = page.locator("a,button,input,select,textarea,[role='button'],[role='link']");
  const count = await nodes.count();
  const pick = async (index) => {
    if (index == null || index < 0 || index >= count) {
      throw new Error("project_browser_target_missing");
    }
    return nodes.nth(index);
  };
  const op = action.op;
  if (op === "click") {
    if (action.x != null && action.y != null) {
      await page.mouse.click(action.x, action.y);
    } else {
      await (await pick(action.index)).click({ timeout: 8000 });
    }
  } else if (op === "type") {
    const target = action.index != null ? await pick(action.index) : page.locator(":focus");
    await target.fill(String(action.text || ""), { timeout: 8000 }).catch(async () => {
      await target.click({ timeout: 8000 });
      await page.keyboard.type(String(action.text || ""), { delay: 10 });
    });
    if (action.pressEnter) await page.keyboard.press("Enter");
  } else if (op === "move") {
    await page.mouse.move(action.x, action.y);
  } else if (op === "key") {
    await page.keyboard.press(String(action.key || ""));
  } else if (op === "select") {
    await (await pick(action.index)).selectOption(String(action.option || ""), { timeout: 8000 });
  } else if (op === "scroll") {
    if (action.toEnd && action.direction === "up") {
      await page.evaluate(() => window.scrollTo(0, 0));
    } else if (action.toEnd) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    } else {
      await page.mouse.wheel(0, action.direction === "up" ? -480 : 480);
    }
  } else if (op === "evaluate") {
    action.evaluated = await page.evaluate(action.javascript);
  } else if (op !== "snapshot") {
    throw new Error("project_browser_action_invalid");
  }
  // 动作之后让异步的报错（fetch 失败、点击后的渲染异常）有机会落进来。
  await page.waitForLoadState("load", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const snapshot = [];
  const n = Math.min(count, 40);
  for (let i = 0; i < n; i++) {
    const handle = nodes.nth(i);
    const tag = (await handle.evaluate((el) => el.tagName || "")).toLowerCase();
    const text = (await handle.innerText().catch(() => "")).trim().slice(0, 80);
    const name = (await handle.getAttribute("aria-label").catch(() => null))
      || (await handle.getAttribute("name").catch(() => null))
      || text;
    snapshot.push({ index: i, tag, name });
  }
  const title = await page.title();
  let screenshot = null;
  try {
    screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  } catch (_) {}
  process.stdout.write(JSON.stringify({
    ok: true,
    op,
    url: page.url(),
    title,
    snapshot,
    evaluated: action.evaluated === undefined ? null : action.evaluated,
    screenshot,
    console: consoleSeen,
    failedRequests: failedSeen,
    counts,
  }));
  await browser.close();
})().catch((err) => {
  const code = String(err && err.message || "").startsWith("project_browser_")
    ? String(err.message)
    : "project_browser_action_failed";
  process.stdout.write(JSON.stringify({ ok: false, error: code }));
  process.exit(1);
});
"""


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def local_playwright_available() -> bool:
    if not shutil.which("node"):
        return False
    return (_repo_root() / "node_modules" / "@playwright" / "test").is_dir()


_CONSOLE_LEVELS = frozenset({"error", "warning", "pageerror"})
#: ⚠ 回喂给模型的工具结果默认只有 4000 字、从尾巴裁（rehearsal_control.bound_tool_result）。
#:   报错条目放在最前（console_first），再封住总量：6 条 × 240 字 + 6 个请求，最坏 ~2000 字，
#:   留一半给页面快照。先给未捕获异常和 error，warning 排最后。
_MAX_CONSOLE_ENTRIES = 6
_MAX_CONSOLE_TEXT = 240
_LEVEL_ORDER = {"pageerror": 0, "error": 1, "warning": 2}
CONSOLE_KEYS = ("consoleCounts", "browserConsole", "failedRequests")


def console_observation(body: dict) -> dict:
    """页面里报了什么错，原样（封顶）交给模型。

    ⚠ 2026-10-08 审查「验收发现页面报错，模型却不知道是什么错」：验收收据按设计只有计数
      （no_page_errors 失败 = 「有报错」，一个字原文都不进证据链，见 browser-runner.mjs 头注），
      而模型唯一叫得出的 browser_console_view 读的是**开发服务器的命令日志**——浏览器里的
      JS 异常、console.error、404 的接口，模型在任何一个工具里都看不到，只能对着代码猜。
      这里是观察，不是证据：它不进验收、不决定交付，跟快照里的按钮文字是同一类东西。

    驱动没报这几项（旧驱动、注入的 interactor）就什么都不加——「不知道」不许写成「没报错」。
    """
    counts = body.get("counts")
    if not isinstance(counts, dict):
        return {}
    entries = []
    for item in body.get("console") or []:
        if isinstance(item, dict) and item.get("level") in _CONSOLE_LEVELS:
            entry = {"level": item["level"], "text": str(item.get("text") or "")[:_MAX_CONSOLE_TEXT]}
            if isinstance(item.get("at"), str) and item["at"]:
                entry["at"] = item["at"][:200]
            entries.append(entry)
    failed = []
    for item in body.get("failedRequests") or []:
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            entry = {"method": str(item.get("method") or "GET")[:10], "path": item["path"][:200]}
            if isinstance(item.get("status"), int):
                entry["status"] = item["status"]
            else:
                entry["failure"] = str(item.get("failure") or "failed")[:120]
            failed.append(entry)
    total = {key: int(counts.get(key) or 0) for key in ("errors", "warnings", "failedRequests")}
    entries.sort(key=lambda entry: _LEVEL_ORDER[entry["level"]])                 # 稳定排序：同级保持先后
    return {"consoleCounts": total, "browserConsole": entries[:_MAX_CONSOLE_ENTRIES],
            "failedRequests": failed[:_MAX_CONSOLE_ENTRIES]}


def console_first(result: dict) -> dict:
    """报错那几项挪到结果最前面：结果超长时是从尾巴裁的，放在快照后面就整段被裁掉。"""
    head = {key: result[key] for key in CONSOLE_KEYS if key in result}
    return {**head, **result} if head else result


def run_browser_action(preview_url: str, action: dict, *, timeout_s: int = 30) -> dict:
    """Drive one closed action. Caller must have allowed the preview URL."""
    if not isinstance(preview_url, str) or not preview_url.strip():
        raise ValueError("project_browser_preview_not_ready")
    if not isinstance(action, dict) or not action.get("op"):
        raise ValueError("project_browser_action_invalid")
    if not local_playwright_available():
        raise ValueError("project_browser_driver_unavailable")
    payload = {**action, "url": preview_url.strip()}
    pkg = str(_repo_root() / "node_modules" / "@playwright" / "test")
    script = browser_action_script(f"require({json.dumps(pkg)})")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "interact.js"
        path.write_text(script, encoding="utf-8")
        try:
            result = subprocess.run(
                ["node", str(path)],
                input=json.dumps(payload, ensure_ascii=False),
                capture_output=True,
                text=True,
                timeout=timeout_s,
                cwd=str(_repo_root()),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError("project_browser_action_failed") from exc
    return decode_browser_action(result.stdout)


def browser_action_script(require_playwright: str) -> str:
    """同一份动作脚本，本机与远程浏览器沙盒共用（§4）：只换「Playwright 从哪儿 require」。"""
    return _PLAYWRIGHT_JS % {"require_playwright": require_playwright}


def decode_browser_action(stdout: str | None) -> dict:
    """脚本吐出的那一行 JSON → 交给模型的观察。本机与远程同一个出口。"""
    try:
        body = json.loads((stdout or "").strip() or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("project_browser_action_failed") from exc
    if not isinstance(body, dict) or body.get("ok") is not True:
        raise ValueError(str(body.get("error") or "project_browser_action_failed")[:240])
    result = {
        "op": body.get("op"),
        "url": body.get("url"),
        "title": body.get("title"),
        "snapshot": body.get("snapshot") or [],
        "evaluated": body.get("evaluated"),
        "interactive": True,
    }
    result.update(console_observation(body))
    raw = body.get("screenshot")
    if isinstance(raw, str) and raw.strip():
        try:
            result["screenshotPng"] = base64.b64decode(raw, validate=False)
        except Exception:
            pass
    return result
