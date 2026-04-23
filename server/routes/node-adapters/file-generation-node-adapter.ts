import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getMimeType, isTextMime, validateArtifactPath } from "../artifact-utils.js";
import type {
  FileGenerationNodeExecutionRequest,
  FileGenerationNodeExecutionResult,
  FileGenerationNodeInput,
  FileGenerationNodeType,
  WebAigcFileGenerationArtifact,
  WebAigcFileGenerationFormat,
} from "../../../shared/web-aigc-file-generation.js";

const FILE_GENERATION_ROOT = path.join(
  process.cwd(),
  "tmp",
  "web-aigc-file-generation",
);
const MAX_PREVIEW_BYTES = 64 * 1024;

export class FileGenerationNodeError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "FileGenerationNodeError";
    this.status = status;
  }
}

export interface FileGenerationNodeAdapterDeps {
  writeArtifactFile?: (
    input: {
      outputId?: string;
      filename: string;
      content: string;
    },
  ) => Promise<{
    outputId: string;
    artifact: WebAigcFileGenerationArtifact;
    absolutePath: string;
  }>;
  readArtifactPreview?: (
    absolutePath: string,
  ) => Promise<{
    inlineText: string;
    truncated: boolean;
    sizeBytes: number;
    contentType: string;
  }>;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function normalizeFormat(value: unknown): WebAigcFileGenerationFormat {
  if (value === "json" || value === "txt") {
    return value;
  }

  return "md";
}

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "artifact";
}

export function validateFileGenerationSegment(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

export function resolveFileGenerationOutputAbsolutePath(
  outputId: string,
  filename?: string,
): string {
  const outputDirectory = path.join(FILE_GENERATION_ROOT, sanitizeSegment(outputId));
  return filename
    ? path.join(outputDirectory, sanitizeSegment(filename))
    : outputDirectory;
}

function toRepoRelativePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

function stringifyStructuredContent(value: unknown): string {
  return JSON.stringify(
    value === undefined ? null : value,
    (_key, candidate) => {
      if (typeof candidate === "bigint") {
        return candidate.toString();
      }
      if (typeof candidate === "function" || typeof candidate === "symbol") {
        return String(candidate);
      }
      return candidate;
    },
    2,
  );
}

function buildContent(input: FileGenerationNodeInput, format: WebAigcFileGenerationFormat): string {
  if (format === "json") {
    if (input.structuredContent !== undefined) {
      return stringifyStructuredContent(input.structuredContent);
    }

    const content = normalizeString(input.content);
    if (!content) {
      throw new FileGenerationNodeError(
        400,
        "File generation requires content or structuredContent.",
      );
    }

    try {
      return stringifyStructuredContent(JSON.parse(content));
    } catch {
      return stringifyStructuredContent({ content });
    }
  }

  const content = normalizeString(input.content);
  if (content) {
    return content;
  }

  if (input.structuredContent !== undefined) {
    if (format === "md") {
      return ["```json", stringifyStructuredContent(input.structuredContent), "```"].join("\n");
    }
    return stringifyStructuredContent(input.structuredContent);
  }

  throw new FileGenerationNodeError(
    400,
    "File generation requires content or structuredContent.",
  );
}

function resolveExtension(format: WebAigcFileGenerationFormat): string {
  if (format === "json") {
    return ".json";
  }
  if (format === "txt") {
    return ".txt";
  }
  return ".md";
}

function buildFilename(
  input: FileGenerationNodeInput,
  format: WebAigcFileGenerationFormat,
): string {
  const requested = normalizeString(input.filename);
  const baseName = requested || "generated-artifact";
  const safeName = sanitizeSegment(baseName.replace(/\.[^.]+$/, ""));
  return `${safeName}${resolveExtension(format)}`;
}

function buildArtifactDescriptor(
  outputId: string,
  filename: string,
  absolutePath: string,
): WebAigcFileGenerationArtifact {
  return {
    kind: "file",
    name: filename,
    path: toRepoRelativePath(absolutePath),
    mimeType: getMimeType(filename),
    downloadUrl: `/api/file-generation/outputs/${encodeURIComponent(outputId)}/${encodeURIComponent(filename)}?download=1`,
    previewUrl: `/api/file-generation/outputs/${encodeURIComponent(outputId)}/${encodeURIComponent(filename)}/preview`,
    description: `File generation output artifact (${filename})`,
  };
}

export async function persistFileGenerationArtifact(input: {
  outputId?: string;
  filename: string;
  content: string;
}): Promise<{
  outputId: string;
  artifact: WebAigcFileGenerationArtifact;
  absolutePath: string;
}> {
  const requestedOutputId = input.outputId || `file_${randomUUID()}`;
  const requestedFilename = input.filename;

  if (
    !validateFileGenerationSegment(requestedOutputId) ||
    !validateFileGenerationSegment(requestedFilename)
  ) {
    throw new FileGenerationNodeError(400, "Invalid file generation output path segment.");
  }
  const outputId = sanitizeSegment(requestedOutputId);
  const filename = sanitizeSegment(requestedFilename);

  const relativePath = `tmp/web-aigc-file-generation/${outputId}/${filename}`;
  if (!validateArtifactPath(relativePath)) {
    throw new FileGenerationNodeError(403, "Path traversal not allowed.");
  }

  const absolutePath = resolveFileGenerationOutputAbsolutePath(outputId, filename);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.content, "utf-8");

  return {
    outputId,
    artifact: buildArtifactDescriptor(outputId, filename, absolutePath),
    absolutePath,
  };
}

