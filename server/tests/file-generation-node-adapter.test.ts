import path from "node:path";
import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeFileGenerationNode,
  persistFileGenerationArtifact,
  readFileGenerationPreview,
  resolveFileGenerationOutputAbsolutePath,
} from "../routes/node-adapters/file-generation-node-adapter.js";

const cleanupTargets = new Set<string>();

afterEach(async () => {
  await Promise.all(
    Array.from(cleanupTargets).map((target) =>
      rm(target, { recursive: true, force: true }),
    ),
  );
  cleanupTargets.clear();
});

describe("executeFileGenerationNode", () => {
  it("generates markdown artifact with preview and download metadata", async () => {
    const result = await executeFileGenerationNode({
      nodeType: "file_generation",
      input: {
        title: "周报总结",
        format: "md",
        content: "# 周报\n\n- 已完成 3 项工作",
        outputId: "file-gen-md-1",
        context: {
          traceId: "fg-1",
        },
      },
    });

    cleanupTargets.add(resolveFileGenerationOutputAbsolutePath("file-gen-md-1"));

    expect(result).toMatchObject({
      ok: true,
      nodeType: "file_generation",
      output: {
        status: "completed",
        format: "md",
        filename: "generated-artifact.md",
        content: "# 周报\n\n- 已完成 3 项工作",
        artifact: {
          outputId: "file-gen-md-1",
          artifact: {
            kind: "file",
            name: "generated-artifact.md",
            downloadUrl:
              "/api/file-generation/outputs/file-gen-md-1/generated-artifact.md?download=1",
            previewUrl:
              "/api/file-generation/outputs/file-gen-md-1/generated-artifact.md/preview",
          },
        },
        metadata: {
          title: "周报总结",
          artifactManaged: true,
          previewable: true,
          pathValidated: true,
        },
        context: {
          traceId: "fg-1",
        },
      },
    });
    expect(result.output.preview.inlineText).toContain("周报");
    expect(result.output.download.contentType).toContain("text/markdown");
    expect(result.output.observability).toMatchObject({
      eventKey: "content.file_generation",
      nodeType: "file_generation",
      format: "md",
      artifactManaged: true,
      previewable: true,
    });
  });

  it("serializes structured content as json and preserves artifact path", async () => {
    const result = await executeFileGenerationNode({
      nodeType: "file_generation",
      input: {
        filename: "report.json",
        format: "json",
        structuredContent: {
          workflowId: "wf-1",
          passed: true,
        },
        outputId: "file-gen-json-1",
      },
    });

    cleanupTargets.add(resolveFileGenerationOutputAbsolutePath("file-gen-json-1"));

    expect(result.output.filename).toBe("report.json");
    expect(result.output.content).toBe('{\n  "workflowId": "wf-1",\n  "passed": true\n}');
    expect(result.output.artifact.artifact.path).toBe(
      "tmp/web-aigc-file-generation/file-gen-json-1/report.json",
    );
    expect(result.output.download.contentType).toBe("application/json");
    expect(result.output.observability).toMatchObject({
      eventKey: "content.file_generation",
      nodeType: "file_generation",
      format: "json",
      artifactManaged: true,
      previewable: true,
    });
  });

  it("supports injected artifact writer and preview reader", async () => {
    const writeArtifactFile = vi.fn(async () => ({
      outputId: "custom-output",
      artifact: {
        kind: "file" as const,
        name: "summary.txt",
        path: "tmp/web-aigc-file-generation/custom-output/summary.txt",
        mimeType: "text/plain",
        downloadUrl: "/api/file-generation/outputs/custom-output/summary.txt?download=1",
        previewUrl: "/api/file-generation/outputs/custom-output/summary.txt/preview",
        description: "custom artifact",
      },
      absolutePath: path.join(process.cwd(), "tmp", "custom-output", "summary.txt"),
    }));
    const readArtifactPreview = vi.fn(async () => ({
      inlineText: "preview text",
      truncated: false,
      sizeBytes: 12,
      contentType: "text/plain",
    }));

    const result = await executeFileGenerationNode(
      {
        nodeType: "file_generation",
        input: {
          format: "txt",
          content: "plain summary",
        },
      },
      {
        writeArtifactFile,
        readArtifactPreview,
      },
    );

    expect(writeArtifactFile).toHaveBeenCalledWith({
      outputId: undefined,
      filename: "generated-artifact.txt",
      content: "plain summary",
    });
    expect(readArtifactPreview).toHaveBeenCalled();
    expect(result.output.preview.inlineText).toBe("preview text");
    expect(result.output.artifact.outputId).toBe("custom-output");
    expect(result.output.observability).toMatchObject({
      eventKey: "content.file_generation",
      nodeType: "file_generation",
      format: "txt",
      artifactManaged: true,
      previewable: true,
      sizeBytes: 12,
    });
  });

  it("rejects missing content and structuredContent", async () => {
    await expect(
      executeFileGenerationNode({
        nodeType: "file_generation",
        input: {
          format: "txt",
        },
      }),
    ).rejects.toThrow(/requires content or structuredcontent/i);
  });

  it("persists previewable text artifacts and rejects traversal segments", async () => {
    const persisted = await persistFileGenerationArtifact({
      outputId: "safe-output",
      filename: "notes.txt",
      content: "hello world",
    });
    cleanupTargets.add(resolveFileGenerationOutputAbsolutePath("safe-output"));

    const preview = await readFileGenerationPreview(persisted.absolutePath);
    expect(preview.inlineText).toBe("hello world");
    expect(preview.truncated).toBe(false);

    await expect(
      persistFileGenerationArtifact({
        outputId: "../escape",
        filename: "notes.txt",
        content: "bad",
      }),
    ).rejects.toThrow(/invalid file generation output path segment/i);
  });
});
