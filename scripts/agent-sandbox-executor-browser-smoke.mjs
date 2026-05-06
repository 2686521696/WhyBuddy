import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const image = process.env.LOBSTER_AGENT_IMAGE || "cube-ai-agent-sandbox:latest";
const port = Number.parseInt(process.env.AGENT_EXECUTOR_SMOKE_PORT || "3133", 10);
const host = "127.0.0.1";
const dataRoot = resolve("tmp", "agent-sandbox-executor-smoke");
const baseUrl = `http://${host}:${port}`;
const callbackSecret = "agent-sandbox-smoke-secret";
const contractVersion = "2026-03-28";

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

function makeAuth() {
  return {
    scheme: "hmac-sha256",
    executorHeader: "x-cube-executor-id",
    timestampHeader: "x-cube-executor-timestamp",
    signatureHeader: "x-cube-executor-signature",
    signedPayload: "timestamp.rawBody",
  };
}

function createBrowserTask() {
  const html = [
    "<!doctype html>",
    "<html>",
    "<head><meta charset='utf-8'><title>Cube Executor Browser Smoke</title></head>",
    "<body style='margin:0;font-family:Arial,sans-serif;background:#eef2ff;color:#0f172a'>",
    "<main style='padding:48px'>",
    "<h1>Cube AI Agent Sandbox</h1>",
    "<p>lobster-executor real mode produced this screenshot through Playwright.</p>",
    "<script>console.log('cube browser smoke ready')</script>",
    "</main>",
    "</body>",
    "</html>",
  ].join("");

  return {
    url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    viewport: { width: 960, height: 540 },
    waitUntil: "load",
    timeoutMs: 30_000,
    capture: {
      screenshot: true,
      html: true,
      console: true,
      metrics: true,
    },
  };
}

function createJobRequest(callbackUrl) {
  const id = randomUUID().slice(0, 8);
  const missionId = `agent-browser-smoke-${id}`;
  const jobId = `browser-smoke-${id}`;
  const now = new Date().toISOString();
  const browserTask = createBrowserTask();

  return {
    version: contractVersion,
    requestId: `req-${jobId}`,
    missionId,
    jobId,
    executor: "lobster",
    createdAt: now,
    traceId: randomUUID(),
    idempotencyKey: `idem-${jobId}`,
    plan: {
      version: contractVersion,
      missionId,
      summary: "Verify cube-ai-agent-sandbox browser tooling through lobster-executor real mode",
      objective: "Launch Chromium via Playwright and collect screenshot artifacts from the strong agent sandbox image.",
      requestedBy: "system",
      mode: "auto",
      steps: [
        {
          key: "browser-smoke",
          label: "Browser Smoke",
          description: "Run a deterministic Playwright screenshot job in Docker.",
        },
      ],
      jobs: [
        {
          id: jobId,
          key: "browser-smoke",
          label: "Browser screenshot smoke",
          description: "Use the strong agent image to render HTML and save screenshot artifacts.",
          kind: "execute",
          timeoutMs: 120_000,
          payload: {
            image,
            requiredCapabilities: [
              "runtime.docker",
              "browser.playwright",
              "browser.chromium",
              "artifact.image",
              "artifact.html",
              "artifact.json",
            ],
            browserTask,
            livePreview: {
              enabled: true,
              terminal: true,
              browser: true,
              screenshotIntervalMs: 1000,
              replayArtifacts: true,
              timeoutMs: 120_000,
            },
            env: {
              HOME: "/tmp",
              XDG_CONFIG_HOME: "/tmp/.config",
              XDG_CACHE_HOME: "/tmp/.cache",
              NODE_PATH: "/usr/local/lib/node_modules",
              PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/usr/bin/chromium",
            },
          },
        },
      ],
    },
    callback: {
      eventsUrl: callbackUrl,
      timeoutMs: 10_000,
      auth: makeAuth(),
    },
  };
}

async function waitForJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForExecutor() {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const { response, body } = await waitForJson(`${baseUrl}/health`);
      if (response.ok && body?.ok) return body;
      lastError = `${response.status} ${JSON.stringify(body).slice(0, 200)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for lobster-executor at ${baseUrl}: ${lastError}`);
}

