/**
 * `derive-doc-stats` 派生纯函数单测。
 *
 * 覆盖：空输入、completed 越界被夹取、分母为 0 的 0% 分支、三类 doc 的混合完成率、
 * specTree 传入用于派生目标分母，但不会影响已生成 / 已完成口径。
 */
import { describe, it, expect } from "vitest";
import { deriveDocStats } from "../derive-doc-stats";
import type {
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

/** 辅助：创建最小 BlueprintSpecDocument 桩。 */
function makeDoc(
  overrides: Partial<BlueprintSpecDocument> &
    Pick<BlueprintSpecDocument, "type">
): BlueprintSpecDocument {
  return {
    id: overrides.id ?? `doc-${Math.random().toString(36).slice(2, 8)}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: overrides.nodeId ?? "node-1",
    type: overrides.type,
    status: overrides.status ?? "draft",
    title: overrides.title ?? "Test Doc",
    summary: "",
    content: "",
    format: "markdown",
    createdAt: "2026-01-01T00:00:00Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "topic",
      nodeTitle: "Test",
      nodeSummary: "",
      dependencies: [],
      outputs: [],
    },
  } as BlueprintSpecDocument;
}

describe("deriveDocStats", () => {
  describe("空输入", () => {
    it("specDocuments 为 undefined 时返回全零", () => {
      const result = deriveDocStats({
        specDocuments: undefined,
        specTree: null,
      });
      expect(result.totalDocs).toBe(0);
      expect(result.totalTasks).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.byType.requirements).toEqual({
        generated: 0,
        completed: 0,
      });
      expect(result.byType.design).toEqual({ generated: 0, completed: 0 });
      expect(result.byType.tasks).toEqual({ generated: 0, completed: 0 });
    });

    it("specDocuments 为空数组时返回全零", () => {
      const result = deriveDocStats({ specDocuments: [], specTree: null });
      expect(result.totalDocs).toBe(0);
      expect(result.totalTasks).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.byType.requirements).toEqual({
        generated: 0,
        completed: 0,
      });
      expect(result.byType.design).toEqual({ generated: 0, completed: 0 });
      expect(result.byType.tasks).toEqual({ generated: 0, completed: 0 });
    });
  });

  describe("单文档场景", () => {
    it("单个 requirements 文档 status=reviewing 时 completed 为 0", () => {
      const docs = [makeDoc({ type: "requirements", status: "reviewing" })];
      const result = deriveDocStats({ specDocuments: docs, specTree: null });
      expect(result.totalDocs).toBe(1);
      expect(result.totalTasks).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.byType.requirements).toEqual({
        generated: 1,
        completed: 0,
      });
      expect(result.byType.design).toEqual({ generated: 0, completed: 0 });
      expect(result.byType.tasks).toEqual({ generated: 0, completed: 0 });
    });
  });

  describe("全部 accepted", () => {
    it("三类文档各一个且全部 accepted 时 completionRate 为 1", () => {
      const docs = [
        makeDoc({ type: "requirements", status: "accepted" }),
        makeDoc({ type: "design", status: "accepted" }),
        makeDoc({ type: "tasks", status: "accepted" }),
      ];
      const result = deriveDocStats({ specDocuments: docs, specTree: null });
      expect(result.totalDocs).toBe(3);
      expect(result.totalTasks).toBe(1);
      expect(result.completionRate).toBe(1);
      expect(result.byType.requirements).toEqual({
        generated: 1,
        completed: 1,
      });
      expect(result.byType.design).toEqual({ generated: 1, completed: 1 });
      expect(result.byType.tasks).toEqual({ generated: 1, completed: 1 });
    });
  });

  describe("混合完成率", () => {
    it("2 requirements (1 accepted, 1 reviewing) + 1 design (accepted) + 0 tasks", () => {
      const docs = [
        makeDoc({ type: "requirements", status: "accepted" }),
        makeDoc({ type: "requirements", status: "reviewing" }),
        makeDoc({ type: "design", status: "accepted" }),
      ];
      const result = deriveDocStats({ specDocuments: docs, specTree: null });
      expect(result.totalDocs).toBe(3);
      expect(result.totalTasks).toBe(0);
      // completionRate = (1 + 1 + 0) / (2 + 1 + 0) = 2/3
      expect(result.completionRate).toBeCloseTo(2 / 3);
      expect(result.byType.requirements).toEqual({
        generated: 2,
        completed: 1,
      });
      expect(result.byType.design).toEqual({ generated: 1, completed: 1 });
      expect(result.byType.tasks).toEqual({ generated: 0, completed: 0 });
    });
  });

  describe("completed 越界夹取（R2.10）", () => {
    it("completed 不超过 generated（invariant 验证）", () => {
      // 正常情况下 completed 不可能超过 generated，因为 accepted 是 generated 的子集。
      // 但我们验证函数的夹取逻辑确保 byType[type].completed <= byType[type].generated。
      const docs = [
        makeDoc({ type: "requirements", status: "accepted" }),
        makeDoc({ type: "requirements", status: "accepted" }),
        makeDoc({ type: "design", status: "accepted" }),
        makeDoc({ type: "tasks", status: "draft" }),
      ];
      const result = deriveDocStats({ specDocuments: docs, specTree: null });

      // 验证 invariant：对每种类型 completed <= generated
      for (const type of ["requirements", "design", "tasks"] as const) {
        expect(result.byType[type].completed).toBeLessThanOrEqual(
          result.byType[type].generated
        );
      }

      expect(result.byType.requirements).toEqual({
        generated: 2,
        completed: 2,
      });
      expect(result.byType.design).toEqual({ generated: 1, completed: 1 });
      expect(result.byType.tasks).toEqual({ generated: 1, completed: 0 });
    });
  });

  describe("分母为 0 时 completionRate 返回 0（R2.9）", () => {
    it("specDocuments 为空时 completionRate 为 0", () => {
      const result = deriveDocStats({ specDocuments: [], specTree: null });
      expect(result.completionRate).toBe(0);
    });

    it("specDocuments 为 undefined 时 completionRate 为 0", () => {
      const result = deriveDocStats({
        specDocuments: undefined,
        specTree: undefined,
      });
      expect(result.completionRate).toBe(0);
    });
  });

  describe("specTree 目标分母", () => {
    it("specTree 为 null 时正常工作", () => {
      const docs = [makeDoc({ type: "tasks", status: "accepted" })];
      const result = deriveDocStats({ specDocuments: docs, specTree: null });
      expect(result.totalDocs).toBe(1);
      expect(result.totalTasks).toBe(1);
      expect(result.completionRate).toBe(1);
      expect(result.targetDocs).toBe(1);
      expect(result.targetTasks).toBe(1);
    });

    it("specTree 为 undefined 时正常工作", () => {
      const docs = [makeDoc({ type: "tasks", status: "accepted" })];
      const result = deriveDocStats({
        specDocuments: docs,
        specTree: undefined,
      });
      expect(result.totalDocs).toBe(1);
      expect(result.totalTasks).toBe(1);
      expect(result.completionRate).toBe(1);
      expect(result.targetDocs).toBe(1);
      expect(result.targetTasks).toBe(1);
    });

    it("specTree 有值时用 nodes.length 派生 docs / tasks 目标分母", () => {
      const docs = [
        makeDoc({ type: "design", status: "draft", nodeId: "node-1" }),
        makeDoc({ type: "tasks", status: "accepted", nodeId: "node-2" }),
      ];
      const specTree = {
        id: "tree-1",
        routeSetId: "rs-1",
        nodes: [
          { id: "node-1", title: "Root", type: "topic", children: ["node-2"] },
          {
            id: "node-2",
            parentId: "node-1",
            title: "Child",
            type: "topic",
            children: [],
          },
        ],
      } as unknown as BlueprintSpecTree;
      const result = deriveDocStats({ specDocuments: docs, specTree });
      expect(result.totalDocs).toBe(2);
      expect(result.totalTasks).toBe(1);
      expect(result.targetDocs).toBe(6);
      expect(result.targetTasks).toBe(2);
      expect(result.completionRate).toBe(0.5);
      expect(result.byType.design).toEqual({ generated: 1, completed: 0 });
      expect(result.byType.tasks).toEqual({ generated: 1, completed: 1 });
    });
  });

  describe("realtime progress overlay", () => {
    it("shows in-flight generated counts from specDocsProgress without marking them accepted", () => {
      const specTree = {
        id: "tree-1",
        routeSetId: "rs-1",
        nodes: Array.from({ length: 10 }, (_, index) => ({
          id: `node-${index + 1}`,
          title: `Node ${index + 1}`,
          type: "topic",
          children: [],
        })),
      } as unknown as BlueprintSpecTree;

      const result = deriveDocStats({
        specDocuments: [],
        specTree,
        specDocsProgress: {
          batchStatus: "running",
          totalCount: 10,
          completedCount: 10,
          assembledCount: 0,
          processedCount: 10,
        },
      });

      expect(result.totalDocs).toBe(30);
      expect(result.targetDocs).toBe(30);
      expect(result.totalTasks).toBe(10);
      expect(result.targetTasks).toBe(10);
      expect(result.byType.requirements).toEqual({
        generated: 10,
        completed: 0,
      });
      expect(result.byType.design).toEqual({ generated: 10, completed: 0 });
      expect(result.byType.tasks).toEqual({ generated: 10, completed: 0 });
      expect(result.completionRate).toBe(0);
    });
  });
});
