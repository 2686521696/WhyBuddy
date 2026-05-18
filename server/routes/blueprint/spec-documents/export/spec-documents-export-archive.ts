/**
 * `autopilot-spec-document-export` Task 2.1：SPEC 文档导出归档服务层。
 *
 * 把 `BlueprintSpecDocument[]` 按 single / node / tree 颗粒度组装成
 * markdown 字符串或 zip Uint8Array。永不抛错；找不到资源 / 缺字段时
 * 返回 `kind: "not_found" | "invalid_request"`，路由层映射 HTTP 状态。
 *
 * 与 design.md `## 组件与接口 > 2. 后端：服务层` 一致；规则源自 Req
 * 1.1-1.10 与 4.2、4.3。
 *
 * 依赖容器只暴露最小读路径，便于在测试中以 fake 替换 store。
 */

import JSZip from "jszip";

import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTreeNode,
} from "../../../../../shared/blueprint/index.js";

import { sanitizeFilenameSegment } from "./sanitize-filename-segment.js";

// ─── 公共类型 ────────────────────────────────────────────────────────────

/** 导出颗粒度枚举。 */
export type SpecExportGranularity = "single" | "node" | "tree";

/** 文档类型枚举（与 BlueprintSpecDocumentType 对齐）。 */
const SPEC_DOC_TYPES: ReadonlyArray<BlueprintSpecDocumentType> = [
  "requirements",
  "design",
  "tasks",
];

const VALID_GRANULARITIES: ReadonlyArray<SpecExportGranularity> = [
  "single",
  "node",
  "tree",
];

/** 导出请求载荷。 */
export interface SpecExportRequest {
  jobId: string;
  granularity: string | undefined;
  nodeId?: string;
  type?: string;
}

/** 导出归档结果。 */
export interface SpecExportArchiveResult {
  /** "text/markdown; charset=utf-8" 或 "application/zip"。 */
  contentType: string;
  /** 用于 Content-Disposition 的 ASCII filename（已 sanitize）。 */
  filename: string;
  /** 单文档时为 string；zip 时为 Uint8Array。 */
  body: string | Uint8Array;
}

/** 服务层返回壳——区分成功 / 业务 4xx 三种 kind。 */
export type BuildSpecExportResult =
  | { kind: "ok"; archive: SpecExportArchiveResult }
  | { kind: "not_found"; message: string; details?: Record<string, unknown> }
  | { kind: "invalid_request"; message: string };

/** 服务层依赖容器；最小读路径，方便测试替换。 */
export interface BuildSpecExportDeps {
  /** 取 job；不存在返回 null。 */
  getJob: (jobId: string) => BlueprintGenerationJob | null;
  /** 取该 job 的全部 spec documents（已包含 requirements / design / tasks 三类）。 */
  listSpecDocuments: (jobId: string) => ReadonlyArray<BlueprintSpecDocument>;
  /** 时钟函数；MANIFEST.json 的 exportedAt 字段使用，便于测试期注入。 */
  now: () => Date;
}

// ─── 主入口 ──────────────────────────────────────────────────────────────

export async function buildSpecExportArchive(
  request: SpecExportRequest,
  deps: BuildSpecExportDeps,
): Promise<BuildSpecExportResult> {
  // 1. 校验 granularity
  const granularity = request.granularity;
  if (
    typeof granularity !== "string" ||
    !VALID_GRANULARITIES.includes(granularity as SpecExportGranularity)
  ) {
    return {
      kind: "invalid_request",
      message: "granularity must be one of single, node, tree",
    };
  }

  // 2. 校验对应颗粒度的必填参数（不读 store）
  if (granularity === "single") {
    if (!isNonEmptyString(request.nodeId) || !isValidDocType(request.type)) {
      return {
        kind: "invalid_request",
        message: "single export requires nodeId and type",
      };
    }
  } else if (granularity === "node") {
    if (!isNonEmptyString(request.nodeId)) {
      return {
        kind: "invalid_request",
        message: "node export requires nodeId",
      };
    }
  }

  // 3. 校验 job 存在
  const job = deps.getJob(request.jobId);
  if (!job) {
    return {
      kind: "not_found",
      message: "blueprint job not found",
      details: { jobId: request.jobId },
    };
  }

  // 4. 拉取该 job 的 spec documents
  const documents = deps.listSpecDocuments(request.jobId);

  // 5. 按 granularity 分流
  if (granularity === "single") {
    return buildSingleArchive(
      documents,
      request.jobId,
      request.nodeId as string,
      request.type as BlueprintSpecDocumentType,
    );
  }

  if (granularity === "node") {
    return buildNodeArchive(
      documents,
      request.jobId,
      request.nodeId as string,
      job,
      deps.now(),
    );
  }

  return buildTreeArchive(documents, request.jobId, job, deps.now());
}

