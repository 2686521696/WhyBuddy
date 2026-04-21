import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const VITEST_ENTRY = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");

const TEST_ROOTS = [
  "server/tests",
  "server/permission",
  "shared",
];

const TEST_FILE_PATTERN = /\.test\.ts$/;
const DEFAULT_BATCH_SIZE = 20;

function walkFiles(dir, bucket) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, bucket);
      continue;
    }

    if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      bucket.push(path.relative(ROOT, fullPath));
    }
  }
}

function collectTestFiles() {
  const files = [];

  for (const relRoot of TEST_ROOTS) {
    const absRoot = path.join(ROOT, relRoot);
    if (!statExists(absRoot)) {
      continue;
    }
    walkFiles(absRoot, files);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function statExists(targetPath) {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function chunk(list, size) {
  const batches = [];
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size));
  }
  return batches;
}

function runBatch(batch, batchIndex, totalBatches) {
  console.log(
    `[test:server] Running batch ${batchIndex + 1}/${totalBatches} (${batch.length} files)`,
  );

  const args = [
    VITEST_ENTRY,
    "run",
    "--config",
    "vitest.config.server.ts",
    "--pool=forks",
    "--poolOptions.forks.singleFork",
    "--no-file-parallelism",
    "--silent",
    ...batch,
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    console.error(`[test:server] Batch terminated by signal ${result.signal}`);
    process.exit(1);
  }
}

const batchSize = Number.parseInt(process.env.TEST_SERVER_BATCH_SIZE ?? "", 10) || DEFAULT_BATCH_SIZE;
const testFiles = collectTestFiles();

if (testFiles.length === 0) {
  console.error("[test:server] No test files found.");
  process.exit(1);
}

const batches = chunk(testFiles, batchSize);

for (const [index, batch] of batches.entries()) {
  runBatch(batch, index, batches.length);
}

console.log(`[test:server] Completed ${testFiles.length} files across ${batches.length} batches.`);
