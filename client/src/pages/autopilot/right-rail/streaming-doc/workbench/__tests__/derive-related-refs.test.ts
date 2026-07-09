/**
 * `derive-related-refs` 派生纯函数单测。
 *
 * 覆盖：activeDoc 为 null / specDocuments 为空 / specTree 为 null /
 * 同节点其他类型 / 父节点 / 子节点 / 无关联 / 组合输入 /
 * 不包含 activeDoc 自身 / TYPE_ORDER 排序。
 */
import { describe, it, expect } from "vitest";
import { deriveRelatedRefs } from "../derive-related-refs";
import type {
  BlueprintSpecDocument,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

/** 辅助：创建最小 BlueprintSpecDocument 桩。 */
function makeDoc(
  overrides: Partial<BlueprintSpecDocument> &
    Pick<BlueprintSpecDocument, "id" | "nodeId" | "type">
): BlueprintSpecDocument {
  return {
    id: overrides.id,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: overrides.nodeId,
    type: overrides.type,
    status: overrides.status ?? "draft",
    title: overrides.title ?? `Doc ${overrides.id}`,
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

/** 辅助：创建最小 BlueprintSpecTreeNode 桩。 */
function makeNode(
  overrides: Partial<BlueprintSpecTreeNode> &
    Pick<BlueprintSpecTreeNode, "id">
): BlueprintSpecTreeNode {
  return {
    id: overrides.id,
    parentId: overrides.parentId,
    title: overrides.title ?? `Node ${overrides.id}`,
    summary: "",
    type: "topic",
    status: "draft",
    priority: 0,
    dependencies: [],
    outputs: [],
    children: overrides.children ?? [],
  } as BlueprintSpecTreeNode;
}

/** 辅助：创建最小 BlueprintSpecTree 桩。 */
function makeTree(nodes: BlueprintSpecTreeNode[]): BlueprintSpecTree {
  return {
    id: "tree-1",
    routeSetId: "rs-1",
    selectionId: "sel-1",
    selectedRouteId: "route-1",
    rootNodeId: nodes[0]?.id ?? "root",
    version: 1,
    status: "draft",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    alternativeRouteIds: [],
    nodes,
    provenance: {
      jobId: "job-1",
      githubUrls: [],
    },
  } as BlueprintSpecTree;
}

describe("deriveRelatedRefs", () => {
  describe("空输入与边界", () => {
    it("activeDoc === null 时返回空数组", () => {
      const result = deriveRelatedRefs({
        activeDoc: null,
        specDocuments: [makeDoc({ id: "d1", nodeId: "n1", type: "requirements" })],
        specTree: null,
      });
      expect(result).toEqual([]);
    });

    it("specDocuments 为 undefined 时返回空数组", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "n1", type: "requirements" });
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: undefined,
        specTree: null,
      });
      expect(result).toEqual([]);
    });

    it("specDocuments 为空数组时返回空数组", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "n1", type: "requirements" });
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: [],
        specTree: null,
      });
      expect(result).toEqual([]);
    });

    it("specTree 为 null 时仍返回 sibling-type refs", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "n1", type: "requirements" });
      const docs = [
        activeDoc,
        makeDoc({ id: "d2", nodeId: "n1", type: "design" }),
      ];
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: null,
      });
      expect(result).toHaveLength(1);
      expect(result[0].relation).toBe("sibling-type");
      expect(result[0].type).toBe("design");
    });
  });

  describe("sibling-type", () => {
    it("同 nodeId 下其他 DocType 的文档被列出", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "requirements" });
      const docs = [
        activeDoc,
        makeDoc({ id: "d2", nodeId: "node-A", type: "design", title: "Design A" }),
        makeDoc({ id: "d3", nodeId: "node-A", type: "tasks", title: "Tasks A" }),
      ];
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: null,
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        documentId: "d2",
        nodeId: "node-A",
        type: "design",
        title: "Design A",
        relation: "sibling-type",
      });
      expect(result[1]).toMatchObject({
        documentId: "d3",
        nodeId: "node-A",
        type: "tasks",
        title: "Tasks A",
        relation: "sibling-type",
      });
    });

    it("不包含 activeDoc 自身", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "requirements" });
      const docs = [activeDoc];
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: null,
      });
      expect(result).toEqual([]);
    });

    it("同 nodeId 同 type 的其他文档不被列出（仅列出不同 type）", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "requirements" });
      const docs = [
        activeDoc,
        makeDoc({ id: "d2", nodeId: "node-A", type: "requirements", title: "Req 2" }),
      ];
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: null,
      });
      expect(result).toEqual([]);
    });
  });

  describe("parent-node", () => {
    it("父节点的文档被列出", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-B", type: "requirements" });
      const docs = [
        activeDoc,
        makeDoc({ id: "d2", nodeId: "node-A", type: "requirements", title: "Parent Req" }),
        makeDoc({ id: "d3", nodeId: "node-A", type: "design", title: "Parent Design" }),
      ];
      const tree = makeTree([
        makeNode({ id: "node-A", children: ["node-B"] }),
        makeNode({ id: "node-B", parentId: "node-A", children: [] }),
      ]);
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: tree,
      });
      const parentRefs = result.filter((r) => r.relation === "parent-node");
      expect(parentRefs).toHaveLength(2);
      expect(parentRefs[0]).toMatchObject({
        documentId: "d2",
        nodeId: "node-A",
        type: "requirements",
        relation: "parent-node",
      });
      expect(parentRefs[1]).toMatchObject({
        documentId: "d3",
        nodeId: "node-A",
        type: "design",
        relation: "parent-node",
      });
    });

    it("节点没有 parentId 时不产生 parent-node refs", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "requirements" });
      const docs = [activeDoc];
      const tree = makeTree([
        makeNode({ id: "node-A", children: [] }),
      ]);
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: tree,
      });
      expect(result.filter((r) => r.relation === "parent-node")).toHaveLength(0);
    });
  });

  describe("child-node", () => {
    it("第一层子节点的文档被列出", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "requirements" });
      const docs = [
        activeDoc,
        makeDoc({ id: "d2", nodeId: "node-C", type: "requirements", title: "Child C Req" }),
        makeDoc({ id: "d3", nodeId: "node-C", type: "design", title: "Child C Design" }),
        makeDoc({ id: "d4", nodeId: "node-D", type: "tasks", title: "Child D Tasks" }),
      ];
      const tree = makeTree([
        makeNode({ id: "node-A", children: ["node-C", "node-D"] }),
        makeNode({ id: "node-C", parentId: "node-A", children: [] }),
        makeNode({ id: "node-D", parentId: "node-A", children: [] }),
      ]);
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: tree,
      });
      const childRefs = result.filter((r) => r.relation === "child-node");
      expect(childRefs).toHaveLength(3);
      // 按 TYPE_ORDER 排序：requirements → design → tasks
      expect(childRefs[0].type).toBe("requirements");
      expect(childRefs[1].type).toBe("design");
      expect(childRefs[2].type).toBe("tasks");
    });

    it("不包含孙节点的文档（仅第一层子节点）", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "requirements" });
      const docs = [
        activeDoc,
        makeDoc({ id: "d2", nodeId: "node-B", type: "design", title: "Child B" }),
        makeDoc({ id: "d3", nodeId: "node-C", type: "tasks", title: "Grandchild C" }),
      ];
      const tree = makeTree([
        makeNode({ id: "node-A", children: ["node-B"] }),
        makeNode({ id: "node-B", parentId: "node-A", children: ["node-C"] }),
        makeNode({ id: "node-C", parentId: "node-B", children: [] }),
      ]);
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: tree,
      });
      const childRefs = result.filter((r) => r.relation === "child-node");
      expect(childRefs).toHaveLength(1);
      expect(childRefs[0].documentId).toBe("d2");
      // node-C 是孙节点，不应出现
      expect(childRefs.find((r) => r.documentId === "d3")).toBeUndefined();
    });
  });

  describe("无关联文档", () => {
    it("activeDoc 是唯一文档、节点无父无子时返回空数组", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "requirements" });
      const docs = [activeDoc];
      const tree = makeTree([
        makeNode({ id: "node-A", children: [] }),
      ]);
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: tree,
      });
      expect(result).toEqual([]);
    });
  });

  describe("组合输入", () => {
    it("同时存在 sibling + parent + child 三种关系时全部返回并正确分组排序", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-B", type: "design" });
      const docs = [
        activeDoc,
        // sibling-type：同 node-B 下的 requirements 和 tasks
        makeDoc({ id: "d2", nodeId: "node-B", type: "requirements", title: "Sibling Req" }),
        makeDoc({ id: "d3", nodeId: "node-B", type: "tasks", title: "Sibling Tasks" }),
        // parent-node：node-A 的文档
        makeDoc({ id: "d4", nodeId: "node-A", type: "requirements", title: "Parent Req" }),
        makeDoc({ id: "d5", nodeId: "node-A", type: "design", title: "Parent Design" }),
        // child-node：node-C 的文档
        makeDoc({ id: "d6", nodeId: "node-C", type: "tasks", title: "Child Tasks" }),
        makeDoc({ id: "d7", nodeId: "node-C", type: "requirements", title: "Child Req" }),
      ];
      const tree = makeTree([
        makeNode({ id: "node-A", children: ["node-B"] }),
        makeNode({ id: "node-B", parentId: "node-A", children: ["node-C"] }),
        makeNode({ id: "node-C", parentId: "node-B", children: [] }),
      ]);
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: tree,
      });

      // 应有 2 sibling + 2 parent + 2 child = 6 refs
      expect(result).toHaveLength(6);

      // 按 relation 分组排序：sibling-type → parent-node → child-node
      const siblingRefs = result.filter((r) => r.relation === "sibling-type");
      const parentRefs = result.filter((r) => r.relation === "parent-node");
      const childRefs = result.filter((r) => r.relation === "child-node");

      expect(siblingRefs).toHaveLength(2);
      expect(parentRefs).toHaveLength(2);
      expect(childRefs).toHaveLength(2);

      // sibling-type 在前
      expect(result[0].relation).toBe("sibling-type");
      expect(result[1].relation).toBe("sibling-type");
      // parent-node 在中
      expect(result[2].relation).toBe("parent-node");
      expect(result[3].relation).toBe("parent-node");
      // child-node 在后
      expect(result[4].relation).toBe("child-node");
      expect(result[5].relation).toBe("child-node");
    });
  });

  describe("不包含 activeDoc 自身", () => {
    it("结果中不包含 activeDoc 的 id", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "requirements" });
      const docs = [
        activeDoc,
        makeDoc({ id: "d2", nodeId: "node-A", type: "design" }),
        makeDoc({ id: "d3", nodeId: "node-A", type: "tasks" }),
      ];
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: null,
      });
      expect(result.every((r) => r.documentId !== "d1")).toBe(true);
    });
  });

  describe("TYPE_ORDER 排序", () => {
    it("组内按 requirements → design → tasks 排序", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-A", type: "design" });
      const docs = [
        activeDoc,
        // 故意乱序放入
        makeDoc({ id: "d2", nodeId: "node-A", type: "tasks", title: "Tasks" }),
        makeDoc({ id: "d3", nodeId: "node-A", type: "requirements", title: "Req" }),
      ];
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: null,
      });
      expect(result).toHaveLength(2);
      // requirements (0) 在 tasks (2) 前面
      expect(result[0].type).toBe("requirements");
      expect(result[1].type).toBe("tasks");
    });

    it("parent-node 组内也按 TYPE_ORDER 排序", () => {
      const activeDoc = makeDoc({ id: "d1", nodeId: "node-B", type: "requirements" });
      const docs = [
        activeDoc,
        makeDoc({ id: "d2", nodeId: "node-A", type: "tasks", title: "Parent Tasks" }),
        makeDoc({ id: "d3", nodeId: "node-A", type: "design", title: "Parent Design" }),
        makeDoc({ id: "d4", nodeId: "node-A", type: "requirements", title: "Parent Req" }),
      ];
      const tree = makeTree([
        makeNode({ id: "node-A", children: ["node-B"] }),
        makeNode({ id: "node-B", parentId: "node-A", children: [] }),
      ]);
      const result = deriveRelatedRefs({
        activeDoc,
        specDocuments: docs,
        specTree: tree,
      });
      const parentRefs = result.filter((r) => r.relation === "parent-node");
      expect(parentRefs).toHaveLength(3);
      expect(parentRefs[0].type).toBe("requirements");
      expect(parentRefs[1].type).toBe("design");
      expect(parentRefs[2].type).toBe("tasks");
    });
  });
});
