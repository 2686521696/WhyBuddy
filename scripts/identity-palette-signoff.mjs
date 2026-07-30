#!/usr/bin/env node
/**
 * identity-palette-signoff.mjs
 *
 * 视觉核对（6 步收尾的最后一步）：把旧 8 套预设的主色当种子色，跑一遍新的
 * deriveIdentityPalette 派生管线，连同 FALLBACK_SEED 一起铺成色板卡片，
 * 出一张 PNG 给人看——机器测试只能保证"格式合法/不重复"，看着协调不协调
 * 得靠人眼。
 *
 * 用法：node scripts/identity-palette-signoff.mjs [output.png]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  deriveIdentityPalette,
  fallbackIdentityPalette,
} from "../client/src/lib/identity-palette.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const outPath = process.argv[2] || resolve(ROOT, "tmp", "identity-palette-signoff.png");
mkdirSync(dirname(outPath), { recursive: true });

// 旧 8 套预设的主色（与 identity-palette.test.ts 的 OLD_SEEDS 同源）——
// 不是要复活它们的地位，只是用真实曾用过的色相当输入，看新管线接得住。
const OLD_SEEDS = {
  "湛蓝 azure": "#1677ff",
  "松绿 forest": "#2e7d32",
  "石墨 graphite": "#525252",
  "橘橙 tangerine": "#e05d38",
  "紫罗兰 violet": "#7033ff",
  "琥珀 amber": "#d97706",
  "陶土 clay": "#c96442",
  "靛蓝 indigo": "#6366f1",
};

const cards = [
  { label: "FALLBACK_SEED（唯一的手工色值，无主题时的兜底）", palette: fallbackIdentityPalette() },
  ...Object.entries(OLD_SEEDS).map(([label, seed]) => ({
    label: `${label}（旧预设主色当种子色）`,
    palette: deriveIdentityPalette(seed, { id: label, label }),
  })),
];

const swatch = (hex, label, textColor) => `
  <div style="flex:1;background:${hex};color:${textColor || "#000"};font:11px/1.3 monospace;padding:6px 8px;min-height:44px;display:flex;flex-direction:column;justify-content:flex-end;">
    <div>${label}</div>
    <div>${hex}</div>
  </div>`;

const cardHtml = ({ label, palette: p }) => `
<div style="border:1px solid #ddd;border-radius:8px;overflow:hidden;margin-bottom:20px;font-family:system-ui,sans-serif;">
  <div style="padding:10px 14px;font:13px/1.4 system-ui;background:#fafafa;border-bottom:1px solid #eee;">
    <b>${label}</b> — 种子色 ${p.primary}
  </div>
  <div style="display:flex;">
    ${swatch(p.primary, "primary", p.primaryFg)}
    ${swatch(p.primaryHover, "primaryHover", "#fff")}
    ${swatch(p.gradTo, "gradTo", "#fff")}
    ${swatch(p.contentBg, "contentBg", "#111")}
    ${swatch(p.accentBg, "accentBg", p.accentFg)}
    ${swatch(p.accentFg, "accentFg", "#fff")}
  </div>
  <div style="display:flex;">
    ${p.charts.map((c, i) => swatch(c, `chart${i}`, "#fff")).join("")}
  </div>
  <div style="display:flex;">
    ${swatch(p.sidebarBg, "sidebarBg", p.sidebarText)}
    ${swatch(p.sidebarText, "sidebarText", "#111")}
  </div>
</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:16px;background:#fff;width:1040px;">
${cards.map(cardHtml).join("\n")}
</body></html>`;

const htmlPath = resolve(ROOT, "tmp", "identity-palette-signoff.html");
writeFileSync(htmlPath, html, "utf-8");

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  executablePath: process.env.SLIDERULE_CHROMIUM_PATH || undefined,
});
const page = await (await browser.newContext({ viewport: { width: 1080, height: 800 }, deviceScaleFactor: 2 })).newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log(`[signoff] ${outPath}`);
