import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const batch = option("--batch");
const types = (option("--types") || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const baseUrl = option("--url") || "http://localhost:3000/agent-loop/components";

if (!batch || types.length === 0) {
  throw new Error("Usage: --batch <name> --types <TypeA,TypeB,...> [--url <url>]");
}

const slug = value =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const outputDir = path.resolve("artifacts", batch);
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const audit = {
  screenshots: 0,
  empty: 0,
  overflow: 0,
  escaped: 0,
  metadataOverlaps: 0,
  items: [],
};

try {
  for (const device of ["desktop", "phone"]) {
    const context = await browser.newContext({
      viewport: device === "desktop" ? { width: 1440, height: 1000 } : { width: 430, height: 932 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.getByTestId("components-mode-blocks").click();
    await page
      .getByTestId("components-device-switch")
      .getByText(device === "desktop" ? "桌面档" : "手机档", { exact: true })
      .click();

    for (const type of types) {
      const search = page.getByTestId("components-search");
      await search.fill(type);
      const card = page.getByTestId(`component-card-${type}`);
      await card.waitFor({ state: "visible", timeout: 30_000 });
      await card.scrollIntoViewIfNeeded();
      await card.getByTestId("component-preview-runtime").waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(350);

      const details = await card.evaluate(element => {
        const cardRect = element.getBoundingClientRect();
        const visible = child => {
          const style = getComputedStyle(child);
          const rect = child.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const hasClippingAncestor = child => {
          let current = child.parentElement;
          while (current && current !== element) {
            const style = getComputedStyle(current);
            if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) return true;
            current = current.parentElement;
          }
          return false;
        };
        const escaped = [...element.querySelectorAll("*")].filter(child => {
          if (!visible(child) || hasClippingAncestor(child)) return false;
          const rect = child.getBoundingClientRect();
          return rect.left < cardRect.left - 1 || rect.right > cardRect.right + 1;
        }).length;
        const body = element.querySelector(".ant-card-body");
        const overflowX = body ? body.scrollWidth > body.clientWidth + 1 : false;
        const text = (element.textContent || "").replace(/\s+/g, " ").trim().length;
        const metadata = element.querySelector("[data-testid='component-card-metadata']");
        let metadataOverlap = false;
        if (metadata) {
          const leaves = [...metadata.querySelectorAll("span")]
            .filter(child => child.children.length === 0 && visible(child))
            .map(child => child.getBoundingClientRect());
          metadataOverlap = leaves.some((left, index) =>
            leaves.slice(index + 1).some(right => {
              const overlapX = Math.min(left.right, right.right) - Math.max(left.left, right.left);
              const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
              return overlapX > 1 && overlapY > 1;
            }),
          );
          const rect = metadata.getBoundingClientRect();
          metadataOverlap ||= rect.left < cardRect.left - 1 || rect.right > cardRect.right + 1;
        }
        return { text, width: cardRect.width, height: cardRect.height, overflowX, escaped, metadataOverlap };
      });

      const file = `${device}-${slug(type)}.png`;
      await card.screenshot({ path: path.join(outputDir, file), animations: "disabled" });
      const item = { device, type, file, ...details };
      audit.items.push(item);
      audit.screenshots += 1;
      audit.empty += details.text < 20 ? 1 : 0;
      audit.overflow += details.overflowX ? 1 : 0;
      audit.escaped += details.escaped;
      audit.metadataOverlaps += details.metadataOverlap ? 1 : 0;
    }
    await context.close();
  }

  for (const device of ["desktop", "phone"]) {
    const items = audit.items.filter(item => item.device === device);
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
    const tiles = await Promise.all(
      items.map(async item => ({
        ...item,
        src: `data:image/png;base64,${(await fs.readFile(path.join(outputDir, item.file))).toString("base64")}`,
      })),
    );
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box} body{margin:0;padding:24px;background:#eef1f5;font:14px system-ui;color:#0f172a}
      main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
      figure{margin:0;padding:12px;background:white;border-radius:8px;box-shadow:0 2px 12px rgba(15,23,42,.1)}
      figcaption{font-weight:650;margin:0 0 10px} img{display:block;width:100%;height:auto}
    </style><main>${tiles
      .map(item => `<figure><figcaption>${item.type}</figcaption><img src="${item.src}"></figure>`)
      .join("")}</main>`);
    await page.screenshot({ path: path.join(outputDir, `${device}-contact-sheet.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(outputDir, "audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
