/**
 * PageDesignerScreen — 页面设计器二期：全屏画布设计器。
 *
 * 对标 zip web-designer 的设计器范式（截图 1:1 三栏）：
 *   左栏 = 组件面板（四分类、可拖拽/可点选追加）+ 大纲树（与画布双向联动）；
 *   中栏 = 设计画布（组件树递归渲染，点选蓝框 + 悬浮工具条复制/删除，
 *          dnd-kit 拖入/移动，插入位置以蓝条指示）；
 *   右栏 = propsSchema 驱动的属性面板（注册表是唯一事实源）；
 *   顶栏 = 面包屑 + 撤销重做 + 校验徽标 + 重置 + 完成。
 *
 * 树是本地设计层（localStorage 按 pageId 存），默认树来自推演页面投影；
 * 所有变更走纯函数树操作，前快照进 TreeHistory——撤销重做零特判。
 */

import React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button as AntButton, Divider as AntDivider, Input, Steps, Table, Tabs } from "antd";
import {
  AlignLeftOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BorderOutlined,
  CalendarOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownSquareOutlined,
  EditOutlined,
  FolderOutlined,
  FontSizeOutlined,
  FormOutlined,
  InsertRowAboveOutlined,
  LineOutlined,
  LinkOutlined,
  NodeIndexOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  TableOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import type { FiveSystemModel } from "../../system-screens/five-system-model";
import {
  createNode,
  duplicateNode,
  findNode,
  insertNode,
  moveNode,
  nodePath,
  removeNode,
  TreeHistory,
  updateNode,
  validateTree,
  type ComponentNode,
  type TreeOpResult,
} from "./component-schema";
import { getComponentDefinition, listComponentsByCategory } from "./component-registry";
import { deriveDefaultPageTree, loadPageTrees, savePageTrees } from "./page-tree";
import { DesignerPropsPanel } from "./DesignerPropsPanel";

// 注册表 icon 字符串 → 图标组件（组件面板/大纲树共用）
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BorderOutlined,
  InsertRowAboveOutlined,
  AppstoreOutlined,
  FolderOutlined,
  FontSizeOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  LinkOutlined,
  LineOutlined,
  EditOutlined,
  AlignLeftOutlined,
  DownSquareOutlined,
  CalendarOutlined,
  TableOutlined,
  FormOutlined,
  BarChartOutlined,
  NodeIndexOutlined,
};

function TypeIcon({ icon, className }: { icon: string; className?: string }) {
  const Cmp = ICONS[icon] ?? BorderOutlined;
  return <Cmp className={className} />;
}

// ---------------------------------------------------------------------------
// 设计器上下文（画布递归节点从这里取选中态与操作，免层层传参）
// ---------------------------------------------------------------------------

