export const WEB_AIGC_FILE_GENERATION_API = {
  EXECUTE: "POST /api/file-generation/nodes/execute",
  DOWNLOAD: "GET /api/file-generation/outputs/:outputId/:filename",
  PREVIEW: "GET /api/file-generation/outputs/:outputId/:filename/preview",
} as const;

export const WEB_AIGC_FILE_GENERATION_NODE_TYPES = [
  "file_generation",
] as const;

export type FileGenerationNodeType =
  (typeof WEB_AIGC_FILE_GENERATION_NODE_TYPES)[number];

export const WEB_AIGC_FILE_GENERATION_FORMATS = [
  "txt",
  "md",
  "json",
] as const;

export type WebAigcFileGenerationFormat =
  (typeof WEB_AIGC_FILE_GENERATION_FORMATS)[number];

export interface WebAigcFileGenerationArtifact {
  kind: "file";
  name: string;
  path: string;
  mimeType: string;
  downloadUrl: string;
  previewUrl: string;
  description: string;
}

export interface FileGenerationNodeInput {
  title?: string;
  filename?: string;
  format?: WebAigcFileGenerationFormat;
  content?: string;
  structuredContent?: unknown;
  template?: string;
  outputId?: string;
  context?: Record<string, unknown>;
}

export interface FileGenerationNodeExecutionRequest {
  nodeType: FileGenerationNodeType;
  input?: FileGenerationNodeInput;
}

export interface FileGenerationNodeExecutionResult {
  ok: true;
  nodeType: FileGenerationNodeType;
  output: {
    status: "completed";
    format: WebAigcFileGenerationFormat;
    filename: string;
    content: string;
    artifact: {
      outputId: string;
      artifact: WebAigcFileGenerationArtifact;
    };
    preview: {
      contentType: string;
      inlineText: string;
      truncated: boolean;
      sizeBytes: number;
    };
    download: {
      href: string;
      filename: string;
      contentType: string;
    };
    metadata: {
      title?: string;
      artifactManaged: true;
      previewable: boolean;
      pathValidated: true;
      sizeBytes: number;
    };
    context: Record<string, unknown>;
    observability: {
      eventKey: "content.file_generation";
      nodeType: FileGenerationNodeType;
      format: WebAigcFileGenerationFormat;
      artifactManaged: true;
      previewable: boolean;
      sizeBytes: number;
    };
  };
}
