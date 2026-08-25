/**
 * sliderule-canvas-browser-smoke —— 画布档的真机判据。
 *
 * ## 为什么必须是浏览器 smoke，不能只写单测
 *
 * 画布档有一半的行为**在 jsdom 里根本不成立**：
 *
 *   · React Flow 的平移缩放走 d3-zoom，要真实的 wheel/pointer 事件与容器尺寸；
 *   · 画板里是 iframe，srcdoc 在 jsdom 里不加载；
 *   · 而这一档最关键的那条坑——**iframe 会吞掉画布手势**——恰恰只在真浏览器里
 *     才复现得出来（jsdom 没有跨文档事件边界这回事）。
 *
 * 也就是说：光靠单测，"滚轮停在画板上时画布还能不能缩放"这件事**永远测不到**，
 * 而它正是 2026-08-25 那天写歪过两次的地方。判据必须落在用户真正操作的东西上
 * （本仓第五条纪律），所以有了这个文件。
 *
 * ## 它钉住的 8 件事
 *
 *   A 档位偏好记得住（下次开门直接回画布）
 *   B 滚轮停在**画板上**能平移        ← 手势层通电的证据
 *   C ctrl+滚轮停在画板上能缩放        ← 同上
 *   D 画板上按住拖拽 = 平移画布，且画板本身不被拖走
 *   E 双击进板：只撤掉**那一块**的手势层，其余照旧挡着
 *   F Esc 退出，手势层全部回来
 *   G 点缩放读数 = 适应画布
 *   H 「在页面档打开」真的切回单页舞台，且带着选中的那一页
 *
 * ⚠ B/C 曾经"通过"过一次，但那是假的：当时 elementsSelectable={false} 让
 *   React Flow 给节点挂了 pointer-events:none，事件直接落到 pane——
 *   **手势层一个事件都没收到，平移缩放却是好的**。所以 E 那条
 *   （手势层剩 n-1 层）不是锦上添花，它是 B/C 的防伪标记：手势层没通电时
 *   E 必然失败。三条要一起看。
 *
 * ## 用法
 *
 *   pnpm run dev:all                       # 另开一个终端
 *   node scripts/sliderule-canvas-browser-smoke.mjs
 *
 * 需要一个**已经跑完、有成品页面**的会话。默认从 GET /api/sliderule/sessions
 * 里自动挑第一个 has_preview 的；也可以显式指定：
 *
 *   SLIDERULE_CANVAS_SMOKE_SESSION=sr-2026... node scripts/sliderule-canvas-browser-smoke.mjs
 *
 * 需要登录（会话是私有的）。凭据走环境变量，**不写进仓库**：
 *
 *   SLIDERULE_SMOKE_EMAIL=... SLIDERULE_SMOKE_PASSWORD=... node scripts/...
 *
 * 退出码 0 = 8 项全过。任一项失败即非零——画布是增强类（fail-open），
 * 但**判据不 fail-open**：手势层哑掉必须红，不许静静地放过去。
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number.parseInt(process.env.SLIDERULE_SMOKE_PORT ?? "3000", 10);
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = process.env.SLIDERULE_SMOKE_EMAIL ?? "";
const PASSWORD = process.env.SLIDERULE_SMOKE_PASSWORD ?? "";
const WANT_SESSION = process.env.SLIDERULE_CANVAS_SMOKE_SESSION ?? "";
const SHOT_DIR = resolve("tmp", "sliderule-canvas-smoke");
const NAV_TIMEOUT = Number.parseInt(
  process.env.SLIDERULE_SMOKE_NAV_TIMEOUT ?? "60000",
  10
);

function log(msg) {
  process.stdout.write(`[canvas-smoke] ${msg}\n`);
}

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id} ${detail ?? ""}`);
}

/**
 * Chromium 可执行文件。容器里预装在 /opt/pw-browsers（不许再跑
 * `playwright install`），本地开发就用 Playwright 自己找的那份。
 */
