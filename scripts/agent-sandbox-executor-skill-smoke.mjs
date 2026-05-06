import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const image = process.env.LOBSTER_AGENT_IMAGE || "cube-ai-agent-sandbox:latest";
const port = Number.parseInt(process.env.AGENT_EXECUTOR_SKILL_SMOKE_PORT || "3134", 10);
const host = "127.0.0.1";
const dataRoot = resolve("tmp", "agent-sandbox-executor-skill-smoke");
const baseUrl = `http://${host}:${port}`;
const callbackSecret = "agent-sandbox-skill-smoke-secret";
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

function createJobRequest(callbackUrl, skillRef, skillInput, requiredCapabilities) {
  const id = randomUUID().slice(0, 8);
  const missionId = `agent-skill-smoke-${id}`;
  const jobId = `${skillRef.name}-smoke-${id}`;
  const now = new Date().toISOString();

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
      summary: `Verify sandbox skill ${skillRef.name}`,
      objective: "Run a local sandbox skill inside the strong agent sandbox image.",
      requestedBy: "system",
      mode: "auto",
      steps: [
        {
          key: "skill-smoke",
          label: "Skill Smoke",
          description: "Run a local skill through skillRef and collect artifacts.",
        },
      ],
      jobs: [
        {
          id: jobId,
          key: "skill-smoke",
          label: `${skillRef.name} smoke`,
          description: "Use lobster-executor skill injection to execute a local skill.",
          kind: "execute",
          timeoutMs: 120_000,
          payload: {
            image,
            requiredCapabilities,
            skillRef,
            skillInput,
            skillPolicy: {
              allowNetwork: true,
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
      // Best-effort telemetry.
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

async function runSkill(callbackUrl, skillRef, skillInput, requiredCapabilities, expectedArtifacts) {
  const request = createJobRequest(
    callbackUrl,
    skillRef,
    skillInput,
    requiredCapabilities,
  );
  const submit = await waitForJson(`${baseUrl}/api/executor/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (submit.response.status !== 202) {
    throw new Error(`Job submit failed: ${submit.response.status} ${JSON.stringify(submit.body)}`);
  }

  console.log(`[agent-executor-skill-smoke] Submitted ${request.jobId}`);
  const job = await waitForJob(request.jobId);
  if (job.status !== "completed") {
    throw new Error(`Job ${request.jobId} ended as ${job.status}: ${job.errorCode || ""} ${job.errorMessage || job.message}`);
  }

  const paths = expectedArtifacts.map(name => assertArtifact(job, name));
  const manifestPath = assertArtifact(job, "artifact-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length < expectedArtifacts.length) {
    throw new Error(`Unexpected artifact manifest: ${JSON.stringify(manifest)}`);
  }
  console.log(`[agent-executor-skill-smoke] Completed ${request.jobId}`);
  for (const artifactPath of paths) {
    console.log(`[agent-executor-skill-smoke] Artifact: ${artifactPath}`);
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
      `[agent-executor-skill-smoke] Executor ready: docker=${health.docker?.status}`,
    );

    const skillsResponse = await waitForJson(`${baseUrl}/api/executor/skills`);
    if (!skillsResponse.response.ok) {
      throw new Error(`Skills request failed: ${JSON.stringify(skillsResponse.body)}`);
    }
    for (const skillName of ["browser-research", "document-render"]) {
      if (!skillsResponse.body.skills?.some(skill => skill.name === skillName)) {
        throw new Error(`Skill ${skillName} was not advertised by executor.`);
      }
    }

    await runSkill(
      callbackUrl,
      { name: "document-render", version: "0.1.0" },
      {
        title: "Cube Skill Smoke",
        markdown: "# Cube Skill Smoke\n\nDocument render skill executed in Docker.",
      },
      ["runtime.docker", "artifact.html", "artifact.json", "preview.html"],
      ["document.html", "document.pdf", "document-report.json"],
    );

    await runSkill(
      callbackUrl,
      { name: "browser-research", version: "0.1.0" },
      {
        url: "data:text/html;charset=utf-8,%3Ctitle%3ECube%20Skill%20Browser%3C%2Ftitle%3E%3Ch1%3ECube%20Skill%20Browser%3C%2Fh1%3E",
        viewport: { width: 960, height: 540 },
      },
      ["runtime.docker", "browser.playwright", "browser.chromium", "artifact.image"],
      ["page-screenshot.png", "page.html", "browser-report.json"],
    );

    console.log(
      `[agent-executor-skill-smoke] Callback events received: ${callbackHarness.events.length}`,
    );
  } finally {
    await stopChild(executor);
    await closeServer(callbackHarness.server);
  }
}

main().catch(error => {
  console.error(
    `[agent-executor-skill-smoke] ${error instanceof Error ? error.stack || error.message : String(error)}`,
  );
  process.exitCode = 1;
});
