/**
 * 「技能 · 连接器 · 伙伴」的真机烟测。
 *
 * 为什么单独一支而不是塞进画布那支：这条链跟画布**没有任何共享状态**，
 * 而画布那支已经 39 条、跑一趟要一分多钟。分开之后改哪条跑哪条。
 *
 *   A  输入框打 `/` 弹出能力面板，连接器/技能/伙伴都在
 *   A2 网址里的斜杠**不弹**            ← 跟 A 是一对，错弹会吃掉方向键和回车
 *   B  打字能筛，回车选中后正文里不留 `/词`（能力是芯片不是正文）
 *   C  芯片能一个个摘掉
 *   D  「技能 · 连接器 · 伙伴」页三层都在
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

    await page.click('[data-testid="sliderule-capability-chip"] button');
    await page.waitForTimeout(500);
    const chipsAfter = await page.$$eval(
      '[data-testid="sliderule-capability-chip"]',
      els => els.map(e => e.getAttribute("data-key"))
    );
    check("C 芯片能摘掉", chipsAfter.length === 0, JSON.stringify(chipsAfter));

    /* ── D：一页三层 ─────────────────────────────────────────────── */
    await page.getByText("技能 · 连接器 · 伙伴").first().click();
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
    const card = page.locator('[data-testid="connector-card"][data-connector="weather"]');
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
