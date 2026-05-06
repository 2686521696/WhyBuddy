#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const inputPath = process.argv[2] || "/workspace/skill-input.json";
const artifactsDir = process.env.CUBE_SKILL_ARTIFACTS_DIR || "/workspace/artifacts";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "document";
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: artifactsDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
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

function writeFallbackHtml(title, markdown) {
  const html = [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\">",
    `<title>${escapeHtml(title)}</title>`,
    "<style>body{font-family:Arial,sans-serif;line-height:1.6;margin:40px;color:#111827}pre{background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap}</style>",
    "</head><body>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<pre>${escapeHtml(markdown)}</pre>`,
    "</body></html>",
  ].join("");
  fs.writeFileSync(path.join(artifactsDir, "document.html"), html, "utf8");
}

function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const title = typeof input.title === "string" && input.title.trim()
    ? input.title.trim()
    : "Rendered Document";
  const markdown = typeof input.markdown === "string"
    ? input.markdown
    : "# Rendered Document\n\nNo markdown body was provided.";

  const sourceName = `${slugify(title)}.md`;
  const sourcePath = path.join(artifactsDir, sourceName);
  fs.writeFileSync(sourcePath, `# ${title}\n\n${markdown}\n`, "utf8");

  const report = {
    ok: true,
    title,
    sourceCharacters: markdown.length,
    renderedAt: new Date().toISOString(),
    renderer: {
      pandoc: false,
      libreOfficePdf: false,
    },
  };

  try {
    run("pandoc", [
      sourceName,
      "--standalone",
      "--metadata",
      `title=${title}`,
      "--output",
      "document.html",
    ]);
    report.renderer.pandoc = true;
  } catch (error) {
    report.renderer.pandoc = false;
    report.pandocError = error instanceof Error ? error.message : String(error);
    writeFallbackHtml(title, markdown);
  }

  try {
    run("libreoffice", [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      artifactsDir,
      "document.html",
    ]);
    report.renderer.libreOfficePdf = fs.existsSync(
      path.join(artifactsDir, "document.pdf"),
    );
  } catch (error) {
    report.renderer.libreOfficePdf = false;
    report.pdfError = error instanceof Error ? error.message : String(error);
  }

  fs.writeFileSync(
    path.join(artifactsDir, "document-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  const artifacts = [
    manifestEntry("document.html", "text/html", "html", "Rendered HTML document"),
  ];
  if (fs.existsSync(path.join(artifactsDir, "document.pdf"))) {
    artifacts.push(
      manifestEntry("document.pdf", "application/pdf", "pdf", "Rendered PDF document"),
    );
  }
  artifacts.push(
    manifestEntry("document-report.json", "application/json", "json", "Render report"),
  );
  fs.writeFileSync(
    path.join(artifactsDir, "artifact-manifest.json"),
    `${JSON.stringify({ version: "2026-05-04", source: "document-render", artifacts }, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ ok: true, artifacts: artifacts.length, renderer: report.renderer }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}
