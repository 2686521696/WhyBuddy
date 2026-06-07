import { useEffect, useMemo, useState } from "react";
import { Tree } from "antd";
import type { TreeDataNode } from "antd";
import {
  CheckCircle2,
  Combine,
  FileText,
  GitBranch,
  History,
  PlusCircle,
  RefreshCw,
  Save,
  Split,
  Trash2,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  runBlueprintSpecTreeAction,
  saveBlueprintSpecTreeVersion,
  updateBlueprintSpecTreeNode,
  type RunBlueprintSpecTreeActionResult,
  type SaveBlueprintSpecTreeVersionResult,
  type UpdateBlueprintSpecTreeNodeResult,
} from "@/lib/blueprint-api";
import { blueprintCopy } from "@/lib/blueprint-copy";
import { cn } from "@/lib/utils";
import {
  deriveSpecDocumentTreeStatsFromDocuments,
  type SpecDocumentTreeStats,
} from "@/lib/blueprint-spec-document-stats";
import type {
  BlueprintRouteSelection,
  BlueprintSpecDocument,
  BlueprintSpecTreeActionRequest,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
  BlueprintSpecTreeNodeStatus,
  BlueprintSpecTreeVersionSnapshot,
} from "@shared/blueprint/contracts";

interface SpecTreeWorkbenchPanelProps {
  specTree: BlueprintSpecTree;
  selection: BlueprintRouteSelection | null;
  jobId?: string | null;
  versions?: BlueprintSpecTreeVersionSnapshot[] | null;
  documents?: BlueprintSpecDocument[] | null;
  onSpecTreeChange?: (specTree: BlueprintSpecTree) => void;
  onSpecTreeVersionsChange?: (versions: BlueprintSpecTreeVersionSnapshot[]) => void;
}

type SaveState = "idle" | "saving" | "saved";

const STATUS_OPTIONS: BlueprintSpecTreeNodeStatus[] = [
  "seed",
  "ready",
  "draft",
  "accepted",
];

function nodeTypeLabel(type: BlueprintSpecTreeNode["type"]): string {
  const translated = blueprintCopy(type);
  if (translated !== type) return translated;

  return type
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildTreeRows(nodes: BlueprintSpecTreeNode[], rootNodeId: string) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set<string>();
  const rows: Array<{ node: BlueprintSpecTreeNode; depth: number }> = [];

  const visit = (node: BlueprintSpecTreeNode, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    rows.push({ node, depth });

    node.children
      .map(childId => byId.get(childId))
      .filter((child): child is BlueprintSpecTreeNode => Boolean(child))
      .sort((left, right) => left.priority - right.priority)
      .forEach(child => visit(child, depth + 1));
  };

  const root = byId.get(rootNodeId) ?? nodes[0];
  if (root) visit(root, 0);

  nodes
    .filter(node => !visited.has(node.id))
    .sort((left, right) => left.priority - right.priority)
    .forEach(node => visit(node, node.parentId ? 1 : 0));

  return rows;
}

function updateNodeInTree(
  tree: BlueprintSpecTree,
  nodeId: string,
  patch: Partial<BlueprintSpecTreeNode>
): BlueprintSpecTree {
  return {
    ...tree,
    updatedAt: new Date().toISOString(),
    nodes: tree.nodes.map(node =>
      node.id === nodeId ? { ...node, ...patch } : node
    ),
  };
}

function outputsToText(outputs: string[]): string {
  return outputs.join("\n");
}