export async function readFileGenerationPreview(absolutePath: string): Promise<{
  inlineText: string;
  truncated: boolean;
  sizeBytes: number;
  contentType: string;
}> {
  const filename = path.basename(absolutePath);
  const contentType = getMimeType(filename);
  if (!isTextMime(contentType)) {
    throw new FileGenerationNodeError(415, "Binary files cannot be previewed");
  }

  const fileStats = await stat(absolutePath);
  const content = await readFile(absolutePath, "utf-8");
  const truncated = Buffer.byteLength(content, "utf-8") > MAX_PREVIEW_BYTES;
  const inlineText = truncated
    ? Buffer.from(content, "utf-8").subarray(0, MAX_PREVIEW_BYTES).toString("utf-8")
    : content;

  return {
    inlineText,
    truncated,
    sizeBytes: fileStats.size,
    contentType,
  };
}

export function isFileGenerationNodeType(value: unknown): value is FileGenerationNodeType {
  return value === "file_generation";
}

export async function executeFileGenerationNode(
  request: FileGenerationNodeExecutionRequest,
  deps: FileGenerationNodeAdapterDeps = {},
): Promise<FileGenerationNodeExecutionResult> {
  if (!isFileGenerationNodeType(request.nodeType)) {
    throw new FileGenerationNodeError(400, "Unsupported file_generation node type.");
  }

  const input = request.input ?? {};
  const format = normalizeFormat(input.format);
  const filename = buildFilename(input, format);
  const content = buildContent(input, format);
  const writeArtifactFile = deps.writeArtifactFile ?? persistFileGenerationArtifact;
  const readArtifactPreview = deps.readArtifactPreview ?? readFileGenerationPreview;
  const persisted = await writeArtifactFile({
    outputId: normalizeString(input.outputId),
    filename,
    content,
  });

  const preview = await readArtifactPreview(persisted.absolutePath);

  return {
    ok: true,
    nodeType: "file_generation",
    output: {
      status: "completed",
      format,
      filename,
      content,
      artifact: {
        outputId: persisted.outputId,
        artifact: persisted.artifact,
      },
      preview,
      download: {
        href: persisted.artifact.downloadUrl,
        filename,
        contentType: persisted.artifact.mimeType,
      },
      metadata: {
        ...(normalizeString(input.title) ? { title: normalizeString(input.title) } : {}),
        artifactManaged: true,
        previewable: true,
        pathValidated: true,
        sizeBytes: preview.sizeBytes,
      },
      context: normalizeObject(input.context),
      observability: {
        eventKey: "content.file_generation",
        nodeType: "file_generation",
        format,
        artifactManaged: true,
        previewable: true,
        sizeBytes: preview.sizeBytes,
      },
    },
  };
}
