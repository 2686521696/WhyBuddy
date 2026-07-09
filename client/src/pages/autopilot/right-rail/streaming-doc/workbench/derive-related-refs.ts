/**
 * `autopilot-spec-documents-workbench-v2` — RelatedRef 派生纯函数。
 *
 * 从当前 active SpecDocument 出发，列出同 nodeId 下其他 DocType 的文档、
 * 父节点的文档以及第一层子节点的文档（R4.8 / R4.10）。
 *
 * 派生规则：
 * - `sibling-type`：同 `nodeId` 下其他 `BlueprintSpecDocumentType` 的 SpecDocument。
 * - `parent-node`：根据 `specTree.nodes` 中的 `parentId` 反查父节点，列出其
 *   requirements / design / tasks 三类文档（若存在）。
 * - `child-node`：根据 `nodes.filter(n => n.parentId === activeNodeId)` 列出
 *   第一层子节点的全部文档，避免树过深时一次性展开。
 * - 结果按 `relation` 分组、组内按 `TYPE_ORDER` 排序。
 * - 返回数组为空时，UI 渲染单一占位文案而不渲染列表容器（R4.10）。
 */

import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

/** 关联关系类型。 */
export type RelatedRefRelation = "sibling-type" | "parent-node" | "child-node";

/** 单条关联文档引用。 */
export interface RelatedRef {
  /** 文档 ID。 */
  documentId: string;
  /** 所属节点 ID。 */
  nodeId: string;
  /** 文档类型。 */
  type: BlueprintSpecDocumentType;
  /** 文档标题。 */
  title: string;
  /** 关系类型。 */
  relation: RelatedRefRelation;
}

/** `deriveRelatedRefs` 的输入参数。 */
export interface DeriveRelatedRefsInput {
  activeDoc: BlueprintSpecDocument | null;
  specDocuments: readonly BlueprintSpecDocument[] | undefined;
  specTree: BlueprintSpecTree | null | undefined;
}

/**
 * 文档类型排序权重：requirements → design → tasks。
 * 组内按此顺序排列。
 */
const TYPE_ORDER: Record<BlueprintSpecDocumentType, number> = {
  requirements: 0,
  design: 1,
  tasks: 2,
};

/**
 * 关系分组排序权重：sibling-type → parent-node → child-node。
 */
const RELATION_ORDER: Record<RelatedRefRelation, number> = {
  "sibling-type": 0,
  "parent-node": 1,
  "child-node": 2,
};

/**
 * 派生 RelatedRef 列表。
 *
 * - 当 `activeDoc === null` 或没有任何关联文档时返回空数组。
 * - 结果按 `relation` 分组、组内按 `TYPE_ORDER` 排序。
 */
export function deriveRelatedRefs(input: DeriveRelatedRefsInput): RelatedRef[] {
  const { activeDoc, specDocuments, specTree } = input;

  if (!activeDoc) return [];

  const docs = specDocuments ?? [];
  if (docs.length === 0) return [];

  const activeNodeId = activeDoc.nodeId;
  const activeDocId = activeDoc.id;
  const activeDocType = activeDoc.type;

  const refs: RelatedRef[] = [];

  // 1. sibling-type：同 nodeId 下其他 DocType 的文档
  for (const doc of docs) {
    if (
      doc.nodeId === activeNodeId &&
      doc.id !== activeDocId &&
      doc.type !== activeDocType
    ) {
      refs.push({
        documentId: doc.id,
        nodeId: doc.nodeId,
        type: doc.type,
        title: doc.title,
        relation: "sibling-type",
      });
    }
  }

  // 2. parent-node 与 3. child-node 需要 specTree
  if (specTree && specTree.nodes.length > 0) {
    // 构建 nodeId -> node 映射
    const nodeById = new Map(specTree.nodes.map((n) => [n.id, n]));

    // 查找当前节点
    const activeNode = nodeById.get(activeNodeId);

    // 2. parent-node：基于 parentId 反查父节点的文档
    if (activeNode?.parentId) {
      const parentNodeId = activeNode.parentId;
      for (const doc of docs) {
        if (doc.nodeId === parentNodeId && doc.id !== activeDocId) {
          refs.push({
            documentId: doc.id,
            nodeId: doc.nodeId,
            type: doc.type,
            title: doc.title,
            relation: "parent-node",
          });
        }
      }
    }

    // 3. child-node：仅取第一层子节点的全部文档
    const childNodeIds = new Set<string>();
    for (const node of specTree.nodes) {
      if (node.parentId === activeNodeId) {
        childNodeIds.add(node.id);
      }
    }

    if (childNodeIds.size > 0) {
      for (const doc of docs) {
        if (childNodeIds.has(doc.nodeId) && doc.id !== activeDocId) {
          refs.push({
            documentId: doc.id,
            nodeId: doc.nodeId,
            type: doc.type,
            title: doc.title,
            relation: "child-node",
          });
        }
      }
    }
  }

  // 按 relation 分组排序、组内按 TYPE_ORDER 排序
  refs.sort((a, b) => {
    const relationDiff = RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation];
    if (relationDiff !== 0) return relationDiff;
    return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  });

  return refs;
}