function parseOutputs(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * 把 flat `BlueprintSpecTreeNode[]` 转成 antd `<Tree>` 需要的嵌套 `TreeDataNode[]`。
 */
function buildAntdTreeData(
  nodes: BlueprintSpecTreeNode[],
  rootNodeId: string,
  documentStatsByNodeId?: SpecDocumentTreeStats["byNodeId"] | null
): TreeDataNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));

  const convert = (nodeId: string): TreeDataNode | null => {
    const node = byId.get(nodeId);
    if (!node) return null;
    const children = node.children
      .map(childId => convert(childId))
      .filter((child): child is TreeDataNode => child !== null);
    const documentStats = documentStatsByNodeId?.get(node.id);
    return {
      key: node.id,
      title: (
        <span className="inline-flex items-center gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-[9px] font-black text-[#0f766e]">
            {node.priority}
          </span>
          <span className="text-sm font-semibold text-slate-900">
            {blueprintCopy(node.title)}
          </span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
            {nodeTypeLabel(node.type)}
          </span>
          {documentStats ? (
            <span
              className="rounded-full border border-[#0f766e]/20 bg-[#0f766e]/10 px-1.5 py-0.5 text-[9px] font-black text-[#0f766e]"
              data-testid="spec-tree-node-document-status"
              data-doc-lifecycle={documentStats.lifecycle}
            >
              {documentStats.generated}/{documentStats.total}
            </span>
          ) : null}
        </span>
      ),
      children: children.length > 0 ? children : undefined,
    };
  };

  const root = byId.get(rootNodeId) ?? nodes[0];
  if (!root) return [];

  const rootTree = convert(root.id);
  if (!rootTree) return [];

  // 把不在 root 子树里的孤立节点也加进来
  const visited = new Set<string>();
  const collectKeys = (treeNode: TreeDataNode) => {
    visited.add(treeNode.key as string);
    (treeNode.children ?? []).forEach(collectKeys);
  };
  collectKeys(rootTree);

  const orphans = nodes
    .filter(node => !visited.has(node.id))
    .map(node => convert(node.id))
    .filter((item): item is TreeDataNode => item !== null);

  return [rootTree, ...orphans];
}

/**
 * SpecTreeWorkbenchPanel — 故意保留的「结构操作变体」(deliberately-retained
 * structure-operation variant)。
 *
 * 该面板**只承载 SPEC 树的结构操作**：节点增/删/移/合并/拆分（`runBlueprintSpecTreeAction`）、
 * 节点字段保存（`updateBlueprintSpecTreeNode`）与版本快照（`saveBlueprintSpecTreeVersion`），
 * 其本地状态机仅为 `saveState` / `versionSaveState` / `actionState`（`idle | saving | saved`）。
 * `documents` prop 为**只读**输入，仅用于展示每个节点的「已生成/总数」统计徽标，
 * 不在本面板内触发任何 spec 文档生成动作（无 `generateBlueprintSpecDocuments` /
 * `onGenerate` 类 CTA）。
 *
 * 因此本面板**有意不承载** spec-generation-perceived-performance 定义的
 * Generation_State_Machine（`idle | pending | success | failure | empty`）与
 * Progress_Feedback_Layer（`SpecTreeProgressLayer` 骨架 + 进度信号）。spec 文档生成的
 * 感知性能与状态一致性归属于规范实现 `SpecTreeWorkbench`，并经父级 `AutopilotRightRail`
 * 的统一 In_Flight_Lock（`triggerSpecDocsGeneration` / `specDocsGenerating`）控制并发。
 * 保留此独立结构操作变体不构成「不一致实现」——它根本不暴露生成动作，故不在
 * Generation_State_Machine 的语义范围内。
 *
 * 参见 spec：spec-generation-perceived-performance（Requirement 3.1 / 3.2 / 3.4，
 * design.md §5「SpecTreeWorkbenchPanel（遗留，二选一收敛）」）。
 *
 * 兼容性约束：autopilot-right-rail-stage-panels Requirement 9.1 要求本文件保持零行为
 * 改动；本注释为纯文档说明，不改变签名、实现逻辑或 export 语义。
 */
