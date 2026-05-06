#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const ARTIFACTS_DIR = process.env.CUBE_BROWSER_ARTIFACTS_DIR || "/workspace/artifacts";
const TASK_FILE = process.env.BROWSER_TASK_FILE || "/workspace/browser-task.json";
const MANIFEST_FILE = path.join(ARTIFACTS_DIR, "artifact-manifest.json");

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function readTask() {
  if (process.env.BROWSER_TASK) {
    return JSON.parse(process.env.BROWSER_TASK);
  }
  if (fs.existsSync(TASK_FILE)) {
    return JSON.parse(fs.readFileSync(TASK_FILE, "utf8"));
  }
  if (process.env.TASK_CONTENT) {
    try {
      const parsed = JSON.parse(process.env.TASK_CONTENT);
      return parsed.browserTask || parsed;
    } catch {
      return { url: process.env.TASK_CONTENT };
    }
  }
  throw new Error("Browser runner requires BROWSER_TASK, browser-task.json, or TASK_CONTENT.");
}

function normalizeTask(input) {
  if (!isRecord(input)) {
    throw new Error("Browser task must be an object.");
  }

  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) {
    throw new Error("Browser task requires url.");
  }

  const viewport = isRecord(input.viewport) ? input.viewport : {};
  const capture = isRecord(input.capture) ? input.capture : {};
  const screenshot = isRecord(input.screenshot) ? input.screenshot : {};

  return {
    url,
    viewport: {
      width: Number.isFinite(Number(viewport.width)) ? Number(viewport.width) : 1440,
      height: Number.isFinite(Number(viewport.height)) ? Number(viewport.height) : 900,
    },
    waitUntil:
      input.waitUntil === "load" ||
      input.waitUntil === "domcontentloaded" ||
      input.waitUntil === "networkidle"
        ? input.waitUntil
        : "networkidle",
    timeoutMs:
      Number.isFinite(Number(input.timeoutMs)) && Number(input.timeoutMs) > 0
        ? Number(input.timeoutMs)
        : 30_000,
    capture: {
      screenshot: capture.screenshot !== false,
      html: capture.html !== false,
      console: capture.console !== false,
      metrics: capture.metrics !== false,
    },
    screenshot: {
      fullPage: screenshot.fullPage !== false,
    },
  };
}

function artifactEntry(input) {
  const filePath = path.join(ARTIFACTS_DIR, input.name);
  const stat = fs.statSync(filePath);
  return {
    id: input.id,
    kind: "file",
    name: input.name,
    path: `artifacts/${input.name}`,
    mimeType: input.mimeType,
    previewType: input.previewType,
    size: stat.size,
    description: input.description,
  };
}

async function main() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const task = normalizeTask(readTask());
  const consoleEntries = [];
  const startedAt = new Date().toISOString();
  const started = performance.now();

  const { chromium } = require("playwright");
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage({ viewport: task.viewport });
    page.on("console", message => {
      if (!task.capture.console) return;
      consoleEntries.push({
        type: message.type(),
        text: message.text(),
        location: message.location(),
        time: new Date().toISOString(),
      });
    });
    page.on("pageerror", error => {
      if (!task.capture.console) return;
      consoleEntries.push({
        type: "pageerror",
        text: error.message,
        time: new Date().toISOString(),
      });
    });

    const response = await page.goto(task.url, {
      waitUntil: task.waitUntil,
      timeout: task.timeoutMs,
    });
    const loadedAt = performance.now();
    const title = await page.title();
    const finalUrl = page.url();

    const artifacts = [];
    if (task.capture.screenshot) {
      await page.screenshot({
        path: path.join(ARTIFACTS_DIR, "page-screenshot.png"),
        fullPage: task.screenshot.fullPage,
      });
      artifacts.push(
        artifactEntry({
          id: "page-screenshot",
          name: "page-screenshot.png",
          mimeType: "image/png",
          previewType: "image",
          description: "Full page browser screenshot",
        }),
      );
    }

    if (task.capture.html) {
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, "page.html"),
        await page.content(),
        "utf8",
      );
      artifacts.push(
        artifactEntry({
          id: "page-html",
          name: "page.html",
          mimeType: "text/html",
          previewType: "html",
          description: "HTML snapshot captured after page load",
        }),
      );
    }

    if (task.capture.console) {
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, "console.json"),
        `${JSON.stringify(consoleEntries, null, 2)}\n`,
        "utf8",
      );
      artifacts.push(
        artifactEntry({
          id: "console-log",
          name: "console.json",
          mimeType: "application/json",
          previewType: "json",
          description: "Browser console messages and page errors",
        }),
      );
    }

    if (task.capture.metrics) {
      const metrics = {
        ok: true,
        url: task.url,
        finalUrl,
        title,
        status: response?.status() ?? null,
        viewport: task.viewport,
        waitUntil: task.waitUntil,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
        loadDurationMs: Math.round(loadedAt - started),
        consoleErrorCount: consoleEntries.filter(item =>
          ["error", "pageerror"].includes(item.type),
        ).length,
      };
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, "browser-metrics.json"),
        `${JSON.stringify(metrics, null, 2)}\n`,
        "utf8",
      );
      artifacts.push(
        artifactEntry({
          id: "browser-metrics",
          name: "browser-metrics.json",
          mimeType: "application/json",
          previewType: "json",
          description: "Browser navigation timing and capture metadata",
        }),
      );
    }

    fs.writeFileSync(
      MANIFEST_FILE,
      `${JSON.stringify(
        {
          version: "2026-05-04",
          generatedAt: new Date().toISOString(),
          source: "cube-browser-runner",
          artifacts,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(
      JSON.stringify({
        ok: true,
        title,
        finalUrl,
        artifactCount: artifacts.length,
      }),
    );
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const result = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "browser-error.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
});
