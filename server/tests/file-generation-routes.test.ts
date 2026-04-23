import path from "node:path";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { createFileGenerationRouter } from "../routes/file-generation.js";
import { resolveFileGenerationOutputAbsolutePath } from "../routes/node-adapters/file-generation-node-adapter.js";

const cleanupTargets = new Set<string>();

afterEach(async () => {
  await Promise.all(
    Array.from(cleanupTargets).map((target) =>
      rm(target, { recursive: true, force: true }),
    ),
  );
  cleanupTargets.clear();
});

async function withServer(
  deps: Parameters<typeof createFileGenerationRouter>[0] = {},
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/file-generation", createFileGenerationRouter(deps));
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("file generation routes", () => {
  it("POST /api/file-generation/nodes/execute returns artifact metadata", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file-generation/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "file_generation",
          input: {
            format: "txt",
            title: "日报",
            content: "今日完成 5 项任务",
            outputId: "route-file-gen-1",
          },
        }),
      });

      cleanupTargets.add(resolveFileGenerationOutputAbsolutePath("route-file-gen-1"));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.output.status).toBe("completed");
      expect(body.output.artifact.artifact.downloadUrl).toBe(
        "/api/file-generation/outputs/route-file-gen-1/generated-artifact.txt?download=1",
      );
      expect(body.output.artifact.artifact.previewUrl).toBe(
        "/api/file-generation/outputs/route-file-gen-1/generated-artifact.txt/preview",
      );
    });
  });

  it("POST /api/file-generation/nodes/execute returns 400 for invalid node type or empty content", async () => {
    await withServer({}, async (baseUrl) => {
      const invalidNodeTypeResponse = await fetch(
        `${baseUrl}/api/file-generation/nodes/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: "dialogue",
            input: {
              content: "x",
            },
          }),
        },
      );
      expect(invalidNodeTypeResponse.status).toBe(400);

      const invalidContentResponse = await fetch(
        `${baseUrl}/api/file-generation/nodes/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: "file_generation",
            input: {
              format: "txt",
            },
          }),
        },
      );
      expect(invalidContentResponse.status).toBe(400);
      const body = await invalidContentResponse.json();
      expect(body.error).toContain("requires content or structuredContent");
    });
  });

  it("GET download and preview routes serve generated files with safe path validation", async () => {
    const outputRoot = resolveFileGenerationOutputAbsolutePath("download-preview-1");
    const absolutePath = resolveFileGenerationOutputAbsolutePath(
      "download-preview-1",
      "artifact.md",
    );
    cleanupTargets.add(outputRoot);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "# Preview\n\nhello", "utf-8");

    await withServer({}, async (baseUrl) => {
      const previewResponse = await fetch(
        `${baseUrl}/api/file-generation/outputs/download-preview-1/artifact.md/preview`,
      );
      expect(previewResponse.status).toBe(200);
      expect(previewResponse.headers.get("content-type")).toContain("text/markdown");
      expect(await previewResponse.text()).toContain("Preview");

      const downloadResponse = await fetch(
        `${baseUrl}/api/file-generation/outputs/download-preview-1/artifact.md?download=1`,
      );
      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.headers.get("content-disposition")).toContain(
        'attachment; filename="artifact.md"',
      );

      const invalidPathResponse = await fetch(
        `${baseUrl}/api/file-generation/outputs/../escape/artifact.md/preview`,
      );
      expect(invalidPathResponse.status).toBe(404);
    });
  });
});
