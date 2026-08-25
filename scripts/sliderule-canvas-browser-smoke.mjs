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
 * 第二轮（连线 / 属性面板 / 右键菜单 / 素材图）再钉 6 条：
 *
 *   I 连线态下四条边的把手可见
 *   J 从把手拖到另一块画板真的连出一条线    ← 把手有没有被手势层压住的唯一证据
 *   K 连线存了档，刷新之后还在
 *   L 属性面板列出这一页的真实事实（绑定/权限/连线/素材）
 *   M 「写进页面」把页面作用域指令填进输入框，且**没有自动发出去**
 *   N 右键菜单七项齐、且没有「删除」
 *
 * 第四轮（画布档锁死最大化）再钉 5 条：
 *
 *   U 一进画布档对话栏就是折的      ← 首屏真的锁上了的唯一证据
 *   V 最大化钮置灰且说清原因
 *   W 硬点钮 / 分隔条折钮都掰不开
 *   X 切到页面档：锁解开、对话栏回来
 *   Y 切回画布档：重新锁上
 *
 * 第六轮（Ctrl+Click 进元素编辑）再钉 2 条：
 *
 *   AB 按住 Ctrl 滑过只高亮（不选中、不弹面板）
 *   AC Ctrl+单击 → 选中 + 右侧编辑器，且没跳去页面档
 *   AD **框逐像素落在元素上**  ← AC 只证明"有框"，框飘到别处照样绿
 *   AE 面板排成 容器/文字/外观/内容 四段
 *   AF **面板上的数是元素真实的值**  ← 控件排满一屏但全是"默认"也叫丰富
 *
 * ⚠ J 与 I 必须一起看，理由同 B/C 与 E：把手 opacity 是 1（I 绿）不代表它
 *   收得到事件。2026-08-25 真机就是 I 绿 J 红——手势层 `absolute inset-0`
 *   在 DOM 里排在把手后面，同层后来居上，把手看得见按不下去。
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

    /* ------------------------------------ 画布档锁死最大化（第四轮） */

    /*
     * ⚠ 为什么必须真机：单测那 11 条是**剥注释查源码**，只能证明"接线写了"。
     *   锁是不是真的锁得住——按了钮之后对话栏有没有弹回来、切档来回之后
     *   状态对不对——是 react-resizable-panels 的命令式 collapse/expand
     *   跟 React effect 打交道的结果，只有真浏览器算得出来。
     *
     * ⚠ **V 和 U 必须一起看**（跟 I/J、S/T 同一条纪律）。2026-08-25 真机
     *   第一版就是 V 绿 U 红：钮已经置灰（锁的状态是对的）、对话栏却还占着
     *   半屏——兜底 effect 挂在 Provider 上，首屏跑的时候 StudioSplit 还没
     *   挂载、chatRef 是 null，collapse 静静地没执行，之后依赖不再变就没有
     *   第二次。只看 V 会以为功能好了。
     *   把 StudioSplit 里那句 `chatRef.current?.collapse()` 删掉即可复现：
     *   U/W/Y 三条红、V 照样绿。
     */
    const chatWidth = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-panel-id="sliderule-chat"]');
        return el ? Math.round(el.getBoundingClientRect().width) : -1;
      });

    const lockedState = await page.evaluate(() => {
      const btn = document.querySelector(
        '[data-testid="sliderule-layout-maximize"]'
      );
      return {
        found: !!btn,
        disabled: btn ? btn.disabled === true : null,
        title:
          btn?.getAttribute("title") || btn?.getAttribute("aria-label") || "",
      };
    });
    const wCanvas = await chatWidth();
    check(
      "U 画布档一进来对话栏就是折的（舞台最大化）",
      wCanvas === 0,
      `chat=${wCanvas}px`
    );
    check(
      "V 最大化钮置灰且说清原因（不是按了没反应）",
      lockedState.found &&
        lockedState.disabled === true &&
        lockedState.title.includes("画布档"),
      JSON.stringify(lockedState)
    );

    // 强行点它（绕过 disabled）——对话栏不许弹回来
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="sliderule-layout-maximize"]')
        ?.click();
      document
        .querySelector('[data-testid="sliderule-studio-split-toggle-chat"]')
        ?.click();
    });
    await page.waitForTimeout(600);
    const wAfterPoke = await chatWidth();
    check(
      "W 硬点最大化钮 / 分隔条折钮，对话栏仍然不出来",
      wAfterPoke === 0,
      `chat=${wAfterPoke}px`
    );

    // 切到页面档 → 锁解开、对话栏回来；再切回画布 → 重新锁上
    await page.click('[data-testid="sliderule-stage-view-page"]');
    await page.waitForTimeout(800);
    const wPage = await chatWidth();
    const pageBtn = await page.evaluate(
      () =>
        document.querySelector('[data-testid="sliderule-layout-maximize"]')
          ?.disabled === true
    );
    check(
      "X 切到页面档：锁解开、对话栏回来、钮可用",
      wPage > 0 && pageBtn === false,
      `chat=${wPage}px disabled=${pageBtn}`
    );

    await page.click('[data-testid="sliderule-stage-view-canvas"]');
    await page.waitForSelector('[data-testid="sliderule-canvas-stage"]', {
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(800);
    const wBack = await chatWidth();
    check("Y 切回画布档：重新锁上", wBack === 0, `chat=${wBack}px`);

    /* ------------------ Ctrl 悬停高亮 / 点选元素直接改（第六轮） */

    /*
     * ⚠ 单测只能证明"写了 ctrlKey、写了 elementFromPoint"。真正要钉的是
     *   **框画在不在元素上**——画布是缩放过的、高亮层画在 React Flow 节点里，
     *   坐标算错一层框就飘走，源码 grep 一样绿（2026-08-25 真机就是这么抓到
     *   "缩两次"那个 bug 的：元素屏幕 14×5，框画成 4×1）。
     */
    const pickTarget = await page.evaluate(() => {
      const board = document.querySelector(
        '[data-testid="sliderule-canvas-artboard"]'
      );
      const f = board?.querySelector("iframe");
      const d = f?.contentDocument;
      if (!d?.body) return null;
      const cand = [...d.querySelectorAll("button,a,h1,h2,h3,p,span")].filter(
        e =>
          (e.textContent || "").trim().length > 2 &&
          e.getBoundingClientRect().width > 20
      );
      if (!cand.length) return null;
      const el = cand[Math.min(3, cand.length - 1)];
      const r = el.getBoundingClientRect();
      const fb = f.getBoundingClientRect();
      const sx = fb.width / (d.documentElement.clientWidth || f.clientWidth);
      const sy = fb.height / (d.documentElement.clientHeight || f.clientHeight);
      return {
        text: (el.textContent || "").trim().slice(0, 20),
        x: fb.left + (r.left + r.width / 2) * sx,
        y: fb.top + (r.top + r.height / 2) * sy,
        screen: {
          left: Math.round(fb.left + r.left * sx),
          top: Math.round(fb.top + r.top * sy),
          w: Math.round(r.width * sx),
          h: Math.round(r.height * sy),
        },
      };
    });

    if (pickTarget) {
      // 不按 Ctrl 滑过 —— 一个高亮都不该有
      await page.mouse.move(pickTarget.x, pickTarget.y);
      await page.waitForTimeout(400);
      const idle = await page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-testid="sliderule-canvas-element-hover"]'
          ).length
      );

      // 按住 Ctrl 滑过 —— 只高亮，不选中、不弹面板
      await page.keyboard.down("Control");
      await page.mouse.move(pickTarget.x - 40, pickTarget.y);
      await page.waitForTimeout(150);
      await page.mouse.move(pickTarget.x, pickTarget.y);
      await page.waitForTimeout(600);
      const hovering = await page.evaluate(() => ({
        hover: !!document.querySelector(
          '[data-testid="sliderule-canvas-element-hover"]'
        ),
        select: !!document.querySelector(
          '[data-testid="sliderule-canvas-element-select"]'
        ),
        panel: !!document.querySelector(
          '[data-testid="sliderule-canvas-element-panel"]'
        ),
      }));
      check(
        "AB 按住 Ctrl 滑过只高亮：不选中、不弹面板；不按 Ctrl 一点高亮都没有",
        idle === 0 && hovering.hover && !hovering.select && !hovering.panel,
        `不按Ctrl=${idle} ${JSON.stringify(hovering)}`
      );

      // 按下 —— 选中 + 右侧面板，且**留在画布上**
      await page.mouse.click(pickTarget.x, pickTarget.y);
      await page.keyboard.up("Control");
      await page.waitForTimeout(900);
      const picked = await page.evaluate(() => {
        const spot = document.querySelector(
          '[data-testid="sliderule-canvas-element-select"]'
        );
        const r = spot?.getBoundingClientRect();
        return {
          select: !!spot,
          panel: !!document.querySelector(
            '[data-testid="sliderule-canvas-element-panel"]'
          ),
          stillOnCanvas: !!document.querySelector(
            '[data-testid="sliderule-canvas-stage"]'
          ),
          text: document.body.innerText,
          rect: r
            ? {
                left: Math.round(r.left),
                top: Math.round(r.top),
                w: Math.round(r.width),
                h: Math.round(r.height),
              }
            : null,
        };
      });
      check(
        "AC Ctrl+单击 → 选中 + 右侧编辑器，且**没有跳去页面档**",
        picked.select &&
          picked.panel &&
          picked.stillOnCanvas &&
          picked.text.includes(pickTarget.text),
        `select=${picked.select} panel=${picked.panel} onCanvas=${picked.stillOnCanvas}`
      );
      /* ⚠ AC 不够：框画到别处去了，AC 照样绿（有框、有面板、在画布）。
         AD 才是"框在不在元素上"那条闸——允许 1px 取整误差。 */
      const near = (a, b) => Math.abs(a - b) <= 1;
      check(
        "AD 高亮框逐像素落在元素上（不是飘在别处）",
        !!picked.rect &&
          near(picked.rect.left, pickTarget.screen.left) &&
          near(picked.rect.top, pickTarget.screen.top) &&
          near(picked.rect.w, pickTarget.screen.w) &&
          near(picked.rect.h, pickTarget.screen.h),
        `框=${JSON.stringify(picked.rect)} 元素=${JSON.stringify(pickTarget.screen)}`
      );
      await page.screenshot({ path: `${SHOT_DIR}/element-pick.png` });

      /*
       * ⚠ 面板"看着丰富"和"面板上的数是真的"是两件事。第一版只读行内样式，
       *   元素没写过行内样式时每一格都是"默认"——控件排满一屏，一个数都没有。
       *   所以这条判据不看有几个控件，看**读数等不等于元素真实的计算值**。
       */
      const panelTruth = await page.evaluate(() => {
        const board = document.querySelector(
          '[data-testid="sliderule-canvas-artboard"]'
        );
        const f = board?.querySelector("iframe");
        const d = f?.contentDocument;
        const q = id => document.querySelector(`[data-testid="${id}"]`);
        const val = id => q(id)?.value ?? null;
        const sections = [
          ...document.querySelectorAll(
            '[data-testid="sliderule-canvas-element-panel"] h4'
          ),
        ].map(h => h.textContent);
        return {
          sections,
          hasSpacing: !!q("sliderule-canvas-el-spacing"),
          read: {
            width: val("sliderule-canvas-el-width"),
            padTop: val("sliderule-canvas-el-padding-top"),
            radius: val("sliderule-canvas-el-radius"),
            fontsize: val("sliderule-canvas-el-fontsize"),
          },
          docReady: !!d?.body,
        };
      });
      check(
        "AE 面板排成 容器/文字/外观/内容 四段，含内外边距九宫格",
        ["容器", "文字", "外观", "内容"].every(t =>
          panelTruth.sections.includes(t)
        ) && panelTruth.hasSpacing,
        JSON.stringify(panelTruth.sections)
      );
      /* 读数不能全是空——全空说明它又退回"只读行内样式"那版了 */
      const filled = Object.values(panelTruth.read).filter(
        v => v !== null && v !== ""
      ).length;
      check(
        "AF 面板显示的是元素**真实**的值（不是一片默认）",
        filled >= 3,
        `有值的格子 ${filled}/4 · ${JSON.stringify(panelTruth.read)}`
      );

      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    } else {
      log("画板里取不到可点元素，跳过 AB/AC/AD");
    }

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
    /* ---------------- 第二轮：连线 / 属性面板 / 右键菜单 / 素材图 ------- */

    // ⚠ H 刚把舞台切到了**页面档**，画布整个不在了。第二轮的每一条都要先
    //   切回画布——不切的话下面第一条就超时，而报错长得像"画布坏了"，
    //   实际是判据自己站错了地方。
    await page.click('[data-testid="sliderule-stage-view-canvas"]');
    await page.waitForSelector('[data-testid="sliderule-canvas-stage"]', {
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(4000);

    const linkCount = () =>
      page.evaluate(() =>
        Number(
          document
            .querySelector('[data-testid="sliderule-canvas-stage"]')
            ?.getAttribute("data-link-count") || 0
        )
      );

    await page.click('[data-testid="sliderule-canvas-zoom-readout"]');
    await page.waitForTimeout(900);
    const linksBefore = await linkCount();

    // I. 开连线态，四条边的把手都该看得见。
    await page.click('[data-testid="sliderule-canvas-link-toggle"]');
    await page.waitForTimeout(500);
    const handles = await page.evaluate(() => {
      const out = [];
      for (const n of document.querySelectorAll(
        '[data-testid="sliderule-canvas-artboard"]'
      )) {
        const pid = n.getAttribute("data-page-id");
        const sides = ["top", "right", "bottom", "left"].map(sd => {
          const h = n.querySelector(`.react-flow__handle-${sd}`);
          const r = h?.getBoundingClientRect();
          return {
            sd,
            opacity: h ? getComputedStyle(h).opacity : "0",
            pt: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null,
          };
        });
        out.push({ pid, sides });
      }
      return out;
    });
    check(
      "I 连线态下四条边把手可见",
      handles.length > 0 &&
        handles.every(h => h.sides.every(s => s.opacity === "1")),
      `${handles.length} 块画板 × 4 边`
    );

    // J. 从第一块画板的下把手拖到第二块的上把手。
    const src = handles[0]?.sides.find(s => s.sd === "bottom")?.pt;
    const dst = handles[1]?.sides.find(s => s.sd === "top")?.pt;
    if (src && dst) {
      await page.mouse.move(src.x, src.y);
      await page.mouse.down();
      await page.mouse.move((src.x + dst.x) / 2, (src.y + dst.y) / 2, {
        steps: 10,
      });
      await page.mouse.move(dst.x, dst.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
    }
    const linksAfter = await linkCount();
    check(
      "J 从把手拖出一条连线",
      linksAfter === linksBefore + 1,
      `links ${linksBefore} -> ${linksAfter}`
    );

    // K. 存档 + 刷新后还在。
    const stored = await page.evaluate(
      sid => localStorage.getItem(`sliderule:canvas-links:${sid}`),
      sid
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForSelector('[data-testid="sliderule-canvas-stage"]', {
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(6000);
    check(
      "K 连线存档且刷新后还在",
      Boolean(stored) && (await linkCount()) === linksAfter,
      `stored=${stored} 刷新后=${await linkCount()}`
    );

    // L. 属性面板列出这一页的真实事实。
    await page.click('[data-testid="sliderule-canvas-inspector-toggle"]');
    await page.waitForTimeout(500);
    const p2 = await pointOnBoard();
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(900);
    const insp = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="sliderule-canvas-inspector"]'
      );
      return {
        pageId: el?.getAttribute("data-page-id"),
        status: document
          .querySelector('[data-testid="sliderule-canvas-inspector-status"]')
          ?.textContent?.trim(),
        text: el?.textContent?.replace(/\s+/g, " ") ?? "",
      };
    });
    check(
      "L 属性面板列出真实事实",
      Boolean(insp.pageId) &&
        Boolean(insp.status) &&
        insp.text.includes("数据绑定") &&
        insp.text.includes("权限") &&
        insp.text.includes("连线"),
      `${insp.pageId} · ${insp.status}`
    );

    // M. 「写进页面」只填不发。
    const applyBtn = await page.$(
      '[data-testid="sliderule-canvas-link-apply"]'
    );
    if (applyBtn) {
      await applyBtn.click();
      await page.waitForTimeout(900);
      const composed = await page.evaluate(
        () => document.querySelector("textarea")?.value ?? ""
      );
      check(
        "M 连线落回输入框（页面作用域，只填不发）",
        composed.includes("这一页") && /其余|其他/.test(composed),
        composed.slice(0, 70)
      );
    } else {
      check(
        "M 连线落回输入框（页面作用域，只填不发）",
        false,
        "没找到「写进页面」按钮"
      );
    }

    // N. 右键菜单。
    const p3 = await pointOnBoard();
    await page.mouse.click(p3.x, p3.y, { button: "right" });
    await page.waitForTimeout(700);
    const menuItems = await page.evaluate(() => {
      const m = document.querySelector(
        '[data-testid="sliderule-canvas-board-menu"]'
      );
      return m
        ? [...m.querySelectorAll("[role=menuitem]")].map(x =>
            x.textContent.trim()
          )
        : [];
    });
    check(
      "N 右键菜单齐且没有「删除」",
      menuItems.length === 7 && !menuItems.some(t => t.includes("删除")),
      menuItems.join(" / ")
    );
    await page.screenshot({ path: `${SHOT_DIR}/menu.png` });
    await page.keyboard.press("Escape");

    // 素材：如实报数（有就该有节点，没有就该没有开关）。
    const assetInfo = await page.evaluate(() => {
      const st = document.querySelector(
        '[data-testid="sliderule-canvas-stage"]'
      );
      return {
        declared: Number(st?.getAttribute("data-asset-count") || 0),
        nodes: document.querySelectorAll(
          '[data-testid="sliderule-canvas-asset"]'
        ).length,
        toggle: !!document.querySelector(
          '[data-testid="sliderule-canvas-assets-toggle"]'
        ),
      };
    });
    check(
      "O 素材图数量与节点数一致",
      assetInfo.declared === assetInfo.nodes &&
        (assetInfo.declared === 0 || assetInfo.toggle),
      JSON.stringify(assetInfo)
    );

    /* ---------------------------------------------------- 换图（第三轮） */

    /*
     * P/Q/R/S 钉的是"换图"这条链在真浏览器里到底通不通。
     *
     * ⚠ 为什么必须是真机：搜图那一跳要真的打后端（CSP 把 api.openverse.org
     *   挡在 connect-src 之外，所以它必须走 /api/sliderule/stock-images/search
     *   —— 这件事 jsdom 里测不出来，jsdom 根本不执行 CSP）。
     *
     * ⚠ S **只验到候选出现为止，不点下去**——点下去就是真的改用户的应用。
     *   写回那一段由 e2e 脚本在真库上验过（改完立刻还原），不在 smoke 里做
     *   破坏性动作。
     */
    if (assetInfo.declared > 0) {
      const openedPanel = await page.evaluate(() => {
        const btn = document.querySelector(
          '[data-testid="sliderule-canvas-asset-replace-btn"]'
        );
        if (!btn) return "no-button";
        btn.click();
        return "clicked";
      });
      await page.waitForTimeout(500);
      const panel = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="sliderule-asset-replace"]'
        );
        if (!el) return null;
        return {
          groups: Number(el.getAttribute("data-use-groups") || 0),
          url: el.getAttribute("data-asset-url") || "",
          disabled: !!el.querySelector(
            '[data-testid="sliderule-asset-replace-disabled"]'
          ),
          hasSearch: !!el.querySelector(
            '[data-testid="sliderule-asset-search"]'
          ),
          hasPaste: !!el.querySelector('[data-testid="sliderule-asset-paste"]'),
        };
      });
      check(
        "P 素材卡上的「换图」打开了面板",
        openedPanel === "clicked" && !!panel,
        `${openedPanel} ${JSON.stringify(panel)}`
      );
      check(
        "Q 面板同时给了搜图和粘地址两条路",
        !!panel && panel.hasSearch && panel.hasPaste,
        JSON.stringify(panel)
      );

      // 粘一个白名单外的域名 → 必须出现那行黄字警告（不是拦下来，是说清后果）
      const warned = await page.evaluate(() => {
        const input = document.querySelector(
          '[data-testid="sliderule-asset-paste"]'
        );
        if (!input) return "no-input";
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;
        setter.call(input, "https://evil.example.com/a.png");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return "typed";
      });
      await page.waitForTimeout(300);
      const warnVisible = await page.evaluate(
        () =>
          !!document.querySelector(
            '[data-testid="sliderule-asset-host-warning"]'
          )
      );
      check(
        "R 粘白名单外的域名会警告「下一轮精修会被判未授权外链」",
        warned === "typed" && warnVisible,
        `${warned} warn=${warnVisible}`
      );

      // 搜图真的打后端并回结果（或如实说搜不到）——两者都算通，
      // 空手而归**必须**有那块"没搜到"的说明，不许静静地什么都不显示。
      await page.evaluate(() => {
        const input = document.querySelector(
          '[data-testid="sliderule-asset-paste"]'
        );
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value"
          ).set;
          setter.call(input, "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        document
          .querySelector('[data-testid="sliderule-asset-search"]')
          ?.click();
      });
      /*
       * ⚠ 不用定长 sleep：搜图本身要走"逐级退让"，慢的时候接近 10s，
       *   定长等于把判据压在一个随网络漂移的时刻上（第一版就是这么红的，
       *   红的是判据不是功能）。这里轮询到"每个候选格子都有结论"为止，
       *   超时再取一次现场——那时的红才是真的红。
       */
      await page
        .waitForFunction(
          () => {
            const box = document.querySelector(
              '[data-testid="sliderule-asset-candidates"]'
            );
            const empty = document.querySelector(
              '[data-testid="sliderule-asset-search-empty"]'
            );
            const err = document.querySelector(
              '[data-testid="sliderule-asset-replace-error"]'
            );
            if (empty || err) return true;
            if (!box) return false;
            const tiles = [...box.querySelectorAll("li")];
            if (!tiles.length) return false;
            return tiles.every(
              li =>
                li.textContent.includes("加载不出来") ||
                [...li.querySelectorAll("img")].some(i => i.naturalWidth > 0)
            );
          },
          { timeout: 60000 }
        )
        .catch(() => {});
      const searched = await page.evaluate(() => ({
        candidates: document.querySelectorAll(
          '[data-testid="sliderule-asset-candidates"] img'
        ).length,
        // 真的渲染出像素的有几张（naturalWidth>0）。灰方块在这里会露馅。
        rendered: [
          ...document.querySelectorAll(
            '[data-testid="sliderule-asset-candidates"] img'
          ),
        ].filter(i => i.naturalWidth > 0).length,
        // 明确显示"加载不出来"的格子数
        brokenShown: [
          ...document.querySelectorAll(
            '[data-testid="sliderule-asset-candidates"] li'
          ),
        ].filter(li => li.textContent.includes("加载不出来")).length,
        tiles: document.querySelectorAll(
          '[data-testid="sliderule-asset-candidates"] li'
        ).length,
        empty: !!document.querySelector(
          '[data-testid="sliderule-asset-search-empty"]'
        ),
        error: (
          document.querySelector(
            '[data-testid="sliderule-asset-replace-error"]'
          )?.textContent || ""
        ).trim(),
      }));
      check(
        "S 搜图有结果，或如实说没搜到（不许静静地空着）",
        searched.tiles > 0 || searched.empty,
        JSON.stringify(searched)
      );
      /*
       * T 是 S 的防伪标记：S 只证明"有候选格子"，一排灰方块照样让它变绿。
       * 候选是拿来**看着挑**的，看不见就等于没有。
       *
       * 判据钉的是"每个格子都有结论"——要么真渲染出像素，要么明说加载不出来。
       * 两条都不满足 = 灰方块挂着，那才是坏的。
       *
       * ⚠ 这个开发容器里浏览器**出不去外网**（live.staticflickr.com 与
       *   fonts.googleapis.com 一样 ERR_CONNECTION_RESET；curl 能出去是因为
       *   它信任容器的 CA，Chromium 不信）。所以这里走的通常是"加载不出来"
       *   那条——那正是降级该有的样子，不是判据放水。真实用户机器上走的是
       *   rendered 那条。
       */
      check(
        "T 每个候选格子都有结论（渲染出来 或 明说加载不出来）",
        searched.tiles === 0 ||
          searched.rendered + searched.brokenShown === searched.tiles,
        JSON.stringify(searched)
      );
      await page.screenshot({ path: `${SHOT_DIR}/asset-replace.png` });
    } else {
      log("素材 0 张，跳过 P/Q/R/S（这个会话的应用没有 <img>）");
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