async function waitForJob(jobId) {
  const deadline = Date.now() + 180_000;
  let lastJob;
  while (Date.now() < deadline) {
    const { response, body } = await waitForJson(`${baseUrl}/api/executor/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Job query failed: ${response.status} ${JSON.stringify(body)}`);
    }
    lastJob = body.job;
    if (["completed", "failed", "cancelled"].includes(lastJob.status)) {
      return lastJob;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${jobId}; last=${JSON.stringify(lastJob)}`);
}

async function waitForCallbackEvent(events, predicate, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = events.find(predicate);
    if (event) return event;
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for callback event: ${description}. Events: ${events.map(event => event.type).join(", ")}`,
  );
}

async function closeServer(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function startCallbackServer() {
  const events = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
    }
    try {
      const parsed = JSON.parse(body || "{}");
      if (parsed.event) events.push(parsed.event);
    } catch {
      // The callback payload is best-effort telemetry for this smoke.
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  return { server, events };
}

function startExecutor() {
  const tsxCli = resolve("node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(
    process.execPath,
    [tsxCli, "services/lobster-executor/src/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOBSTER_EXECUTION_MODE: "real",
        LOBSTER_AGENT_IMAGE: image,
        LOBSTER_DEFAULT_IMAGE: image,
        LOBSTER_EXECUTOR_HOST: host,
        LOBSTER_EXECUTOR_PORT: String(port),
        LOBSTER_EXECUTOR_DATA_ROOT: dataRoot,
        LOBSTER_SECURITY_LEVEL: "permissive",
        LOBSTER_MAX_MEMORY: "2g",
        LOBSTER_MAX_CPUS: "2",
        LOBSTER_MAX_PIDS: "512",
        EXECUTOR_CALLBACK_SECRET: callbackSecret,
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  child.stdout.on("data", chunk => {
    process.stdout.write(`[executor] ${chunk}`);
  });
  child.stderr.on("data", chunk => {
    process.stderr.write(`[executor:err] ${chunk}`);
  });

  return child;
}

async function stopChild(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  const exit = once(child, "exit");
  const timeout = sleep(5000).then(() => "timeout");
  const result = await Promise.race([exit, timeout]);
  if (result === "timeout" && !child.killed) {
    child.kill("SIGKILL");
  }
}

function assertArtifact(job, name) {
  const artifact = job.artifacts?.find(item => item.name === name);
  if (!artifact?.path) {
    throw new Error(`Missing artifact ${name}. Got: ${JSON.stringify(job.artifacts)}`);
  }
  const artifactPath = resolve(artifact.path);
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact ${name} path does not exist: ${artifactPath}`);
  }
  return artifactPath;
}

function assertArtifactMetadata(job, name, expected) {
  const artifact = job.artifacts?.find(item => item.name === name);
  if (!artifact) {
    throw new Error(`Missing artifact metadata for ${name}. Got: ${JSON.stringify(job.artifacts)}`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (artifact[key] !== value) {
      throw new Error(`Artifact ${name} expected ${key}=${value}, got ${artifact[key]}`);
    }
  }
}

async function main() {
  rmSync(dataRoot, { recursive: true, force: true });

  const callbackHarness = startCallbackServer();
  callbackHarness.server.listen(0, host);
  await once(callbackHarness.server, "listening");
  const callbackAddress = callbackHarness.server.address();
  if (!callbackAddress || typeof callbackAddress === "string") {
    throw new Error("Callback server did not expose a TCP address");
  }
  const callbackUrl = `http://${host}:${callbackAddress.port}/api/executor/events`;

  const executor = startExecutor();
  try {
    const health = await waitForExecutor();
    console.log(
      `[agent-executor-browser-smoke] Executor ready: mode=${health.capabilitiesSummary ? "real" : "unknown"} docker=${health.docker?.status}`,
    );

    const capabilitiesResponse = await waitForJson(`${baseUrl}/api/executor/capabilities`);
    if (!capabilitiesResponse.response.ok) {
      throw new Error(`Capabilities request failed: ${JSON.stringify(capabilitiesResponse.body)}`);
    }
    const capabilities = capabilitiesResponse.body.capabilities;
    for (const capability of ["runtime.docker", "browser.playwright", "artifact.image"]) {
      if (!capabilities.capabilities.includes(capability)) {
        throw new Error(`Capability ${capability} was not advertised by executor.`);
      }
    }

    const request = createJobRequest(callbackUrl);
    const submit = await waitForJson(`${baseUrl}/api/executor/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (submit.response.status !== 202) {
      throw new Error(`Job submit failed: ${submit.response.status} ${JSON.stringify(submit.body)}`);
    }

    console.log(`[agent-executor-browser-smoke] Submitted ${request.jobId}`);
    const job = await waitForJob(request.jobId);
    if (job.status !== "completed") {
      throw new Error(`Job ${request.jobId} ended as ${job.status}: ${job.errorCode || ""} ${job.errorMessage || job.message}`);
    }

    const screenshotPath = assertArtifact(job, "page-screenshot.png");
    const htmlPath = assertArtifact(job, "page.html");
    const consolePath = assertArtifact(job, "console.json");
    const metricsPath = assertArtifact(job, "browser-metrics.json");
    const manifestPath = assertArtifact(job, "artifact-manifest.json");
    const terminalLivePath = assertArtifact(job, "terminal-live.log");
    const replayFramePath = assertArtifact(job, "live-preview-frame-0001.png");
    assertArtifactMetadata(job, "page-screenshot.png", {
      id: "page-screenshot",
      mimeType: "image/png",
      previewType: "image",
    });
    assertArtifactMetadata(job, "page.html", {
      id: "page-html",
      mimeType: "text/html",
      previewType: "html",
    });
    const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
    if (metrics.ok !== true || metrics.title !== "Cube Executor Browser Smoke") {
      throw new Error(`Unexpected browser-metrics.json: ${JSON.stringify(metrics)}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length < 4) {
      throw new Error(`Unexpected artifact manifest: ${JSON.stringify(manifest)}`);
    }
    const previewStarted = await waitForCallbackEvent(
      callbackHarness.events,
      event => event.type === "job.started" && event.payload?.previewSession,
      "job.started with previewSession",
    );
    const previewCompleted = await waitForCallbackEvent(
      callbackHarness.events,
      event => event.type === "job.completed" && event.payload?.previewSession,
      "job.completed with previewSession",
    );
    await waitForCallbackEvent(
      callbackHarness.events,
      event => event.type === "job.log_stream",
      "job.log_stream",
    );
    await waitForCallbackEvent(
      callbackHarness.events,
      event => event.type === "job.screenshot",
      "job.screenshot",
    );
    const logStreamEvents = callbackHarness.events.filter(event => event.type === "job.log_stream");
    const screenshotEvents = callbackHarness.events.filter(event => event.type === "job.screenshot");
    if (logStreamEvents.length === 0) {
      throw new Error("Expected at least one job.log_stream callback event.");
    }
    if (screenshotEvents.length === 0) {
      throw new Error("Expected at least one job.screenshot callback event.");
    }

    console.log(`[agent-executor-browser-smoke] Completed ${request.jobId}`);
    console.log(`[agent-executor-browser-smoke] Screenshot: ${screenshotPath}`);
    console.log(`[agent-executor-browser-smoke] HTML: ${htmlPath}`);
    console.log(`[agent-executor-browser-smoke] Console: ${consolePath}`);
    console.log(`[agent-executor-browser-smoke] Metrics: ${metricsPath}`);
    console.log(`[agent-executor-browser-smoke] Manifest: ${manifestPath}`);
    console.log(`[agent-executor-browser-smoke] Terminal replay: ${terminalLivePath}`);
    console.log(`[agent-executor-browser-smoke] Preview frame: ${replayFramePath}`);
    console.log(`[agent-executor-browser-smoke] Live logs: ${logStreamEvents.length}`);
    console.log(`[agent-executor-browser-smoke] Live screenshots: ${screenshotEvents.length}`);
    console.log(`[agent-executor-browser-smoke] Callback events received: ${callbackHarness.events.length}`);
  } finally {
    await stopChild(executor);
    await closeServer(callbackHarness.server);
  }
}

main().catch(error => {
  console.error(
    `[agent-executor-browser-smoke] ${error instanceof Error ? error.stack || error.message : String(error)}`,
  );
  process.exitCode = 1;
});
