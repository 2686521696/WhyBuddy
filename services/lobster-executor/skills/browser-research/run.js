#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2] || "/workspace/skill-input.json";
const artifactsDir = process.env.CUBE_SKILL_ARTIFACTS_DIR || "/workspace/artifacts";

function readInput() {
  return JSON.parse(fs.readFileSync(inputPath, "utf8"));
}

function manifestEntry(name, mimeType, previewType, description) {
  const filePath = path.join(artifactsDir, name);
  return {
    id: name.replace(/\.[^.]+$/, ""),
    kind: "file",
    name,
    path: `artifacts/${name}`,
    mimeType,
    previewType,
    size: fs.statSync(filePath).size,
    description,
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const input = readInput();
  const url = typeof input.url === "string" && input.url.trim()
    ? input.url.trim()
    : "data:text/html,<title>browser-research</title><h1>browser-research</h1>";

  const { chromium } = require("playwright");
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage({
      viewport: input.viewport || { width: 1280, height: 720 },
    });
    await page.goto(url, {
      waitUntil: input.waitUntil || "load",
      timeout: input.timeoutMs || 30_000,
    });
    await page.screenshot({
      path: path.join(artifactsDir, "page-screenshot.png"),
      fullPage: true,
    });
    fs.writeFileSync(path.join(artifactsDir, "page.html"), await page.content(), "utf8");
    fs.writeFileSync(
      path.join(artifactsDir, "browser-report.json"),
      `${JSON.stringify(
        {
          ok: true,
          title: await page.title(),
          finalUrl: page.url(),
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const artifacts = [
      manifestEntry("page-screenshot.png", "image/png", "image", "Browser screenshot"),
      manifestEntry("page.html", "text/html", "html", "HTML snapshot"),
      manifestEntry("browser-report.json", "application/json", "json", "Browser report"),
    ];
    fs.writeFileSync(
      path.join(artifactsDir, "artifact-manifest.json"),
      `${JSON.stringify({ version: "2026-05-04", source: "browser-research", artifacts }, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify({ ok: true, artifacts: artifacts.length }));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