interface DesignerCtxValue {
  model: FiveSystemModel;
  selectedId: string;
  issueNodeIds: Set<string>;
  dragging: boolean;
  select: (id: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
}

const DesignerCtx = React.createContext<DesignerCtxValue | null>(null);

// ---------------------------------------------------------------------------
// 画布：插入位置指示条（gap droppable）
// ---------------------------------------------------------------------------

function GapDrop({
  containerId,
  index,
  horizontal,
  grow,
}: {
  containerId: string;
  index: number;
  horizontal: boolean;
  /** 空容器占位：撑满并显示提示 */
  grow?: boolean;
}) {
  const ctx = React.useContext(DesignerCtx);
  const { setNodeRef, isOver } = useDroppable({
    id: `gap:${containerId}:${index}`,
    data: { containerId, index },
  });
  if (!ctx?.dragging && !grow) {
    // 非拖拽期不占空间（避免画布满是缝隙）；空容器占位常驻
    return null;
  }
  return (
    <div
      ref={setNodeRef}
      className={
        grow
          ? `flex min-h-[56px] flex-1 items-center justify-center rounded border border-dashed text-[10px] transition-colors ${
              isOver ? "border-blue-400 bg-blue-50 text-blue-500" : "border-stone-300 text-stone-400"
            }`
          : horizontal
          ? `w-1.5 self-stretch rounded transition-colors ${isOver ? "bg-blue-400" : "bg-blue-100/60"}`
          : `h-1.5 rounded transition-colors ${isOver ? "bg-blue-400" : "bg-blue-100/60"}`
      }
    >
      {grow ? "拖入组件" : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 画布：设计态组件视觉（静态渲染，交互全部让位给选中/拖拽）
// ---------------------------------------------------------------------------

function sampleValue(type: string | undefined, label: string, row: number): React.ReactNode {
  if (type === "number") return row === 0 ? 128 : 42;
  if (type === "date" || type === "datetime") return "2026-07-09";
  return `${label}示例${row + 1}`;
}

function NodeVisual({ node }: { node: ComponentNode }) {
  const ctx = React.useContext(DesignerCtx)!;
  const model = ctx.model;
  const p = node.props;
  const entities = model.datamodel?.entities ?? [];

  switch (node.type) {
    case "text": {
      const variant = String(p.variant ?? "body");
      const cls =
        variant === "title"
          ? "text-lg font-semibold text-stone-800"
          : variant === "subtitle"
          ? "text-sm font-medium text-stone-700"
          : variant === "caption"
          ? "text-xs text-stone-400"
          : "text-sm text-stone-600";
      return <div className={cls}>{String(p.content ?? "")}</div>;
    }
    case "image": {
      const src = String(p.src ?? "");
      const height = Number(p.height ?? 160);
      return src ? (
        <img src={src} alt={String(p.alt ?? "")} style={{ height }} className="w-full rounded object-cover" />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded bg-stone-100 text-stone-300"
          style={{ height }}
        >
          <PictureOutlined className="text-2xl" />
        </div>
      );
    }
    case "button":
      return (
        <AntButton
          type={(p.buttonType as "primary" | "default" | "dashed" | "link") ?? "primary"}
          size="small"
        >
          {String(p.label ?? "按钮")}
        </AntButton>
      );
    case "link-block":
      return (
        <div className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2.5 shadow-sm">
          <div>
            <div className="text-sm font-medium text-stone-800">{String(p.title ?? "链接块")}</div>
            <div className="text-[11px] text-stone-400">{String(p.desc ?? "")}</div>
          </div>
          <span className="text-stone-300">→</span>
        </div>
      );
    case "divider":
      return <AntDivider plain style={{ margin: "4px 0" }}>{String(p.label ?? "") || undefined}</AntDivider>;
    case "input":
      return (
        <div>
          <div className="mb-1 text-[11px] text-stone-500">{String(p.label ?? "")}</div>
          <Input size="small" placeholder={String(p.placeholder ?? "")} disabled />
        </div>
      );
    case "textarea":
      return (
        <div>
          <div className="mb-1 text-[11px] text-stone-500">{String(p.label ?? "")}</div>
          <Input.TextArea rows={Number(p.rows ?? 3)} placeholder={String(p.placeholder ?? "")} disabled />
        </div>
      );
    case "select":
      return (
        <div>
          <div className="mb-1 text-[11px] text-stone-500">{String(p.label ?? "")}</div>
          <Input size="small" placeholder={`下拉：${String(p.options ?? "")}`} disabled />
        </div>
      );
    case "date-picker":
      return (
        <div>
          <div className="mb-1 text-[11px] text-stone-500">{String(p.label ?? "")}</div>
          <Input size="small" type="date" disabled />
        </div>
      );
    case "data-table": {
      const entity = entities.find((e) => e.id === String(p.entityId ?? ""));
      const fieldIds = (p.columnFieldIds as string[] | undefined) ?? [];
      const fields = (entity?.fields ?? []).filter((f) => fieldIds.includes(f.id));
      if (!entity || fields.length === 0) {
        return (
          <div className="rounded border border-dashed border-stone-300 px-3 py-4 text-center text-[11px] text-stone-400">
            <TableOutlined /> 数据表格 · 在右栏绑定实体与列
          </div>
        );
      }
      return (
        <Table
          size="small"
          pagination={false}
          columns={fields.map((f) => ({ title: f.name || f.id, dataIndex: f.id }))}
          dataSource={[0, 1].map((row) => ({
            key: row,
            ...Object.fromEntries(fields.map((f) => [f.id, sampleValue(f.type, f.name || f.id, row)])),
          }))}
        />
      );
    }
    case "data-form": {
      const entity = entities.find((e) => e.id === String(p.entityId ?? ""));
      const fieldIds = (p.formFieldIds as string[] | undefined) ?? [];
      const fields = (entity?.fields ?? []).filter((f) => fieldIds.includes(f.id));
      if (!entity || fields.length === 0) {
        return (
          <div className="rounded border border-dashed border-stone-300 px-3 py-4 text-center text-[11px] text-stone-400">
            <FormOutlined /> 数据表单 · 在右栏绑定实体与字段
          </div>
        );
      }
      return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {fields.map((f) => (
            <div key={f.id}>
              <div className="mb-1 text-[11px] text-stone-500">{f.name || f.id}</div>
              <Input size="small" placeholder={f.type || "string"} disabled />
            </div>
          ))}
          <div className="col-span-2">
            <AntButton type="primary" size="small">
              {String(p.submitLabel ?? "提交")}
            </AntButton>
          </div>
        </div>
      );
    }
    case "chart": {
      const dimension = String(p.dimension ?? "");
      return (
        <div className="flex h-28 flex-col items-center justify-center gap-1 rounded border border-dashed border-stone-300 bg-stone-50/60 text-stone-400">
          <BarChartOutlined className="text-xl" />
          <div className="text-[11px] font-medium text-stone-500">{String(p.title ?? "图表")}</div>
          <div className="font-mono text-[9px]">
            {String(p.chartType ?? "bar")} · {dimension || "未绑定维度"} ·{" "}
            {String(p.metric ?? "count")}
          </div>
        </div>
      );
    }
    case "approval-progress": {
      const nodes = (model.workflow?.nodes ?? []).slice(0, 5);
      if (nodes.length === 0) {
        return (
          <div className="rounded border border-dashed border-stone-300 px-3 py-3 text-center text-[11px] text-stone-400">
            <NodeIndexOutlined /> 审批进度 · 模型未声明流程节点
          </div>
        );
      }
      return (
        <div>
          <div className="mb-2 text-[11px] font-medium text-stone-500">{String(p.title ?? "审批进度")}</div>
          <Steps
            size="small"
            current={1}
            items={nodes.map((n) => ({ title: n.name || n.id }))}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 画布：递归节点（选中框 + 悬浮工具条 + 拖拽把手 + 容器递归）
// ---------------------------------------------------------------------------

const CONTAINER_BG: Record<string, string> = {
  none: "",
  white: "bg-white shadow-sm",
  gray: "bg-stone-100",
};

function DesignNodeView({ node, isRoot = false }: { node: ComponentNode; isRoot?: boolean }) {
  const ctx = React.useContext(DesignerCtx)!;
  const def = getComponentDefinition(node.type);
  const selected = ctx.selectedId === node.id;
  const hasIssue = ctx.issueNodeIds.has(node.id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `node:${node.id}`,
    data: { kind: "node", id: node.id },
    disabled: isRoot || Boolean(node.locked),
  });

  const horizontal = node.type === "columns";
  const children = node.children ?? [];

  const renderChildren = () => {
    const gap = Number(node.props.gap ?? 12);
    if (children.length === 0) {
      return <GapDrop containerId={node.id} index={0} horizontal={horizontal} grow />;
    }
    const items: React.ReactNode[] = [];
    children.forEach((child, i) => {
      items.push(<GapDrop key={`gap-${i}`} containerId={node.id} index={i} horizontal={horizontal} />);
      items.push(
        <div key={child.id} className={horizontal ? "min-w-0 flex-1" : undefined}>
          <DesignNodeView node={child} />
        </div>
      );
    });
    items.push(
      <GapDrop
        key={`gap-${children.length}`}
        containerId={node.id}
        index={children.length}
        horizontal={horizontal}
      />
    );
    return (
      <div
        className={horizontal ? "flex items-stretch" : "flex flex-col"}
        style={{ gap: ctx.dragging ? Math.max(gap / 2, 4) : gap }}
      >
        {items}
      </div>
    );
  };

  // 容器内容体（按类型给容器视觉外壳）
  let body: React.ReactNode;
  if (!def) {
    body = <div className="rounded bg-red-50 px-2 py-1 text-[10px] text-red-500">未注册类型 {node.type}</div>;
  } else if (node.type === "group") {
    body = (
      <div
        className={`rounded-md border bg-white p-3 ${
          node.props.bordered === false ? "border-transparent" : "border-stone-200 shadow-sm"
        }`}
      >
        <div className="mb-2 text-sm font-semibold text-stone-700">{String(node.props.title ?? "分组")}</div>
        {renderChildren()}
      </div>
    );
  } else if (node.type === "tabs") {
    const titles = String(node.props.titles ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    body = (
      <Tabs
        size="small"
        items={children.map((child, i) => ({
          key: child.id,
          label: titles[i] || `页签 ${i + 1}`,
          children: <DesignNodeView node={child} />,
        }))}
      />
    );
    if (children.length === 0) {
      body = (
        <div className="rounded border border-dashed border-stone-300 p-2">
          <div className="mb-1 text-[10px] text-stone-400">选项卡：拖入「容器」作为页签</div>
          <GapDrop containerId={node.id} index={0} horizontal={false} grow />
        </div>
      );
    }
  } else if (def.isContainer) {
    body = (
      <div
        className={`rounded ${CONTAINER_BG[String(node.props.background ?? "none")] ?? ""}`}
        style={{ padding: Number(node.props.padding ?? 0) || undefined }}
      >
        {renderChildren()}
      </div>
    );
  } else {
    body = (
      <div className="pointer-events-none select-none">
        <NodeVisual node={node} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-testid={`design-node-${node.id}`}
      data-node-type={node.type}
      data-selected={selected}
      onClick={(e) => {
        e.stopPropagation();
        ctx.select(node.id);
      }}
      {...(isRoot ? {} : { ...listeners, ...attributes })}
      className={`relative rounded transition-shadow ${isDragging ? "opacity-40" : ""} ${
        selected
          ? "ring-2 ring-blue-500 ring-offset-1"
          : hasIssue
          ? "ring-1 ring-red-400"
          : "hover:ring-1 hover:ring-blue-300"
      } ${node.hidden ? "opacity-40" : ""} ${isRoot ? "min-h-full" : "cursor-grab"}`}
    >
      {/* 选中态悬浮工具条（根容器只改属性，不给复制/删除） */}
      {selected && !isRoot && (
        <div className="absolute -top-6 right-0 z-10 flex items-center gap-0.5 rounded bg-blue-600 px-1 py-0.5 text-white shadow">
          <span className="px-1 text-[9px]">{def?.name ?? node.type}</span>
          <button
            type="button"
            title="复制"
            data-testid="design-node-duplicate"
            className="rounded px-1 py-0.5 text-[10px] hover:bg-blue-500"
            onClick={(e) => {
              e.stopPropagation();
              ctx.duplicate(node.id);
            }}
          >
            <CopyOutlined />
          </button>
          <button
            type="button"
            title="删除"
            data-testid="design-node-delete"
            className="rounded px-1 py-0.5 text-[10px] hover:bg-blue-500"
            onClick={(e) => {
              e.stopPropagation();
              ctx.remove(node.id);
            }}
          >
            <DeleteOutlined />
          </button>
        </div>
      )}
      {node.hidden && (
        <span className="absolute right-1 top-1 z-10 rounded bg-stone-500/80 px-1 text-[9px] text-white">
          隐藏
        </span>
      )}
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 左栏：组件面板项（拖拽 + 点选追加）与大纲树
// ---------------------------------------------------------------------------

function PaletteItem({ type, name, icon, onAdd }: { type: string; name: string; icon: string; onAdd: (type: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { kind: "palette", type },
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      data-testid={`palette-item-${type}`}
      onClick={() => onAdd(type)}
      title={`点击追加到选中容器，或拖到画布指定位置`}
      className={`flex items-center gap-1.5 rounded border border-stone-200 bg-white px-2 py-1.5 text-left text-[11px] text-stone-600 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-600 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <TypeIcon icon={icon} className="text-stone-400" />
      {name}
    </button>
  );
}

function OutlineRow({ node, depth }: { node: ComponentNode; depth: number }) {
  const ctx = React.useContext(DesignerCtx)!;
  const def = getComponentDefinition(node.type);
  const selected = ctx.selectedId === node.id;
  const hasIssue = ctx.issueNodeIds.has(node.id);
  return (
    <>
      <button
        type="button"
        data-testid={`outline-row-${node.id}`}
        onClick={() => ctx.select(node.id)}
        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors ${
          selected ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "text-stone-600 hover:bg-stone-100"
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <TypeIcon icon={def?.icon ?? "BorderOutlined"} className={hasIssue ? "text-red-400" : "text-stone-400"} />
        <span className="truncate">{node.name || def?.name || node.type}</span>
        {node.hidden && <span className="text-[9px] text-stone-400">隐藏</span>}
        {hasIssue && <span className="text-[9px] text-red-500">✗</span>}
      </button>
      {(node.children ?? []).map((c) => (
        <OutlineRow key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export interface PageDesignerScreenProps {
  model: FiveSystemModel;
  pageId: string;
  sessionId: string;
  onClose: () => void;
}

export function PageDesignerScreen({ model, pageId, sessionId, onClose }: PageDesignerScreenProps) {
  const pageDef = React.useMemo(
    () => (model.page?.pages ?? []).find((pg, i) => (pg.id || `page-${i + 1}`) === pageId),
    [model, pageId]
  );
  const [tree, setTree] = React.useState<ComponentNode>(() => {
    const saved = loadPageTrees(sessionId)[pageId];
    if (saved) return saved;
    return pageDef
      ? deriveDefaultPageTree(pageDef, model)
      : { id: "root_fallback", type: "container", props: { gap: 12 }, children: [] };
  });
  const [selectedId, setSelectedId] = React.useState<string>(tree.id);
  const [dragLabel, setDragLabel] = React.useState<string | null>(null);
  const [hint, setHint] = React.useState<string | null>(null);
  const historyRef = React.useRef(new TreeHistory());
  const [historyTick, setHistoryTick] = React.useState(0);
  const hintTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const issues = React.useMemo(
    () => validateTree(tree, model, getComponentDefinition),
    [tree, model]
  );
  const issueNodeIds = React.useMemo(() => new Set(issues.map((i) => i.nodeId)), [issues]);

  const showHint = (text: string) => {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 3200);
  };

  const persist = React.useCallback(
    (root: ComponentNode) => {
      savePageTrees(sessionId, { ...loadPageTrees(sessionId), [pageId]: root });
    },
    [sessionId, pageId]
  );

  const applyResult = React.useCallback(
    (result: TreeOpResult) => {
      if (!result.ok) {
        showHint(result.reason);
        return;
      }
      historyRef.current.record(tree);
      setHistoryTick((t) => t + 1);
      setTree(result.root);
      persist(result.root);
    },
    [tree, persist]
  );

  // 选中节点被删/被撤销掉后回退到根
  React.useEffect(() => {
    if (!findNode(tree, selectedId)) setSelectedId(tree.id);
  }, [tree, selectedId]);

  const selectedNode = findNode(tree, selectedId) ?? tree;
  const path = nodePath(tree, selectedId) ?? [tree];

  // 点选追加：选中容器 → 追加进去；选中叶子 → 追加到其父容器
  const addByClick = (type: string) => {
    const def = getComponentDefinition(type);
    if (!def) return;
    let target = selectedNode;
    let targetDef = getComponentDefinition(target.type);
    if (!targetDef?.isContainer) {
      const parent = path.length >= 2 ? path[path.length - 2] : tree;
      target = parent;
    }
    applyResult(insertNode(tree, target.id, createNode(def), getComponentDefinition));
  };

  const handleDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { kind: string; type?: string; id?: string } | undefined;
    if (data?.kind === "palette" && data.type) {
      setDragLabel(getComponentDefinition(data.type)?.name ?? data.type);
    } else if (data?.kind === "node" && data.id) {
      const n = findNode(tree, data.id);
      setDragLabel(n ? n.name || getComponentDefinition(n.type)?.name || n.type : "组件");
    }
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setDragLabel(null);
    const over = e.over;
    if (!over) return;
    const a = e.active.data.current as { kind: string; type?: string; id?: string } | undefined;
    const o = over.data.current as { containerId?: string; index?: number } | undefined;
    if (!a || !o?.containerId) return;
    if (a.kind === "palette" && a.type) {
      const def = getComponentDefinition(a.type);
      if (!def) return;
      applyResult(insertNode(tree, o.containerId, createNode(def), getComponentDefinition, o.index));
    } else if (a.kind === "node" && a.id) {
      applyResult(moveNode(tree, a.id, o.containerId, getComponentDefinition, o.index));
    }
  };

  const undo = () => {
    const prev = historyRef.current.undo(tree);
    if (prev) {
      setTree(prev);
      persist(prev);
      setHistoryTick((t) => t + 1);
    }
  };
  const redo = () => {
    const next = historyRef.current.redo(tree);
    if (next) {
      setTree(next);
      persist(next);
      setHistoryTick((t) => t + 1);
    }
  };
  const resetToDefault = () => {
    if (!pageDef) return;
    const fresh = deriveDefaultPageTree(pageDef, model);
    historyRef.current.record(tree);
    setHistoryTick((t) => t + 1);
    setTree(fresh);
    const trees = loadPageTrees(sessionId);
    delete trees[pageId];
    savePageTrees(sessionId, trees);
    setSelectedId(fresh.id);
  };

  const ctxValue: DesignerCtxValue = {
    model,
    selectedId,
    issueNodeIds,
    dragging: dragLabel !== null,
    select: setSelectedId,
    duplicate: (id) => applyResult(duplicateNode(tree, id)),
    remove: (id) => applyResult(removeNode(tree, id)),
  };
  void historyTick; // 仅用于触发 canUndo/canRedo 重取

  return (
    <DesignerCtx.Provider value={ctxValue}>
      <div className="flex h-full w-full flex-col bg-[#F4F1EA]" data-testid="page-designer">
        {/* 顶栏：面包屑 + 撤销重做 + 校验 + 重置 + 完成 */}
        <div className="flex items-center gap-2 border-b border-stone-200 bg-white px-3 py-2">
          <span className="text-xs font-semibold text-stone-700">
            画布设计 · {pageDef?.name || pageId}
          </span>
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-700 ring-1 ring-amber-200">
            本地设计层 · 不改模型本体
          </span>
          {/* 面包屑（选中路径，可点回父级） */}
          <div className="ml-2 flex min-w-0 items-center gap-1 overflow-hidden text-[10px] text-stone-400" data-testid="designer-breadcrumb">
            {path.map((n, i) => (
              <React.Fragment key={n.id}>
                {i > 0 && <span>/</span>}
                <button
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className={`truncate hover:text-blue-600 ${
                    i === path.length - 1 ? "font-medium text-stone-600" : ""
                  }`}
                >
                  {n.name || getComponentDefinition(n.type)?.name || n.type}
                </button>
              </React.Fragment>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {hint && (
              <span className="rounded bg-red-50 px-2 py-0.5 text-[10px] text-red-600 ring-1 ring-red-200" data-testid="designer-hint">
                {hint}
              </span>
            )}
            {issues.length > 0 && (
              <span
                className="rounded bg-red-50 px-2 py-0.5 text-[10px] text-red-600 ring-1 ring-red-200"
                title={issues.map((i) => i.message).join("\n")}
                data-testid="designer-issues"
              >
                ✗ {issues.length} 处绑定问题
              </span>
            )}
            <AntButton size="small" icon={<UndoOutlined />} disabled={!historyRef.current.canUndo()} onClick={undo} data-testid="designer-undo">
              撤销
            </AntButton>
            <AntButton size="small" icon={<RedoOutlined />} disabled={!historyRef.current.canRedo()} onClick={redo} data-testid="designer-redo">
              重做
            </AntButton>
            <AntButton size="small" onClick={resetToDefault} data-testid="designer-reset">
              重置为推演原貌
            </AntButton>
            <AntButton size="small" type="primary" onClick={onClose} data-testid="designer-done">
              完成
            </AntButton>
          </div>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex min-h-0 flex-1">
            {/* 左栏：组件面板 + 大纲树 */}
            <div className="flex w-[220px] flex-col border-r border-stone-200 bg-white">
              <div className="min-h-0 flex-[3] overflow-auto p-2.5">
                {listComponentsByCategory().map((cat) => (
                  <div key={cat.key} className="mb-3">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                      {cat.label}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {cat.items.map((d) => (
                        <PaletteItem key={d.type} type={d.type} name={d.name} icon={d.icon} onAdd={addByClick} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="min-h-0 flex-[2] border-t border-stone-200 p-2" data-testid="designer-outline">
                <div className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  大纲
                </div>
                <div className="overflow-auto">
                  <OutlineRow node={tree} depth={0} />
                </div>
              </div>
            </div>

            {/* 中栏：设计画布 */}
            <div
              className="min-h-0 flex-1 overflow-auto p-5"
              onClick={() => setSelectedId(tree.id)}
              data-testid="designer-canvas"
            >
              <div className="mx-auto min-h-full max-w-[880px] rounded-lg bg-white p-4 shadow-sm ring-1 ring-stone-200">
                <DesignNodeView node={tree} isRoot />
              </div>
            </div>

            {/* 右栏：属性面板 */}
            <div className="w-[260px] border-l border-stone-200 bg-white">
              <DesignerPropsPanel
                node={selectedNode}
                model={model}
                issues={issues}
                onPatchProps={(patch) => applyResult(updateNode(tree, selectedNode.id, { props: patch }))}
                onRename={(name) => applyResult(updateNode(tree, selectedNode.id, { name }))}
                onToggle={(patch) => applyResult(updateNode(tree, selectedNode.id, patch))}
              />
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {dragLabel && (
              <div className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white shadow-lg">{dragLabel}</div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </DesignerCtx.Provider>
  );
}

export default PageDesignerScreen;