function launchOptions() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return {
    args: ["--no-sandbox"],
    ...(explicit ? { executablePath: explicit } : {}),
  };
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 950 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => log(`page error: ${String(e).slice(0, 200)}`));

  try {
    await page.goto(`${BASE}/agent-loop/sliderule`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });

    if (EMAIL && PASSWORD) {
      const status = await page.evaluate(
        async ([email, password]) => {
          const r = await fetch("/api/sliderule/account/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          return r.status;
        },
        [EMAIL, PASSWORD]
      );
      log(`login -> ${status}`);
    } else {
      log(
        "未提供 SLIDERULE_SMOKE_EMAIL/PASSWORD，按匿名可读跑（私有会话会取不到）"
      );
    }

    // 挑一个有成品页面的会话。⚠ 不许随便挑一个：没有页面的会话画布是空态，
    // 8 项里有 6 项无从谈起，那样的"通过"是假的。
    const sid =
      WANT_SESSION ||
      (await page.evaluate(async () => {
        const r = await fetch("/api/sliderule/sessions");
        if (!r.ok) return "";
        const body = await r.json();
        const list = Array.isArray(body?.sessions) ? body.sessions : [];
        return (
          list.find(s => s.has_preview)?.sessionId || list[0]?.sessionId || ""
        );
      }));
    if (!sid)
      throw new Error(
        "拿不到可用会话——先跑一轮推演，或设 SLIDERULE_CANVAS_SMOKE_SESSION"
      );
    log(`session = ${sid}`);

    await page.evaluate(sid => {
      localStorage.setItem("sliderule:active-session-id", sid);
      localStorage.setItem("sliderule:stage-view", "canvas");
    }, sid);
    await page.goto(`${BASE}/agent-loop/sliderule`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });

    // A. 档位偏好记得住：不点按钮就该直接落在画布档。
    await page.waitForSelector('[data-testid="sliderule-canvas-stage"]', {
      timeout: NAV_TIMEOUT,
    });
    const pressed = await page.getAttribute(
      '[data-testid="sliderule-stage-view-canvas"]',
      "aria-pressed"
    );
    check("A 档位偏好记得住", pressed === "true", `aria-pressed=${pressed}`);

    // 等画板挂上真渲染再动手：没挂载的画板是占位块，手势层还在但内容没到，
    // 那时候量 B/C 量的是另一件事。
    await page.waitForFunction(
      () =>
        [
          ...document.querySelectorAll(
            '[data-testid="sliderule-canvas-artboard"]'
          ),
        ].some(b => b.getAttribute("data-mounted") === "1"),
      null,
      { timeout: NAV_TIMEOUT }
    );
    await page.waitForTimeout(3000);

    const boardCount = await page.$$eval(
      '[data-testid="sliderule-canvas-artboard"]',
      els => els.length
    );
    if (boardCount === 0)
      throw new Error("画布上一块画板都没有——这个会话没有成品页面");
    log(`画板 ${boardCount} 块`);

    const viewport = () =>
      page.evaluate(
        () =>
          document.querySelector(".react-flow__viewport")?.style.transform || ""
      );
    const zoomText = () =>
      page.evaluate(() =>
        document
          .querySelector('[data-testid="sliderule-canvas-zoom-readout"]')
          ?.textContent?.trim()
      );
    /**
     * 在**画板与画布可视区的交集**里取一个点。
     *
     * ⚠ 别直接用画板 boundingBox 的中心：前一步缩放/平移之后画板常常有一半
     *   在画布外面，中心点会落到画布之外（真机踩过：D 项因此假红，
     *   elementFromPoint 返回的是 .react-flow__pane 而不是手势层）。
     *   判据自己站错位置，比被测的东西坏了更难查。
     */
    const pointOnBoard = async () => {
      const pt = await page.evaluate(() => {
        const b = document
          .querySelector('[data-testid="sliderule-canvas-artboard"]')
          ?.getBoundingClientRect();
        const host = document
          .querySelector('[data-testid="sliderule-canvas-stage"] .react-flow')
          ?.getBoundingClientRect();
        if (!b || !host) return null;
        const left = Math.max(b.left, host.left);
        const right = Math.min(b.right, host.right);
        const top = Math.max(b.top, host.top);
        const bottom = Math.min(b.bottom, host.bottom);
        if (right - left < 8 || bottom - top < 8) return null;
        return { x: (left + right) / 2, y: (top + bottom) / 2 };
      });
      if (!pt) throw new Error("画板与画布可视区没有交集——判据取不到落点");
      return pt;
    };

    // B. 滚轮停在画板上 → 平移。手势层没通电时 wheel 会被 iframe 吃掉，这里不动。
    const bb = await pointOnBoard();
    const v0 = await viewport();
    await page.mouse.move(bb.x, bb.y);
    await page.mouse.wheel(0, 320);
    await page.waitForTimeout(700);
    const v1 = await viewport();
    check("B 画板上滚轮平移", v0 !== v1, `${v0} -> ${v1}`);

    // C. ctrl+滚轮停在画板上 → 缩放。
    const z0 = await zoomText();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -260);
    await page.keyboard.up("Control");
    await page.waitForTimeout(700);
    const z1 = await zoomText();
    check("C 画板上 ctrl+滚轮缩放", z0 !== z1, `${z0} -> ${z1}`);

    // D. 画板上拖拽 = 平移画布，画板本身不动（nodesDraggable=false 的意义）。
    const v2 = await viewport();
    const node0 = await page.$eval(".react-flow__node", n => n.style.transform);
    const bb2 = await pointOnBoard();
    await page.mouse.move(bb2.x, bb2.y);
    await page.mouse.down();
    await page.mouse.move(bb2.x - 140, bb2.y - 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const v3 = await viewport();
    const node1 = await page.$eval(".react-flow__node", n => n.style.transform);
    check(
      "D 画板上拖拽=平移画布且画板不被拖走",
      v2 !== v3 && node0 === node1,
      `viewport ${v2 !== v3 ? "变了" : "没变"} / node ${node0 === node1 ? "没动" : "被拖走了"}`
    );

    // 先适应画布，把画板放回可视区——否则下面按坐标双击会点在画布空白处。
    await page.click('[data-testid="sliderule-canvas-zoom-readout"]');
    await page.waitForTimeout(900);

    // E. 双击进板：只撤掉这一块的手势层。
    const bb3 = await pointOnBoard();
    await page.mouse.dblclick(bb3.x, bb3.y);
    await page.waitForTimeout(1200);
    const entered = await page.evaluate(() => ({
      entered: document
        .querySelector('[data-testid="sliderule-canvas-stage"]')
        ?.getAttribute("data-entered"),
      shields: document.querySelectorAll(
        '[data-testid="sliderule-canvas-gesture-shield"]'
      ).length,
      boards: document.querySelectorAll(
        '[data-testid="sliderule-canvas-artboard"]'
      ).length,
    }));
    check(
      "E 双击进板且只撤这一块的手势层",
      Boolean(entered.entered) && entered.shields === entered.boards - 1,
      `entered=${entered.entered} 手势层 ${entered.shields}/${entered.boards}`
    );
    await page.screenshot({ path: `${SHOT_DIR}/entered.png` });

    // F. Esc 退出，手势层全部回来。
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    const exited = await page.evaluate(() => ({
      entered: document
        .querySelector('[data-testid="sliderule-canvas-stage"]')
        ?.getAttribute("data-entered"),
      shields: document.querySelectorAll(
        '[data-testid="sliderule-canvas-gesture-shield"]'
      ).length,
    }));
    check(
      "F Esc 退出且手势层全部回来",
      !exited.entered && exited.shields === entered.boards,
      `entered=${exited.entered ?? "null"} 手势层 ${exited.shields}/${entered.boards}`
    );

    // G. 点缩放读数 = 适应画布（所有画板都进视口）。
    await page.click('[data-testid="sliderule-canvas-zoom-readout"]');
    await page.waitForTimeout(900);
    const allVisible = await page.evaluate(() => {
      const host = document
        .querySelector('[data-testid="sliderule-canvas-stage"]')
        ?.querySelector(".react-flow")
        ?.getBoundingClientRect();
      if (!host) return false;
      return [
        ...document.querySelectorAll(
          '[data-testid="sliderule-canvas-artboard"]'
        ),
      ].every(b => {
        const r = b.getBoundingClientRect();
        // 允许 2px 误差：fitView 的 padding 是盒子乘数，边界四舍五入会差个把像素。
        return (
          r.left >= host.left - 2 &&
          r.right <= host.right + 2 &&
          r.top >= host.top - 2 &&
          r.bottom <= host.bottom + 2
        );
      });
    });
    check(
      "G 适应画布后所有画板都在视口内",
      allVisible,
      `zoom=${await zoomText()}`
    );
    await page.screenshot({ path: `${SHOT_DIR}/canvas.png` });

    // H. 在页面档打开 → 切回单页舞台，且带着选中的那一页。
    const openBtn = await page.$(
      '[data-testid="sliderule-canvas-open-in-page"]'
    );
    if (openBtn) {
      await openBtn.click();
      await page.waitForTimeout(1500);
      const handoff = await page.evaluate(() => ({
        spec: !!document.querySelector(
          '[data-testid="sliderule-spec-page-stage"]'
        ),
        canvas: !!document.querySelector(
          '[data-testid="sliderule-canvas-stage"]'
        ),
        active: document
          .querySelector('[data-testid="sliderule-spec-page-stage"]')
          ?.getAttribute("data-active-page"),
      }));
      check(
        "H 在页面档打开并带着选中页",
        handoff.spec && !handoff.canvas && Boolean(handoff.active),
        JSON.stringify(handoff)
      );
    } else {
      check("H 在页面档打开并带着选中页", false, "按钮不在（选中态没建立？）");
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  log(
    `${results.length - failed.length}/${results.length} 通过 · 截图在 ${SHOT_DIR}`
  );
  if (failed.length) {
    log(`失败：${failed.map(f => f.id).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  log(`崩了：${err?.stack || err}`);
  process.exitCode = 1;
});