// ─── single ──────────────────────────────────────────────────────────────

async function buildSingleArchive(
  documents: ReadonlyArray<BlueprintSpecDocument>,
  jobId: string,
  nodeId: string,
  type: BlueprintSpecDocumentType,
): Promise<BuildSpecExportResult> {
  const matching = documents.find(
    (doc) => doc.nodeId === nodeId && doc.type === type,
  );
  if (!matching) {
    return {
      kind: "not_found",
      message: "spec document not found",
      details: { jobId, nodeId, type },
    };
  }

  const baseName = sanitizeFilenameSegment(matching.provenance.nodeTitle ?? matching.title);
  const filename = `${baseName}-${type}.md`;
  return {
    kind: "ok",
    archive: {
      contentType: "text/markdown; charset=utf-8",
      filename,
      body: matching.content,
    },
  };
}

// ─── node ────────────────────────────────────────────────────────────────

async function buildNodeArchive(
  documents: ReadonlyArray<BlueprintSpecDocument>,
  jobId: string,
  nodeId: string,
  job: BlueprintGenerationJob,
  now: Date,
): Promise<BuildSpecExportResult> {
  const nodeDocs = documents.filter((doc) => doc.nodeId === nodeId);
  if (nodeDocs.length === 0) {
    return {
      kind: "not_found",
      message: "no spec documents to export",
      details: { jobId, nodeId },
    };
  }

  const nodeTitle =
    nodeDocs[0].provenance.nodeTitle ??
    findNodeTitleFromJob(job, nodeId) ??
    nodeId;
  const segment = sanitizeFilenameSegment(nodeTitle);

  const zip = new JSZip();
  const folder = zip.folder(segment);
  if (!folder) {
    // 理论上不会发生；jszip folder() 在合法 segment 下总返回 ZipObject
    return {
      kind: "not_found",
      message: "failed to allocate zip folder",
      details: { jobId, nodeId, segment },
    };
  }

  const manifestEntries: ManifestEntry[] = [];
  for (const docType of SPEC_DOC_TYPES) {
    const matching = nodeDocs.find((doc) => doc.type === docType);
    if (!matching) continue;
    const filename = `${docType}.md`;
    folder.file(filename, matching.content);
    manifestEntries.push({
      nodeId,
      nodeTitle,
      type: docType,
      filename: `${segment}/${filename}`,
      generationSource: matching.provenance.generationSource ?? "template",
    });
  }

  const manifest = buildManifest({
    jobId,
    granularity: "node",
    exportedAt: now,
    nodeIds: [nodeId],
    documents: manifestEntries,
  });
  zip.file("MANIFEST.json", manifest);

  const body = await zip.generateAsync({ type: "uint8array" });
  return {
    kind: "ok",
    archive: {
      contentType: "application/zip",
      filename: `${segment}-spec.zip`,
      body,
    },
  };
}

// ─── tree ────────────────────────────────────────────────────────────────

