#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const ARTIFACTS_DIR = process.env.CUBE_AGENT_SELF_CHECK_ARTIFACTS_DIR || "/workspace/artifacts";
const RESULT_FILE = join(ARTIFACTS_DIR, "agent-self-check.json");
const SCREENSHOT_FILE = join(ARTIFACTS_DIR, "agent-self-check.png");
const HTML_FILE = join(ARTIFACTS_DIR, "agent-self-check.html");

function run(command, args = [], options = {}) {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs || 60_000,
      env: process.env,
    }).trim();
    return {
      ok: true,
      command: [command, ...args].join(" "),
      output,
    };
  } catch (error) {
    return {
      ok: false,
      command: [command, ...args].join(" "),
      output:
        error && typeof error === "object" && "stderr" in error
          ? String(error.stderr || error.message || "")
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

function runAny(label, candidates) {
  const attempts = candidates.map(([command, args = []]) => run(command, args));
  const passed = attempts.find(attempt => attempt.ok);
  return {
    ok: Boolean(passed),
    command: label,
    output: passed
      ? passed.output
      : attempts.map(attempt => `${attempt.command}: ${attempt.output}`).join("\n"),
    attempts,
  };
}

async function checkPlaywright() {
  try {
    const { chromium } = require("playwright");
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
    await page.setContent(
      [
        "<!doctype html>",
        "<html>",
        "<head><meta charset=\"utf-8\"><title>Cube Agent Self Check</title></head>",
        "<body style=\"font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:48px\">",
        "<h1>Cube AI Agent Sandbox</h1>",
        "<p>Playwright and Chromium are running inside the container.</p>",
        "</body>",
        "</html>",
      ].join(""),
    );
    await page.screenshot({ path: SCREENSHOT_FILE, fullPage: true });
    const title = await page.title();
    await browser.close();
    return {
      ok: existsSync(SCREENSHOT_FILE),
      command: "playwright chromium.launch",
      output: `${title}; screenshot=${SCREENSHOT_FILE}`,
    };
  } catch (error) {
    return {
      ok: false,
      command: "playwright chromium.launch",
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(
    HTML_FILE,
    "<!doctype html><html><body><h1>Cube AI Agent Sandbox self-check</h1></body></html>\n",
    "utf8",
  );

  const checks = [
    run("node", ["--version"]),
    run("npm", ["--version"]),
    run("python", ["--version"]),
    run("python3", ["--version"]),
    run("pip", ["--version"]),
    run("git", ["--version"]),
    run("jq", ["--version"]),
    run("pandoc", ["--version"]),
    run("libreoffice", ["--version"]),
    run("ffmpeg", ["-version"]),
    runAny("imagemagick", [
      ["magick", ["--version"]],
      ["convert", ["--version"]],
    ]),
    await checkPlaywright(),
  ];

  const manifestPath = "/opt/cube-agent/capabilities.json";
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : null;
  const failed = checks.filter(check => !check.ok);
  const result = {
    ok: failed.length === 0,
    image: manifest?.image || "cube-ai-agent-sandbox:latest",
    checkedAt: new Date().toISOString(),
    artifactsDir: ARTIFACTS_DIR,
    screenshot: existsSync(SCREENSHOT_FILE) ? SCREENSHOT_FILE : null,
    capabilities: manifest?.capabilities || [],
    checks,
    failed: failed.map(check => check.command),
  };

  writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const result = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
});
