/**
 * 「技能 · 连接器 · 伙伴」的真机烟测。
 *
 * 为什么单独一支而不是塞进画布那支：这条链跟画布**没有任何共享状态**，
 * 而画布那支已经 39 条、跑一趟要一分多钟。分开之后改哪条跑哪条。
 *
 *   A  输入框打 `/` 弹出能力面板，连接器/技能/伙伴都在
 *   A2 网址里的斜杠**不弹**            ← 跟 A 是一对，错弹会吃掉方向键和回车
 *   A3 真鼠标点得中条目               ← 键盘不做命中测试，这条才照得出 pointer-events
 *   B  打字能筛，回车选中后正文里不留 `/词`（能力是芯片不是正文）
 *   B2 `/` 选伙伴只挂标签，不往正文灌起手意图 ← 跟 G 是一对，说清区别
 *   C  标签能一个个摘掉；C2 正文空着时退格摘最后一枚
 *   H  侧栏分组 + 选中项没有左竖条；H2 假箭头不许有；H3 子项真的切得动页面
 *   D  「技能 · 连接器 · 伙伴」页三层都在
 *   E0 卡片墙只列后端真有的连接器；E3 「+/已添加」真的挂到这一轮
 *   E  连接器页「试取真数据」拿回的是**真值**，不是示例
 *   E2 认不出的城市如实报错，且**一行都不显示**  ← 跟 E 是一对
 *   F  伙伴依赖齐时可用、缺依赖时按钮禁用并说明缺什么
 *   G  「用这个伙伴」把能力挂上并跳回推演、起手意图填进输入框
 *
 * ⚠ 判据全部落在**用户看得见的东西**上（弹没弹、正文里还有没有斜杠、
 *   表格里那个数字是不是真的），不量内部状态。
 */

import { chromium } from "playwright";

const BASE = process.env.SLIDERULE_SMOKE_BASE || "http://localhost:3000";
const EMAIL = process.env.SLIDERULE_SMOKE_EMAIL || "";
const PASSWORD = process.env.SLIDERULE_SMOKE_PASSWORD || "";