async function buildTreeArchive(
  documents: ReadonlyArray<BlueprintSpecDocument>,
  jobId: string,
  job: BlueprintGenerationJob,
  now: Date,
): Promise<BuildSpecExportResult> {
  if (documents.length === 0) {
    return {
      kind: "not_found",
      message: "no spec documents to export",
      details: { jobId },
    };
  }

  const zip = new JSZip();
  const usedSegments = new Map<string, string>(); // raw nodeTitle -> resolved segment（含碰撞 suffix）
  const manifestEntries: ManifestEntry[] = [];
  const seenNodeIds = new Set<string>();

  // 4.2 同名碰撞处理：先把每个 nodeTitle 解析成稳定 segment
  for (const doc of documents) {
    const rawTitle = doc.provenance.nodeTitle ?? doc.nodeId;
    if (!usedSegments.has(rawTitle + "::" + doc.nodeId)) {
      const baseSegment = sanitizeFilenameSegment(rawTitle);
      // 检查 baseSegment 是否被其他 nodeId 占用
      const collidingExisting = Array.from(usedSegments.entries()).find(
        ([key, seg]) => seg === baseSegment && key !== rawTitle + "::" + doc.nodeId,
      );
      let resolved = baseSegment;
      if (collidingExisting) {
        resolved = `${baseSegment}-${doc.nodeId.slice(0, 6)}`;
      }
      usedSegments.set(rawTitle + "::" + doc.nodeId, resolved);
    }
  }

  for (const doc of documents) {
    const rawTitle = doc.provenance.nodeTitle ?? doc.nodeId;
    const segment = usedSegments.get(rawTitle + "::" + doc.nodeId) as string;
    const filename = `${doc.type}.md`;
    zip.file(`${segment}/${filename}`, doc.content);
    manifestEntries.push({
      nodeId: doc.nodeId,
      nodeTitle: rawTitle,
      type: doc.type,
      filename: `${segment}/${filename}`,
      generationSource: doc.provenance.generationSource ?? "template",
    });
    seenNodeIds.add(doc.nodeId);
  }

  const manifest = buildManifest({
    jobId,
    granularity: "tree",
    exportedAt: now,
    nodeIds: Array.from(seenNodeIds),
    documents: manifestEntries,
  });
  zip.file("MANIFEST.json", manifest);

  const featureName = sanitizeFilenameSegment(
    findRootNodeTitle(job) ?? "blueprint-spec",
  );
  const body = await zip.generateAsync({ type: "uint8array" });
  return {
    kind: "ok",
    archive: {
      contentType: "application/zip",
      filename: `${featureName}-spec.zip`,
      body,
    },
  };
}

// ─── 内部 helper ─────────────────────────────────────────────────────────

interface ManifestEntry {
  nodeId: string;
  nodeTitle: string;
  type: BlueprintSpecDocumentType;
  filename: string;
  generationSource: string;
}

function buildManifest(input: {
  jobId: string;
  granularity: SpecExportGranularity;
  exportedAt: Date;
  nodeIds: ReadonlyArray<string>;
  documents: ReadonlyArray<ManifestEntry>;
}): string {
  return JSON.stringify(
    {
      jobId: input.jobId,
      exportedAt: input.exportedAt.toISOString(),
      granularity: input.granularity,
      nodeIds: input.nodeIds,
      documents: input.documents,
    },
    null,
    2,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidDocType(value: unknown): value is BlueprintSpecDocumentType {
  return (
    typeof value === "string" &&
    SPEC_DOC_TYPES.includes(value as BlueprintSpecDocumentType)
  );
}

/**
 * 在 job.artifacts 中查 spec_tree artifact 的 root 节点 title。用于
 * 整树导出 zip filename 派生。失败回退 undefined。
 */
function findRootNodeTitle(job: BlueprintGenerationJob): string | undefined {
  const treeArtifact = job.artifacts.find(
    (artifact) => artifact.type === "spec_tree",
  );
  if (!treeArtifact) return undefined;
  const payload = treeArtifact.payload as
    | { rootNodeId?: string; nodes?: ReadonlyArray<BlueprintSpecTreeNode> }
    | undefined;
  if (!payload || !payload.nodes) return undefined;
  const root = payload.nodes.find((node) => node.id === payload.rootNodeId);
  return root?.title;
}

/**
 * 在 job.artifacts.spec_tree.nodes 中按 nodeId 查 title。失败回退 undefined。
 */
function findNodeTitleFromJob(
  job: BlueprintGenerationJob,
  nodeId: string,
): string | undefined {
  const treeArtifact = job.artifacts.find(
    (artifact) => artifact.type === "spec_tree",
  );
  if (!treeArtifact) return undefined;
  const payload = treeArtifact.payload as
    | { nodes?: ReadonlyArray<BlueprintSpecTreeNode> }
    | undefined;
  if (!payload || !payload.nodes) return undefined;
  return payload.nodes.find((node) => node.id === nodeId)?.title;
}
