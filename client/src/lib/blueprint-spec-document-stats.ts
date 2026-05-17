import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

export const SPEC_DOCUMENT_TYPES = [
  "requirements",
  "design",
  "tasks",
] as const satisfies readonly BlueprintSpecDocumentType[];

export type SpecDocumentNodeLifecycle =
  | "empty"
  | "partial"
  | "complete"
  | "generating";

export interface SpecDocumentNodeStats {
  nodeId: string;
  total: number;
  generated: number;
  documents: BlueprintSpecDocument[];
  missingTypes: BlueprintSpecDocumentType[];
  lifecycle: SpecDocumentNodeLifecycle;
}

export interface SpecDocumentTreeStats {
  totalNodes: number;
  totalDocuments: number;
  generatedDocuments: number;
  completeNodes: number;
  documents: BlueprintSpecDocument[];
  byNodeId: Map<string, SpecDocumentNodeStats>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isSpecDocumentType(
  value: unknown
): value is BlueprintSpecDocumentType {
  return SPEC_DOCUMENT_TYPES.includes(value as BlueprintSpecDocumentType);
}

export function extractSpecDocumentsFromJob(
  job: BlueprintGenerationJob | null | undefined
): BlueprintSpecDocument[] {
  return (job?.artifacts ?? [])
    .map(artifact => {
      if (!isSpecDocumentType(artifact.type)) return null;
      if (!isRecord(artifact.payload)) return null;

      const nodeId = readString(artifact.payload.nodeId);
      const payloadType = readString(artifact.payload.type);
      const type = isSpecDocumentType(payloadType)
        ? payloadType
        : artifact.type;

      if (!nodeId) return null;

      return {
        ...artifact.payload,
        nodeId,
        type,
      } as unknown as BlueprintSpecDocument;
    })
    .filter((document): document is BlueprintSpecDocument => document !== null);
}

export function deriveSpecDocumentTreeStatsFromDocuments(
  documents: readonly BlueprintSpecDocument[],
  specTree: BlueprintSpecTree | null | undefined,
  options: { generating?: boolean } = {}
): SpecDocumentTreeStats {
  const nodes = specTree?.nodes ?? [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const latestByNodeAndType = new Map<string, BlueprintSpecDocument>();

  for (const document of documents) {
    if (!nodeIds.has(document.nodeId) || !isSpecDocumentType(document.type)) {
      continue;
    }
    latestByNodeAndType.set(`${document.nodeId}:${document.type}`, document);
  }

  const byNodeId = new Map<string, SpecDocumentNodeStats>();
  let generatedDocuments = 0;
  let completeNodes = 0;

  for (const node of nodes) {
    const nodeDocuments = SPEC_DOCUMENT_TYPES.map(type =>
      latestByNodeAndType.get(`${node.id}:${type}`)
    ).filter((document): document is BlueprintSpecDocument =>
      Boolean(document)
    );
    const generated = nodeDocuments.length;
    const missingTypes = SPEC_DOCUMENT_TYPES.filter(
      type => !latestByNodeAndType.has(`${node.id}:${type}`)
    );
    const lifecycle: SpecDocumentNodeLifecycle =
      generated === SPEC_DOCUMENT_TYPES.length
        ? "complete"
        : options.generating
          ? "generating"
          : generated > 0
            ? "partial"
            : "empty";

    generatedDocuments += generated;
    if (generated === SPEC_DOCUMENT_TYPES.length) {
      completeNodes += 1;
    }

    byNodeId.set(node.id, {
      nodeId: node.id,
      total: SPEC_DOCUMENT_TYPES.length,
      generated,
      documents: nodeDocuments,
      missingTypes,
      lifecycle,
    });
  }

  return {
    totalNodes: nodes.length,
    totalDocuments: nodes.length * SPEC_DOCUMENT_TYPES.length,
    generatedDocuments,
    completeNodes,
    documents: [...latestByNodeAndType.values()],
    byNodeId,
  };
}

export function deriveSpecDocumentTreeStats(
  job: BlueprintGenerationJob | null | undefined,
  specTree: BlueprintSpecTree | null | undefined
): SpecDocumentTreeStats {
  return deriveSpecDocumentTreeStatsFromDocuments(
    extractSpecDocumentsFromJob(job),
    specTree,
    {
      generating:
        job?.stage === "spec_docs" &&
        (job.status === "running" || job.status === "pending"),
    }
  );
}
