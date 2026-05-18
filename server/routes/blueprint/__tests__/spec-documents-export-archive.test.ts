/**
 * `autopilot-spec-document-export` Task 2.2：buildSpecExportArchive 单测。
 *
 * 共 ~10 用例覆盖 Req 1.1-1.10 全部分支，外加 4.2 同名碰撞处理。
 *
 * - vi.mock 只要给 fake `getJob` / `listSpecDocuments` 即可
 * - jszip 走真实依赖；用 `JSZip.loadAsync` 反序列化结果做断言
 */

import { describe, expect, it } from "vitest";

import JSZip from "jszip";

import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
} from "../../../../shared/blueprint/index.js";

import {
  buildSpecExportArchive,
  type BuildSpecExportDeps,
} from "../spec-documents/export/spec-documents-export-archive.js";

// ─── 工具：构造 fake spec doc + job ──────────────────────────────────────

function makeDoc(
  jobId: string,
  treeId: string,
  nodeId: string,
  nodeTitle: string,
  type: BlueprintSpecDocumentType,
  content: string,
  generationSource: "llm" | "llm_fallback" | "template" = "template",
): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}-${type}`,
    jobId,
    treeId,
    nodeId,
    type,
    title: `${type}: ${nodeTitle}`,
    summary: `${type} summary for ${nodeTitle}`,
    content,
    format: "markdown",
    createdAt: "2026-05-14T00:00:00.000Z",
    provenance: {
      jobId,
      githubUrls: [],
      treeVersion: 1,
      nodeType: "module",
      nodeTitle,
      nodeSummary: `summary for ${nodeTitle}`,
      dependencies: [],
      outputs: [],
      generationSource,
    },
  };
}

function makeJob(
  jobId: string,
  rootNodeId: string,
  rootTitle: string,
  nodes: ReadonlyArray<{ id: string; title: string }>,
): BlueprintGenerationJob {
  const tree: BlueprintSpecTree = {
    id: "tree-1",
    jobId,
    rootNodeId,
    version: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: `${n.title} summary`,
      type: n.id === rootNodeId ? "root" : "module",
      status: "draft",
      priority: 80,
      dependencies: [],
      outputs: [],
      parentId: n.id === rootNodeId ? undefined : rootNodeId,
    })),
    createdAt: "2026-05-14T00:00:00.000Z",
    provenance: {
      jobId,
      githubUrls: [],
      promptId: "blueprint.spec-tree-llm.v1",
      generationSource: "template",
    },
  };

  return {
    id: jobId,
    request: {
      githubUrls: [],
      targetText: "test",
    },
    stage: "spec_docs",
    status: "reviewing",
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    artifacts: [
      { type: "spec_tree", payload: tree, createdAt: tree.createdAt },
    ],
    events: [],
  } as unknown as BlueprintGenerationJob;
}

function makeDeps(
  documents: ReadonlyArray<BlueprintSpecDocument>,
  job: BlueprintGenerationJob | null,
): BuildSpecExportDeps {
  return {
    getJob: (jobId) => (job && job.id === jobId ? job : null),
    listSpecDocuments: (_jobId) => documents,
    now: () => new Date("2026-05-14T01:00:00.000Z"),
  };
}

// ─── 测试 ────────────────────────────────────────────────────────────────

describe("buildSpecExportArchive", () => {
  it("granularity 缺失或越界 → invalid_request，不读 store", async () => {
    let calls = 0;
    const deps: BuildSpecExportDeps = {
      getJob: () => {
        calls += 1;
        return null;
      },
      listSpecDocuments: () => [],
      now: () => new Date(),
    };
    const r1 = await buildSpecExportArchive(
      { jobId: "j1", granularity: undefined },
      deps,
    );
    const r2 = await buildSpecExportArchive(
      { jobId: "j1", granularity: "weird" },
      deps,
    );
    expect(r1.kind).toBe("invalid_request");
    expect(r2.kind).toBe("invalid_request");
    expect(calls).toBe(0); // store 不应被调
  });

  it("single 缺 nodeId / type → invalid_request", async () => {
    const deps = makeDeps([], makeJob("j1", "root", "Root", [{ id: "root", title: "Root" }]));
    const r1 = await buildSpecExportArchive(
      { jobId: "j1", granularity: "single", type: "requirements" },
      deps,
    );
    const r2 = await buildSpecExportArchive(
      { jobId: "j1", granularity: "single", nodeId: "n1" },
      deps,
    );
    const r3 = await buildSpecExportArchive(
      { jobId: "j1", granularity: "single", nodeId: "n1", type: "weird" },
      deps,
    );
    expect(r1.kind).toBe("invalid_request");
    expect(r2.kind).toBe("invalid_request");
    expect(r3.kind).toBe("invalid_request");
  });

  it("node 缺 nodeId → invalid_request", async () => {
    const deps = makeDeps([], makeJob("j1", "root", "Root", [{ id: "root", title: "Root" }]));
    const r = await buildSpecExportArchive(
      { jobId: "j1", granularity: "node" },
      deps,
    );
    expect(r.kind).toBe("invalid_request");
  });

  it("job 不存在 → not_found", async () => {
    const deps = makeDeps([], null);
    const r = await buildSpecExportArchive(
      { jobId: "missing", granularity: "tree" },
      deps,
    );
    expect(r.kind).toBe("not_found");
    if (r.kind === "not_found") {
      expect(r.message).toMatch(/blueprint job not found/);
    }
  });

  it("single happy path: 返回 markdown content 字节相等", async () => {
    const docs = [
      makeDoc("j1", "tree-1", "node-a", "Module A", "requirements", "# 需求 A\n\n## 简介\n\n内容"),
    ];
    const deps = makeDeps(docs, makeJob("j1", "node-a", "Module A", [{ id: "node-a", title: "Module A" }]));
    const r = await buildSpecExportArchive(
      { jobId: "j1", granularity: "single", nodeId: "node-a", type: "requirements" },
      deps,
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.archive.contentType).toBe("text/markdown; charset=utf-8");
    expect(r.archive.body).toBe("# 需求 A\n\n## 简介\n\n内容");
    expect(r.archive.filename).toBe("Module_A-requirements.md");
  });

  it("single 文档不存在 → not_found", async () => {
    const docs = [makeDoc("j1", "tree-1", "node-a", "Module A", "requirements", "x")];
    const deps = makeDeps(docs, makeJob("j1", "node-a", "Module A", [{ id: "node-a", title: "Module A" }]));
    const r = await buildSpecExportArchive(
      { jobId: "j1", granularity: "single", nodeId: "node-a", type: "design" },
      deps,
    );
    expect(r.kind).toBe("not_found");
    if (r.kind === "not_found") {
      expect(r.details).toMatchObject({ jobId: "j1", nodeId: "node-a", type: "design" });
    }
  });

  it("node happy path: zip 包含全部生成的 type + MANIFEST.json", async () => {
    const docs = [
      makeDoc("j1", "tree-1", "node-a", "Module A", "requirements", "REQ-A"),
      makeDoc("j1", "tree-1", "node-a", "Module A", "design", "DES-A"),
      // tasks 故意缺失
    ];
    const deps = makeDeps(docs, makeJob("j1", "node-a", "Module A", [{ id: "node-a", title: "Module A" }]));
    const r = await buildSpecExportArchive(
      { jobId: "j1", granularity: "node", nodeId: "node-a" },
      deps,
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.archive.contentType).toBe("application/zip");
    expect(r.archive.filename).toBe("Module_A-spec.zip");

    const zip = await JSZip.loadAsync(r.archive.body as Uint8Array);
    expect(await zip.file("Module_A/requirements.md")?.async("string")).toBe("REQ-A");
    expect(await zip.file("Module_A/design.md")?.async("string")).toBe("DES-A");
    expect(zip.file("Module_A/tasks.md")).toBeNull();

    const manifest = JSON.parse(
      (await zip.file("MANIFEST.json")?.async("string")) ?? "{}",
    );
    expect(manifest.jobId).toBe("j1");
    expect(manifest.granularity).toBe("node");
    expect(manifest.nodeIds).toEqual(["node-a"]);
    expect(manifest.documents).toHaveLength(2);
    expect(manifest.exportedAt).toBe("2026-05-14T01:00:00.000Z");
  });

  it("node 该节点 0 文档 → not_found", async () => {
    const docs = [makeDoc("j1", "tree-1", "node-a", "Module A", "requirements", "x")];
    const deps = makeDeps(docs, makeJob("j1", "node-a", "Module A", [{ id: "node-a", title: "Module A" }]));
    const r = await buildSpecExportArchive(
      { jobId: "j1", granularity: "node", nodeId: "node-b" },
      deps,
    );
    expect(r.kind).toBe("not_found");
    if (r.kind === "not_found") {
      expect(r.details).toMatchObject({ jobId: "j1", nodeId: "node-b" });
    }
  });

  it("tree happy path: zip 包含全部 docs，filename 派生自 root title", async () => {
    const docs = [
      makeDoc("j1", "tree-1", "root", "Project Root", "requirements", "ROOT-REQ"),
      makeDoc("j1", "tree-1", "node-a", "Module A", "requirements", "A-REQ"),
      makeDoc("j1", "tree-1", "node-a", "Module A", "design", "A-DES"),
    ];
    const deps = makeDeps(
      docs,
      makeJob("j1", "root", "Project Root", [
        { id: "root", title: "Project Root" },
        { id: "node-a", title: "Module A" },
      ]),
    );
    const r = await buildSpecExportArchive(
      { jobId: "j1", granularity: "tree" },
      deps,
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.archive.contentType).toBe("application/zip");
    expect(r.archive.filename).toBe("Project_Root-spec.zip");

    const zip = await JSZip.loadAsync(r.archive.body as Uint8Array);
    expect(await zip.file("Project_Root/requirements.md")?.async("string")).toBe(
      "ROOT-REQ",
    );
    expect(await zip.file("Module_A/requirements.md")?.async("string")).toBe(
      "A-REQ",
    );
    expect(await zip.file("Module_A/design.md")?.async("string")).toBe("A-DES");

    const manifest = JSON.parse(
      (await zip.file("MANIFEST.json")?.async("string")) ?? "{}",
    );
    expect(manifest.granularity).toBe("tree");
    expect(manifest.documents).toHaveLength(3);
    expect(new Set(manifest.nodeIds)).toEqual(new Set(["root", "node-a"]));
  });

  it("tree 0 文档 → not_found", async () => {
    const deps = makeDeps([], makeJob("j1", "root", "Project Root", [{ id: "root", title: "Project Root" }]));
    const r = await buildSpecExportArchive(
      { jobId: "j1", granularity: "tree" },
      deps,
    );
    expect(r.kind).toBe("not_found");
  });

  it("tree 同名 nodeTitle 碰撞 → 后者 segment 附加 -<nodeId.slice(0,6)>", async () => {
    // 两个 nodeId 不同但 title 完全相同
    const docs = [
      makeDoc("j1", "tree-1", "node-aaaaaa-1", "Same Title", "requirements", "1"),
      makeDoc("j1", "tree-1", "node-bbbbbb-2", "Same Title", "requirements", "2"),
    ];
    const deps = makeDeps(
      docs,
      makeJob("j1", "node-aaaaaa-1", "Same Title", [
        { id: "node-aaaaaa-1", title: "Same Title" },
        { id: "node-bbbbbb-2", title: "Same Title" },
      ]),
    );
    const r = await buildSpecExportArchive(
      { jobId: "j1", granularity: "tree" },
      deps,
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;

    const zip = await JSZip.loadAsync(r.archive.body as Uint8Array);
    expect(await zip.file("Same_Title/requirements.md")?.async("string")).toBe("1");
    expect(
      await zip.file("Same_Title-node-b/requirements.md")?.async("string"),
    ).toBe("2");
  });
});