export function SpecTreeWorkbenchPanel({
  specTree,
  selection,
  jobId = null,
  versions = null,
  documents = null,
  onSpecTreeChange,
  onSpecTreeVersionsChange,
}: SpecTreeWorkbenchPanelProps) {
  const [draftTree, setDraftTree] = useState(specTree);
  const [selectedNodeId, setSelectedNodeId] = useState(
    specTree.rootNodeId || specTree.nodes[0]?.id || ""
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState(
    "本地草稿已准备好评审。"
  );
  const [versionSaveState, setVersionSaveState] = useState<SaveState>("idle");
  const [versionSaveMessage, setVersionSaveMessage] = useState(
    "本次会话尚未保存版本快照。"
  );
  const [versionSnapshots, setVersionSnapshots] = useState<
    BlueprintSpecTreeVersionSnapshot[]
  >(versions ?? []);
  const [actionState, setActionState] = useState<SaveState>("idle");
  const [actionMessage, setActionMessage] = useState(
    "结构操作已就绪。"
  );
  const [addNodeTitle, setAddNodeTitle] = useState("新的 SPEC 节点");
  const [splitNodeTitle, setSplitNodeTitle] = useState("拆分后的后续节点");
  const [splitNodePlacement, setSplitNodePlacement] = useState<
    "sibling" | "child"
  >("sibling");
  const [moveParentId, setMoveParentId] = useState(
    specTree.rootNodeId || specTree.nodes[0]?.id || ""
  );
  const [mergeTargetId, setMergeTargetId] = useState(
    specTree.rootNodeId || specTree.nodes[0]?.id || ""
  );

  useEffect(() => {
    setDraftTree(specTree);
    setSelectedNodeId(current =>
      specTree.nodes.some(node => node.id === current)
        ? current
        : specTree.rootNodeId || specTree.nodes[0]?.id || ""
    );
    setSaveState("idle");
    setSaveMessage("本地草稿已准备好评审。");
    setVersionSaveState("idle");
    setVersionSaveMessage("本次会话尚未保存版本快照。");
    setMoveParentId(specTree.rootNodeId || specTree.nodes[0]?.id || "");
    setMergeTargetId(specTree.rootNodeId || specTree.nodes[0]?.id || "");
  }, [specTree]);

  useEffect(() => {
    setVersionSnapshots(versions ?? []);
  }, [versions]);

  const rows = useMemo(
    () => buildTreeRows(draftTree.nodes, draftTree.rootNodeId),
    [draftTree.nodes, draftTree.rootNodeId]
  );
  const selectedNode =
    draftTree.nodes.find(node => node.id === selectedNodeId) ??
    draftTree.nodes[0];
  const rootNode =
    draftTree.nodes.find(node => node.id === draftTree.rootNodeId) ??
    draftTree.nodes[0];
  const availableParentNodes = useMemo(
    () =>
      draftTree.nodes.filter(node => node.id !== selectedNode?.id),
    [draftTree.nodes, selectedNode?.id]
  );
  const mergeTargetNodes = useMemo(
    () =>
      draftTree.nodes.filter(node => node.id !== selectedNode?.id),
    [draftTree.nodes, selectedNode?.id]
  );
  const documentStats = useMemo(
    () => deriveSpecDocumentTreeStatsFromDocuments(documents ?? [], draftTree),
    [documents, draftTree]
  );
  const antdTreeData = useMemo(
    () =>
      buildAntdTreeData(
        draftTree.nodes,
        draftTree.rootNodeId,
        documentStats.byNodeId
      ),
    [draftTree.nodes, draftTree.rootNodeId, documentStats.byNodeId]
  );
  const sortedVersionSnapshots = useMemo(
    () =>
      [...versionSnapshots].sort(
        (left, right) =>
          right.savedAt.localeCompare(left.savedAt) ||
          right.version - left.version
      ),
    [versionSnapshots]
  );

  const applySelectedPatch = (patch: Partial<BlueprintSpecTreeNode>) => {
    if (!selectedNode) return;
    setSaveState("idle");
    setSaveMessage("存在未保存的本地编辑。");
    setDraftTree(current => updateNodeInTree(current, selectedNode.id, patch));
  };

  const handleSaveSelectedNode = async () => {
    if (!selectedNode) return;

    setSaveState("saving");
    setSaveMessage(jobId ? "正在保存所选节点..." : "正在保存本地草稿...");

    if (!jobId) {
      onSpecTreeChange?.(draftTree);
      setSaveState("saved");
      setSaveMessage("已保存到本地，后续可接入 API 持久化。");
      return;
    }

    const result: UpdateBlueprintSpecTreeNodeResult =
      await updateBlueprintSpecTreeNode(jobId, selectedNode.id, {
        title: selectedNode.title,
        summary: selectedNode.summary,
        status: selectedNode.status,
        priority: selectedNode.priority,
        outputs: selectedNode.outputs,
      });

    if (result.ok) {
      setDraftTree(result.data.specTree);
      onSpecTreeChange?.(result.data.specTree);
      setSaveState("saved");
      setSaveMessage("所选节点已保存。");
    } else {
      setSaveState("idle");
      setSaveMessage(result.error.message);
    }
  };

  const handleSaveTreeVersion = async () => {
    setVersionSaveState("saving");
    setVersionSaveMessage(
      jobId ? "正在保存树版本快照..." : "正在保存本地快照..."
    );

    if (!jobId) {
      onSpecTreeChange?.(draftTree);
      setVersionSaveState("saved");
      setVersionSaveMessage("版本快照已保存到本地。");
      return;
    }

    const result: SaveBlueprintSpecTreeVersionResult =
      await saveBlueprintSpecTreeVersion(jobId, {
        title: `${rootNode?.title ?? "SPEC tree"} v${draftTree.version}`,
        summary:
          "节点评审后从推导 SPEC 树工作台保存。",
      });

    if (result.ok) {
      setDraftTree(result.data.specTree);
      const nextVersions = versionSnapshots
        .filter(version => version.id !== result.data.version.id)
        .concat(result.data.version);
      setVersionSnapshots(nextVersions);
      onSpecTreeChange?.(result.data.specTree);
      onSpecTreeVersionsChange?.(nextVersions);
      setVersionSaveState("saved");
      setVersionSaveMessage(
        `版本快照已保存为 v${result.data.version.version}。`
      );
    } else {
      setVersionSaveState("idle");
      setVersionSaveMessage(result.error.message);
    }
  };

  const handleTreeAction = async (request: BlueprintSpecTreeActionRequest) => {
    setActionState("saving");
    setActionMessage(
      jobId ? "正在应用 SPEC 树结构操作..." : "需要 API 任务。"
    );

    if (!jobId) {
      setActionState("idle");
      return;
    }

    const result: RunBlueprintSpecTreeActionResult =
      await runBlueprintSpecTreeAction(jobId, request);

    if (result.ok) {
      setDraftTree(result.data.specTree);
      onSpecTreeChange?.(result.data.specTree);
      if (result.data.version) {
        const nextVersions = versionSnapshots
          .filter(version => version.id !== result.data.version?.id)
          .concat(result.data.version);
        setVersionSnapshots(nextVersions);
        onSpecTreeVersionsChange?.(nextVersions);
      }
      const preferredNodeId = result.data.node?.id;
      setSelectedNodeId(current =>
        preferredNodeId &&
        result.data.specTree.nodes.some(node => node.id === preferredNodeId)
          ? preferredNodeId
          : result.data.specTree.nodes.some(node => node.id === current)
            ? current
            : result.data.specTree.rootNodeId
      );
      setActionState("saved");
      setActionMessage(`已应用 ${blueprintCopy(request.action)}。`);
    } else {
      setActionState("idle");
      setActionMessage(result.error.message);
    }
  };

  return (
    <div
      className="mt-4 rounded-[20px] border border-[#0f766e]/25 bg-[#f0fdfa] px-4 py-4"
      data-testid="blueprint-spec-tree-preview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-[#0f766e]">
            <Workflow className="size-3.5" aria-hidden="true" />
            推导 SPEC 树工作台
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            {rootNode?.title ? blueprintCopy(rootNode.title) : "SPEC 资产树"}
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            {rootNode?.summary
              ? blueprintCopy(rootNode.summary)
              : "已选择的自动驾驶路线已转换成可编辑的 SPEC 树种子。"}
          </p>
        </div>
        <div className="grid gap-1 text-right text-xs font-black text-slate-500">
          <span>{draftTree.nodes.length} 个节点</span>
          <span>
            v{draftTree.version} / {blueprintCopy(draftTree.status)}
          </span>
          {selection ? <span>{blueprintCopy(selection.routeTitle)}</span> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#0f766e]/20 bg-white/78 px-3 py-3">
        <span className="text-xs font-bold text-slate-500">
          {versionSaveMessage}
        </span>
        <Button
          type="button"
          variant="outline"
          className="gap-2 rounded-full border-[#0f766e]/25 bg-white font-black text-[#0f766e] hover:bg-[#ecfdf5] hover:text-[#115e59]"
          disabled={versionSaveState === "saving"}
          onClick={handleSaveTreeVersion}
          data-testid="spec-tree-save-version-button"
        >
          {versionSaveState === "saving" ? (
            <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
          ) : versionSaveState === "saved" ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          保存版本
        </Button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.75fr)]">
        <section
          className="rounded-[18px] border border-[#0f766e]/20 bg-white p-4"
          data-testid="spec-tree-action-toolbar"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <GitBranch className="size-3.5" aria-hidden="true" />
                结构操作
              </div>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                {actionMessage}
              </p>
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
            >
              {actionState === "saving" ? "处理中" : blueprintCopy(actionState)}
            </Badge>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-black text-slate-500">
              子节点标题
              <input
                value={addNodeTitle}
                onChange={event => setAddNodeTitle(event.target.value)}
                className="h-10 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                data-testid="spec-tree-add-title-input"
              />
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                className="w-full gap-2 rounded-full bg-[#0f766e] font-black text-white hover:bg-[#115e59]"
                disabled={
                  actionState === "saving" ||
                  !selectedNode ||
                  selectedNode.id === draftTree.rootNodeId
                }
                onClick={() =>
                  handleTreeAction({
                    action: "add_node",
                    parentId: selectedNode?.id ?? draftTree.rootNodeId,
                    title: addNodeTitle,
                    summary: `从 SPEC 树工作台添加到 ${selectedNode?.title ?? rootNode?.title ?? "根节点"} 下方。`,
                    type: "route_step",
                    status: "draft",
                    outputs: [],
                  })
                }
                data-testid="spec-tree-add-node-button"
              >
                <PlusCircle className="size-3.5" aria-hidden="true" />
                添加子节点
              </Button>
            </div>

            <label className="grid gap-1.5 text-xs font-black text-slate-500">
              移动所选节点到
              <select
                value={moveParentId}
                onChange={event => setMoveParentId(event.target.value)}
                className="h-10 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                data-testid="spec-tree-move-parent-select"
              >
                {availableParentNodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {blueprintCopy(node.title)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 rounded-full border-slate-200 bg-white font-black text-slate-600 hover:bg-slate-100"
                disabled={
                  actionState === "saving" ||
                  !selectedNode ||
                  selectedNode.id === draftTree.rootNodeId
                }
                onClick={() =>
                  handleTreeAction({
                    action: "move_node",
                    nodeId: selectedNode?.id ?? "",
                    parentId: moveParentId,
                  })
                }
                data-testid="spec-tree-move-node-button"
              >
                <GitBranch className="size-3.5" aria-hidden="true" />
                移动节点
              </Button>
            </div>

            <label className="grid gap-1.5 text-xs font-black text-slate-500">
              合并所选节点到
              <select
                value={mergeTargetId}
                onChange={event => setMergeTargetId(event.target.value)}
                className="h-10 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                data-testid="spec-tree-merge-target-select"
              >
                {mergeTargetNodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {blueprintCopy(node.title)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 rounded-full border-slate-200 bg-white font-black text-slate-600 hover:bg-slate-100"
                disabled={actionState === "saving" || !selectedNode}
                onClick={() =>
                  handleTreeAction({
                    action: "merge_nodes",
                    sourceNodeId: selectedNode?.id ?? "",
                    targetNodeId: mergeTargetId,
                  })
                }
                data-testid="spec-tree-merge-node-button"
              >
                <Combine className="size-3.5" aria-hidden="true" />
                合并节点
              </Button>
            </div>

            <label className="grid gap-1.5 text-xs font-black text-slate-500">
              拆分节点标题
              <input
                value={splitNodeTitle}
                onChange={event => setSplitNodeTitle(event.target.value)}
                className="h-10 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                data-testid="spec-tree-split-title-input"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-black text-slate-500">
              拆分位置
              <select
                value={splitNodePlacement}
                onChange={event =>
                  setSplitNodePlacement(event.target.value as "sibling" | "child")
                }
                className="h-10 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                data-testid="spec-tree-split-placement-select"
              >
                <option value="sibling">同级</option>
                <option value="child">子级</option>
              </select>
            </label>

            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 rounded-full border-slate-200 bg-white font-black text-slate-600 hover:bg-slate-100"
                disabled={actionState === "saving" || !selectedNode}
                onClick={() =>
                  handleTreeAction({
                    action: "split_node",
                    sourceNodeId: selectedNode?.id ?? "",
                    title: splitNodeTitle,
                    placement: splitNodePlacement,
                  })
                }
                data-testid="spec-tree-split-node-button"
              >
                <Split className="size-3.5" aria-hidden="true" />
                拆分节点
              </Button>
            </div>

            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 rounded-full border-slate-200 bg-white font-black text-rose-600 hover:bg-rose-50"
                disabled={actionState === "saving" || !selectedNode || selectedNode.id === draftTree.rootNodeId}
                onClick={() =>
                  handleTreeAction({
                    action: "delete_node",
                    nodeId: selectedNode?.id ?? "",
                  })
                }
                data-testid="spec-tree-delete-node-button"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                删除节点
              </Button>
            </div>
          </div>
        </section>

        <section
          className="rounded-[18px] border border-slate-200 bg-white p-4"
          data-testid="spec-tree-version-timeline"
        >
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <History className="size-3.5" aria-hidden="true" />
            版本时间线
          </div>
          <div className="mt-3 grid gap-2">
            {sortedVersionSnapshots.length > 0 ? (
              sortedVersionSnapshots.map(version => (
                <article
                  key={version.id}
                  className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-950">
                        v{version.version}
                        {version.title ? ` · ${blueprintCopy(version.title)}` : ""}
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {version.summary
                          ? blueprintCopy(version.summary)
                          : "SPEC 树快照"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-2 rounded-full border-slate-200 bg-white font-black text-slate-600 hover:bg-slate-100"
                      disabled={actionState === "saving"}
                      onClick={() =>
                        handleTreeAction({
                          action: "set_current_version",
                          versionId: version.id,
                        })
                      }
                      data-testid="spec-tree-restore-version-button"
                    >
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                      恢复
                    </Button>
                  </div>
                  <div className="mt-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                    保存于 {version.savedAt}
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
                本次会话尚未保存树版本。
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-[18px] border border-[#0f766e]/20 bg-white p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              树节点
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-[#0f766e]/25 bg-[#0f766e]/10 text-[10px] font-black text-[#0f766e]"
            >
              可编辑草稿
            </Badge>
          </div>
          <div className="mt-3 max-h-[480px] overflow-y-auto" data-testid="spec-tree-node-list">
            <Tree
              treeData={antdTreeData}
              selectedKeys={selectedNodeId ? [selectedNodeId] : []}
              defaultExpandAll
              blockNode
              onSelect={(keys) => {
                if (keys.length > 0) {
                  setSelectedNodeId(keys[0] as string);
                }
              }}
            />
          </div>
        </div>

        <div className="rounded-[18px] border border-slate-200 bg-white p-4">
          {selectedNode ? (
            <div data-testid="spec-tree-node-detail">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                    <FileText className="size-3.5" aria-hidden="true" />
                    节点详情
                  </div>
                  <h4 className="mt-2 truncate text-base font-black text-slate-950">
                    {blueprintCopy(selectedNode.title)}
                  </h4>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                >
                  {nodeTypeLabel(selectedNode.type)}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="grid gap-1.5 text-xs font-black text-slate-500">
                  标题
                  <input
                    value={blueprintCopy(selectedNode.title)}
                    onChange={event =>
                      applySelectedPatch({ title: event.target.value })
                    }
                    className="h-10 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                    data-testid="spec-tree-node-title-input"
                  />
                </label>

                <label className="grid gap-1.5 text-xs font-black text-slate-500">
                  摘要
                  <textarea
                    value={blueprintCopy(selectedNode.summary)}
                    onChange={event =>
                      applySelectedPatch({ summary: event.target.value })
                    }
                    className="min-h-[96px] resize-y rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                    data-testid="spec-tree-node-summary-input"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                  <label className="grid gap-1.5 text-xs font-black text-slate-500">
                    状态
                    <select
                      value={selectedNode.status}
                      onChange={event =>
                        applySelectedPatch({
                          status: event.target
                            .value as BlueprintSpecTreeNodeStatus,
                        })
                      }
                      className="h-10 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                    >
                      {STATUS_OPTIONS.map(status => (
                        <option key={status} value={status}>
                          {blueprintCopy(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-xs font-black text-slate-500">
                    优先级
                    <input
                      type="number"
                      min={0}
                      value={selectedNode.priority}
                      onChange={event =>
                        applySelectedPatch({
                          priority: Number(event.target.value) || 0,
                        })
                      }
                      className="h-10 rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                    />
                  </label>
                </div>

                <label className="grid gap-1.5 text-xs font-black text-slate-500">
                  输出
                  <textarea
                    value={outputsToText(selectedNode.outputs.map(output => blueprintCopy(output)))}
                    onChange={event =>
                      applySelectedPatch({
                        outputs: parseOutputs(event.target.value),
                      })
                    }
                    className="min-h-[82px] resize-y rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-800 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
                    data-testid="spec-tree-node-outputs-input"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3">
                <span className="text-xs font-bold text-slate-500">
                  {saveMessage}
                </span>
                <Button
                  type="button"
                  className="gap-2 rounded-full bg-[#0f766e] font-black text-white hover:bg-[#115e59]"
                  disabled={saveState === "saving"}
                  onClick={handleSaveSelectedNode}
                  data-testid="spec-tree-save-button"
                >
                  {saveState === "saving" ? (
                    <RefreshCw
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : saveState === "saved" ? (
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Save className="size-3.5" aria-hidden="true" />
                  )}
                  保存节点
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
              请选择一个 SPEC 树节点进行查看和编辑。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SpecTreeWorkbenchPanel;