const results = [];
const log = (...a) => console.log("[capability-smoke]", ...a);
function check(id, ok, detail) {
  results.push({ id, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id} ${detail ?? ""}`);
}

function launchOptions() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return {
    args: ["--no-sandbox"],
    ...(explicit ? { executablePath: explicit } : {}),
  };
}

const TA = '[data-testid="sliderule-composer-input"]';

async function main() {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => log("[pageerror]", String(e).slice(0, 200)));

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
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
      log("login ->", status);
    } else {
      log("未提供 SLIDERULE_SMOKE_EMAIL/PASSWORD，按匿名可读跑");
    }
    await page.evaluate(() => {
      ["sliderule:turn-capabilities", "sliderule:pending-opener"].forEach(k =>
        localStorage.removeItem(k)
      );
    });

    /* ── A / A2：`/` 弹不弹，是一对 ───────────────────────────────── */
    await page.goto(`${BASE}/agent-loop/sliderule`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(TA, { timeout: 60000 });
    await page.waitForTimeout(2500);

    await page.click(TA);
    await page.type(TA, "/", { delay: 60 });
    await page.waitForTimeout(700);
    const kinds = await page.$$eval('[data-testid="sliderule-slash-item"]', els =>
      els.map(e => e.getAttribute("data-kind"))
    );
    check(
      "A 输入框打 / 弹出能力面板（连接器 + 伙伴都在）",
      kinds.length > 0 && kinds.includes("connector") && kinds.includes("partner"),
      `${kinds.length} 项：${JSON.stringify([...new Set(kinds)])}`
    );

    await page.fill(TA, "");
    await page.type(TA, "参考 https://miantuan.ai 这个站", { delay: 15 });
    await page.waitForTimeout(500);
    const urlOpened = (await page.$('[data-testid="sliderule-slash-menu"]')) !== null;
    /* ⚠ 只看 A 会漏掉"到处都弹"：网址、日期、and/or 里的斜杠一样会命中，
       而错弹比不弹烦人得多——面板一开就把方向键和回车吃掉了。 */
    check("A2 网址里的斜杠不弹面板", !urlOpened, `弹了吗=${urlOpened}`);

    /* ── B / C：筛、选、摘 ───────────────────────────────────────── */
    /*
     * A3：**用真鼠标点一条**。
     *
     * ⚠ 2026-08-26 用户报"选了之后框里啥也没有"，根因是面板落在
     *   ComposerDock 最外层的 `pointer-events-none` 里、从没 opt-in 回来：
     *   面板画得好好的、看得见，elementsFromPoint 在它正中却拿不到它，
     *   鼠标点穿过去落在消息气泡上。而**当时所有判据都是键盘选的**，
     *   键盘不做命中测试，于是全绿。
     *   这一条专治那个盲区——它跟画布「换图」那次是同一个形状。
     */
    await page.fill(TA, "");
    await page.type(TA, "/", { delay: 60 });
    await page.waitForTimeout(700);
    const row = page.locator('[data-testid="sliderule-slash-item"]').first();
    const rb = await row.boundingBox();
    const hit = rb
      ? await page.evaluate(
          ([x, y]) =>
            document
              .elementFromPoint(x, y)
              ?.closest('[data-testid="sliderule-slash-item"]')
              ?.getAttribute("data-key") ?? null,
          [rb.x + rb.width / 2, rb.y + rb.height / 2]
        )
      : null;
    if (rb) {
      await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(700);
    }
    const mouseTags = await page.$$eval(
      '[data-testid="sliderule-capability-chip"]',
      els => els.map(e => e.getAttribute("data-key"))
    );
    check(
      "A3 真鼠标点得中面板条目（不是只有键盘选得中）",
      !!hit && mouseTags.length > 0,
      `条目中心点上是 ${hit ?? "别的东西——面板被 pointer-events 吃了"} · 挂上 ${JSON.stringify(mouseTags)}`
    );
    for (const k of mouseTags) {
      await page
        .locator(`[data-testid="sliderule-capability-chip"][data-key="${k}"] button`)
        .click()
        .catch(() => {});
    }
    await page.waitForTimeout(300);

    await page.fill(TA, "");
    await page.type(TA, "/股", { delay: 60 });
    await page.waitForTimeout(600);
    const filtered = await page.$$eval('[data-testid="sliderule-slash-item"]', els =>
      els.map(e => e.getAttribute("data-key"))
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const textAfter = await page.inputValue(TA);
    const chips = await page.$$eval('[data-testid="sliderule-capability-chip"]', els =>
      els.map(e => e.getAttribute("data-key"))
    );
    check(
      "B 打字能筛，回车选中后正文里不留 `/词`（能力是芯片不是正文）",
      filtered.includes("stock") &&
        chips.includes("stock") &&
        !textAfter.includes("/") &&
        !textAfter.includes("股"),
      `筛出 ${JSON.stringify(filtered)} · 芯片 ${JSON.stringify(chips)} · 正文 ${JSON.stringify(textAfter)}`
    );

    /*
     * B2：`/` 选完之后，输入框里只多一枚**标签**，正文该是空的。
     *
     * ⚠ 2026-08-26 用户指着 TRAE 的截图纠正过一次：我们原来给伙伴灌了几十字
     *   的起手意图进正文，用户一进来先得删掉别人替他写的话。`/` 的语义是
     *   "给我正要写的这句话挂个能力"，不是"替我写"。
     *   库页上那颗「用这个伙伴」是另一回事（见 G），那里灌是对的——
     *   两条判据放在一起，才说得清这个区别不是漏改。
     */
    await page.fill(TA, "");
    await page.type(TA, "/晨会", { delay: 60 });
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const afterPartner = await page.inputValue(TA);
    const inTagRow = await page.$$eval(
      '[data-testid="sliderule-composer-tags"] [data-testid="sliderule-capability-chip"]',
      els => els.map(e => e.getAttribute("data-key"))
    );
    check(
      "B2 `/` 选伙伴只挂标签，**不往正文灌起手意图**（标签就在输入框里）",
      afterPartner.trim() === "" && inTagRow.length > 0,
      `正文 ${JSON.stringify(afterPartner.slice(0, 40))} · 输入框里的标签 ${JSON.stringify(inTagRow)}`
    );

    /* C：正文空着时退格摘掉最后一枚——标签输入框的通行手势 */
    await page.click(TA);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(400);
    const afterBack = await page.$$eval(
      '[data-testid="sliderule-capability-chip"]',
      els => els.length
    );
    check(
      "C2 正文空着时退格摘掉最后一枚标签",
      afterBack === inTagRow.length - 1,
      `${inTagRow.length} → ${afterBack}`
    );

    await page.click('[data-testid="sliderule-capability-chip"] button');
    await page.waitForTimeout(500);
    const chipsAfter = await page.$$eval(
      '[data-testid="sliderule-capability-chip"]',
      els => els.map(e => e.getAttribute("data-key"))
    );
    check("C 标签能一个个摘掉", chipsAfter.length === 0, JSON.stringify(chipsAfter));

    /* ── H：侧栏导航（2026-08-26 用户给了样式截图并当场否掉左竖条）───
     *
     * ⚠ 先切到一个**在导航里的**视图再判"选中态"。推演视图不在导航列表里
     *   （靠点品牌 logo 进），停在那儿时 .native-agent-nav-item-active
     *   压根不存在——第一版就这么写的，判据以「选中项左边 null」红掉，
     *   而它想钉的东西根本没被看到。
     */
    await page.getByText("技能 · 连接器 · 伙伴").first().click();
    await page.waitForSelector('[data-testid="capability-tab"]', { timeout: 30000 });
    await page.waitForTimeout(1500);

    const navGroups = await page.$$eval(".native-agent-nav-group-label", els =>
      els.map(e => e.textContent?.trim())
    );
    const activeBar = await page.evaluate(() => {
      const el = document.querySelector(".native-agent-nav-item-active");
      if (!el) return null;
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, "::before");
      return {
        borderLeft: parseFloat(cs.borderLeftWidth) || 0,
        // ⚠ 竖条也可能是 ::before 画的，光看 border 抓不住
        pseudo: before.content !== "none" ? parseFloat(before.width) || 0 : 0,
      };
    });
    check(
      "H 侧栏按创作资源/系统分组，且选中项**没有左竖条**（用户当场否掉的）",
      navGroups.length >= 2 &&
        navGroups.includes("创作资源") &&
        navGroups.includes("系统") &&
        !!activeBar &&
        activeBar.borderLeft === 0 &&
        activeBar.pseudo === 0,
      `分组 ${JSON.stringify(navGroups)} · 选中项左边 ${JSON.stringify(activeBar)}`
    );

    /*
     * H2：折叠箭头**只画在真的有下级的项上**。
     *
     * ⚠ 用户给的截图里每一项右边都有箭头。给「设置」「管理台」挂一个展不开的
     *   箭头，就是"看着能点、点了没反应"——这个仓刚为它连修两轮。
     */
    const carets = await page.$$eval(
      '[data-testid="agent-nav-expand"]',
      els => els.length
    );
    check(
      "H2 只有真的有下级的项才有折叠箭头（不许挂展不开的假箭头）",
      carets === 1,
      `带箭头的项 ${carets} 个`
    );

    /* H3：展开之后子项真的切得动页面（不是画着好看）。
       点导航项本身就会展开，所以只在没展开时才去点箭头。 */
    if ((await page.locator('[data-testid="agent-nav-subitem"]').count()) === 0) {
      await page.click('[data-testid="agent-nav-expand"]');
      await page.waitForTimeout(500);
    }
    const subs = await page.$$eval('[data-testid="agent-nav-subitem"]', els =>
      els.map(e => e.getAttribute("data-layer"))
    );
    await page
      .locator('[data-testid="agent-nav-subitem"][data-layer="connectors"]')
      .click();
    await page.waitForSelector('[data-testid="capability-tab"]', { timeout: 30000 });
    await page.waitForTimeout(1800);
    const landed = await page.$$eval('[data-testid="capability-tab"]', els =>
      els
        .filter(e => e.getAttribute("data-active") === "1")
        .map(e => e.getAttribute("data-layer"))
    );
    check(
      "H3 侧栏子项「连接器」直接把页面切到连接器层",
      JSON.stringify(subs) === JSON.stringify(["skills", "connectors", "partners"]) &&
        JSON.stringify(landed) === JSON.stringify(["connectors"]),
      `子项 ${JSON.stringify(subs)} · 落在 ${JSON.stringify(landed)}`
    );

    /* ── D：一页三层 ─────────────────────────────────────────────── */
    await page.waitForSelector('[data-testid="capability-tab"]', { timeout: 30000 });
    await page.waitForTimeout(2000);
    const layers = await page.$$eval('[data-testid="capability-tab"]', els =>
      els.map(e => e.getAttribute("data-layer"))
    );
    check(
      "D 一页三层：技能 / 连接器 / 伙伴",
      JSON.stringify(layers) === JSON.stringify(["skills", "connectors", "partners"]),
      JSON.stringify(layers)
    );

    /* ── E / E2：试取真数据，成功与失败是一对 ─────────────────────── */
    await page.click('[data-testid="capability-tab"][data-layer="connectors"]');
    await page.waitForTimeout(1200);
    /*
     * E0：卡片墙**只列真的能用的**。
     *
     * ⚠ 2026-08-26 用户给的效果图上有 24 个连接器（钉钉、飞书、Notion、
     *   高德地图…），我们只有 2 个。摆上去点不通，就是这整条链路存在的理由
     *   要杀掉的东西——比"没有这个连接器"更糟，因为用户会以为接得上。
     *   判据钉的是**卡片数 === 后端清单长度**，顺带钉住页面上那个数字也是
     *   数出来的、不是写死的。
     */
    const backendIds = await page.evaluate(async () => {
      const r = await fetch("/api/sliderule/connectors");
      if (!r.ok) return [];
      const j = await r.json();
      return (j.connectors || []).map(c => c.id);
    });
    const cardIds = await page.$$eval('[data-testid="connector-card"]', els =>
      els.map(e => e.getAttribute("data-connector"))
    );
    const countText = (
      await page.textContent('[data-testid="connector-count"]')
    )?.trim();
    check(
      "E0 卡片墙只列后端真有的连接器，数量照实数（效果图上那 22 个假的不许摆）",
      backendIds.length > 0 &&
        JSON.stringify([...cardIds].sort()) ===
          JSON.stringify([...backendIds].sort()) &&
        countText === `${backendIds.length} 个`,
      `后端 ${JSON.stringify(backendIds)} · 卡片 ${JSON.stringify(cardIds)} · 页面写 ${countText}`
    );

    /* E3：卡片上的「+ / ✓ 已添加」= 挂不挂在这一轮，跟 `/` 同一条路径。
       ⚠ 顺带钉住"点 + 不跳页"：用户在挑连接器，跳走了就看不到状态变化、
         也没法接着挑第二个。 */
    const urlBefore = page.url();
    await page.click(
      '[data-testid="connector-card"][data-connector="stock"] [data-testid="connector-attach"]'
    );
    await page.waitForTimeout(800);
    const attachedNow = await page.getAttribute(
      '[data-testid="connector-card"][data-connector="stock"]',
      "data-attached"
    );
    const stayed = page.url() === urlBefore;
    await page.click('[data-testid="connector-mine"]');
    await page.waitForTimeout(600);
    const mine = await page.$$eval('[data-testid="connector-card"]', els =>
      els.map(e => e.getAttribute("data-connector"))
    );
    await page.click('[data-testid="connector-mine"]');
    await page.waitForTimeout(400);
    await page.click(
      '[data-testid="connector-card"][data-connector="stock"] [data-testid="connector-attach"]'
    );
    await page.waitForTimeout(600);
    const detached = await page.getAttribute(
      '[data-testid="connector-card"][data-connector="stock"]',
      "data-attached"
    );
    check(
      "E3 「+ / 已添加」真的挂到这一轮、「我的连接器」筛得出、再点摘掉，且不跳页",
      attachedNow === "1" &&
        stayed &&
        JSON.stringify(mine) === JSON.stringify(["stock"]) &&
        detached === "0",
      `挂上=${attachedNow} 留在原页=${stayed} 我的=${JSON.stringify(mine)} 摘掉后=${detached}`
    );

    const card = page.locator('[data-testid="connector-card"][data-connector="weather"]');
    // 试取藏在卡片展开里（效果图的卡片是紧凑的），先展开
    await card.locator('[data-testid="connector-expand"]').click();
    await page.waitForTimeout(400);
    await card.locator('[data-testid="connector-preview"]').click();
    await card
      .locator('[data-testid="connector-preview-result"], [data-testid="connector-error"]')
      .first()
      .waitFor({ timeout: 60000 })
      .catch(() => {});
    const okBox = await card.locator('[data-testid="connector-preview-result"]').count();
    const okText = okBox
      ? await card.locator('[data-testid="connector-preview-result"]').textContent()
      : "";
    /* ⚠ 判据不是"出了个表格"，而是**表格里是真的**：行数对得上、日期是
       今明两天、来源写着 Open-Meteo。出个表格太容易了——铺 12 行示例数据
       同样出得来，而那正是这条链路要消灭的东西。 */
    const looksReal =
      okBox > 0 &&
      /Open-Meteo/.test(okText) &&
      /\d{4}-\d{2}-\d{2}/.test(okText) &&
      /行 ·/.test(okText);
    check(
      "E 连接器「试取真数据」拿回真值（带来源和日期，不是示例表）",
      looksReal,
      (okText || "（没有结果）").replace(/\s+/g, " ").slice(0, 140)
    );

    await card.locator('[data-testid="connector-arg"]').fill("压根不存在的城市zzz");
    await card.locator('[data-testid="connector-preview"]').click();
    await card
      .locator('[data-testid="connector-error"]')
      .waitFor({ timeout: 60000 })
      .catch(() => {});
    const errText =
      (await card.locator('[data-testid="connector-error"]').count())
        ? await card.locator('[data-testid="connector-error"]').textContent()
        : "";
    const rowsShown = await card.locator('[data-testid="connector-preview-result"]').count();
    check(
      "E2 认不出的城市如实报错，且一行都不显示",
      /zzz/.test(errText) && rowsShown === 0,
      `错误=${(errText || "（没有）").slice(0, 60)} · 还在显示行=${rowsShown}`
    );

    /* ── F / G：伙伴 ─────────────────────────────────────────────── */
    await page.click('[data-testid="capability-tab"][data-layer="partners"]');
    await page.waitForTimeout(1000);
    const cards = await page.$$eval('[data-testid="partner-card"]', els =>
      els.map(e => ({
        id: e.getAttribute("data-partner"),
        ready: e.getAttribute("data-ready"),
        missing: e.querySelector('[data-testid="partner-missing"]') ? 1 : 0,
        disabled: e.querySelector('[data-testid="partner-use"]')?.disabled ? 1 : 0,
      }))
    );
    /* ⚠ 正反两条：齐了要能按，缺了要按不动**并且说出缺什么**。
       只判"能按"的话，一个永远显示可用、点了没反应的伙伴照样绿。 */
    const consistent = cards.every(c =>
      c.ready === "1" ? c.disabled === 0 && c.missing === 0 : c.disabled === 1 && c.missing === 1
    );
    check(
      "F 伙伴：依赖齐可按，缺依赖按不动且说明缺什么",
      cards.length > 0 && consistent,
      JSON.stringify(cards)
    );

    const readyOne = cards.find(c => c.ready === "1");
    if (readyOne) {
      await page.click(
        `[data-testid="partner-card"][data-partner="${readyOne.id}"] [data-testid="partner-use"]`
      );
      await page.waitForSelector(TA, { timeout: 30000 });
      await page.waitForTimeout(2500);
      const gChips = await page.$$eval(
        '[data-testid="sliderule-capability-chip"]',
        els => els.map(e => e.getAttribute("data-key"))
      );
      const gText = await page.inputValue(TA);
      check(
        "G 「用这个伙伴」挂上能力 + 跳回推演 + 起手意图填进输入框",
        gChips.length > 0 && gText.trim().length > 10,
        `芯片 ${JSON.stringify(gChips)} · 输入框 ${JSON.stringify(gText.slice(0, 40))}`
      );
    } else {
      check("G 「用这个伙伴」", false, "没有一个依赖齐全的伙伴可点");
    }
  } finally {
    const passed = results.filter(r => r.ok).length;
    log(`${passed}/${results.length} 通过`);
    const failed = results.filter(r => !r.ok);
    if (failed.length) log("失败：" + failed.map(f => f.id).join(", "));
    await browser.close();
    if (failed.length) process.exitCode = 1;
  }
}

main().catch(err => {
  log("崩了：" + String(err));
  process.exitCode = 1;
});
